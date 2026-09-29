import {computed, Injectable, signal} from '@angular/core';
import { CODE_BASE, EXCEPTION_TO_VECTOR, ExceptionCode, VECTOR_ENTRY_SIZE} from '../../models/asg.exceptions';
import { Pipeline } from '../../models/asg.models';
import {getConfiguredLatency} from '../../models/asg.config'
import {AsgInstruction} from '../../models/instructions/asg.instruction';
import {AsgInstructionFactoryService} from '../assembly/asg.instruction-factory';
import { MemoryAlignmentError, MemoryOutOfBoundsError} from '../asg.memory';
import {AsgProcessorService} from './asg.processor';


@Injectable({ providedIn: 'root' })
export class AsgPipelinedProcessorService extends AsgProcessorService {

  //estado del pipeline
  pipeline: Pipeline = { IF: null, ID: null, EX: null, MEM: null, WB: null };
  // Usamos un computed para tener acceso rápido y reactivo
  private isForwardingEnabled = computed(() => this.configService.getCurrentConfig().enableForwarding);
  private isChainingEnabled = computed(() => this.configService.getCurrentConfig().enableVectorChaining);
  // true durante el ciclo en que la instrucción en ID no puede avanzar por un RAW hazard.
  public hasDataHazardStall = signal(false);

  // Estadisticas de rendimiento del procesador
  public stats = signal({
    controlHazards: 0, //Riesgos de control
    rawStalls: 0,      // Reisgos Read After Write
    wawStalls: 0,      // Riesgos Write After Write
    warStalls: 0,      // Riesgos Write After Read
    structuralStalls: 0, // Riesgos estructurales
    instructionsFinished: 0, // instrucciones finalizadas
    cpi: 0,
    stallRate: 0,
    branchHits: 0, // saltos tomados acertados
    branchMisses: 0, // saltos mal predichos
    branchHitRate: 0 // hit rate de saltos
  });

  // Contador interno para facilitar el cálculo de las estaditicas sin afectar al rendimiento por modificar la señal muy seguido
  private controlHazardsCount = 0;
  private rawStallsCount = 0;
  private wawStallsCount = 0;
  private warStallsCount = 0;
  private structuralStallsCount = 0;
  private instructionsFinishedCount = 0;
  private branchHitsCount = 0;
  private branchMissesCount = 0;
  // PC guardado al que saltar después de ejecutar el delay slot
  private delaySlotPendingTarget: number | null = null;

  constructor() {
    // SIN RRF
    super(false);
  }

  /**
   * Metodo para acceso a lectura de memoria con control de excepcion propia de este procesador
   * TODO: refactorizar el método para que esté en el base del procesador y no repetido en cada uno solo por el manejo de la excepcion, que es propia del procesador
   * @param type
   * @param opcode
   * @param address
   * @param size
   * @param signed
   * @param instr
   * @private
   */
  private safeReadMemory(type: 'DATA' | 'INST', opcode: string, address: number, size: number, signed: boolean = true, instr?: AsgInstruction): number {
    try {
      if (type === 'DATA') {
        return this.dataMemory.read(address, size, signed);
      } else {
        return this.instructionsMemory.read(address, size, signed);
      }

    } catch (e: any) {
      if (e instanceof MemoryAlignmentError || e instanceof MemoryOutOfBoundsError) {
        const code = e instanceof MemoryAlignmentError
          ? ExceptionCode.MEMORY_ALIGNMENT_ERROR
          : ExceptionCode.MEMORY_OUT_OF_BOUNDS;
        if (instr) {
          instr.hasException = true;
          instr.exceptionCode = code;
        } else {
          this.addLog(`EXCEPCIÓN: ${e.message} en operacion ${opcode}`, 'error');
          this.pause();
        }
      }
      return 0;
    }
  }
  /**
   * Método para acceso a escritura de memoria con control de excepcion propia de este procesador
   * TODO: refactorizar el método para que esté en el base del procesador y no repetido en cada uno solo por el manejo de la excepcion, que es propia del procesador
   * @param type
   * @param address
   * @param value
   * @param size
   * @param instr
   * @private
   */
  private safeWriteMemory(type: 'DATA' | 'INST', address: number, value: number, size: number, instr?: AsgInstruction) {
    try {
      if (type === 'DATA') {
        this.dataMemory.write(address, value, size);
      } else {
        this.instructionsMemory.write(address, value, size);
      }
    } catch (e: any) {
      if (e instanceof MemoryAlignmentError || e instanceof MemoryOutOfBoundsError) {
        const code = e instanceof MemoryAlignmentError
          ? ExceptionCode.MEMORY_ALIGNMENT_ERROR
          : ExceptionCode.MEMORY_OUT_OF_BOUNDS;
        if (instr) {
          instr.hasException = true;
          instr.exceptionCode = code;
        } else {
          this.addLog(`EXCEPCIÓN: ${e.message}`, 'error');
          this.pause();
        }
      }
    }
  }

  /**
   * Método para cargar el procesador inicialmente y prepararlo para la ejecución
   * @param instructions
   * @param dataMemory
   * @param initialCodePtr
   * @param pcToLine
   */
  override load(instructions: Uint8Array, dataMemory: Uint8Array, initialCodePtr: number = CODE_BASE, pcToLine?: Map<number, number>) {
    // El ensamblador ya genera el programa completo (tabla de vectores + código usuario)
    this.instructionsMemory.set(instructions);
    this.dataMemory.load(dataMemory);
    this.pc = initialCodePtr;
    this.cycle.set(0);
    this.finished.set(false);
    // Limpiar el pipeline para empezar de cero
    this.pipeline = { IF: null, ID: null, EX: null, MEM: null, WB: null };
    this.branchPredictor.reset(); // Limpiar historial
    this.pcToLine = pcToLine ?? new Map();
    this.addLog("Programa cargado", 'info');
  }

  /**
   * Método principal para el funcionamiento del procesador, ejecuta un intervalo segun la velocidad indicada y ejecuta un ciclo en cada vuelta del intervalo hasta la finalizacion de la ejecucion
   */
  override run() {
    this.isStopped.set(false);
    this.isRunning.set(true);
    this.runInterval = setInterval(() => {
      const cycles = this.cyclesPerTick();

      for (let i = 0; i < cycles; i++) {
        // Si la línea tiene un breakpoint, paramos antes de hacer el Fetch
        if (this.shouldStopAtBreakpoint()) {
          this.pause();
          this.addLog(`Breakpoint alcanzado en línea ${this.getCurrentSourceLine()}`, 'warning');
          return;
        }

        this.nextCycle();

        // Verificar si el ciclo pausó por TRAP u otra razón
        if (!this.isRunning())
          return;

        // Si no hay más instrucciones en el pipeline ni en el programa, paramos
        if (this.isFinished()) {
          this.pause();
          this.finished.set(true);
          this.addLog("Programa finalizado", "success");
          //eliminar el ciclo adicional sumado
          this.cycle.update(c => c - 1);
          return;
        }
      }
    }, this.speed()); // Velocidad de ejecución (regulada desde interfaz)
  }

  /**
   * Verifica si el procesador ha terminado la ejecución.
   * Se considera terminado si:
   * 1. El PC apunta más allá de la última instrucción del programa.
   * 2. Todas las etapas del pipeline están vacías (null)
   */
  override isFinished(): boolean {
    // Comprobar si el PC ha superado la última instrucción disponible
    const noMoreInstructions = this.instructionsMemory.at(this.pc) === undefined;

    // Comprobar si todas las etapas del pipeline están vacías
    const pipelineEmpty =
      this.pipeline.IF === null &&
      this.pipeline.ID === null &&
      this.pipeline.EX === null &&
      this.pipeline.MEM === null &&
      this.pipeline.WB === null;

    return noMoreInstructions && pipelineEmpty;
  }

  /**
   * Método que simula un ciclo de reloj
   */
  override nextCycle() {
    this.logService.beginCycle();

    // Guardo el estado del pipeline ANTES de que nada se mueva, esto es para que el forwarding funcione bien (ya que muevo las instrucciones segun pasan por el pipeline)
    const snapshot = { ...this.pipeline };

    // Ejecuto las etapas en orden inverso para mantener la coherencia y evitar que una instruccion salte varias etapas en el mism ciclo por error
    this.doWB();

    this.doMEM(snapshot);

    this.doEX(snapshot);

    const isStalled = this.doID(snapshot);
    this.hasDataHazardStall.set(isStalled);

    // Actualizo el ciclo actual aqui para simular que el ciclo se incrementa con la etapa IF
    this.cycle.update(c => c + 1);
    if (!isStalled) {
      this.doIF();
    } else {
      // Si hay stall, NO llamamos a doIF (el PC no avanza e IF se queda igual)
      // NO tocamos this.pipeline.EX porque ahí está la instrucción con latencia o para que EX se quede como null (burbuja) si el Stall vino de un Load-Use.
      //this.pipeline.EX = null;
      this.addLog("Pipeline Stalled: Burbuja insertada", 'warning');
    }

    this.updateStats();
    this.updateTimeline();
    this.logService.flushLogs();
  }

  /**
   * Helper para marcar la linea actual en la etapa EX en el editor
   */
  override getExSourceLine(): number | null {
    const exInstr = this.pipeline.EX;
    if (!exInstr) return null;
    return this.pcToLine.get(exInstr.pc) ?? exInstr.id;
  }

  /**
   * Método para la simulación de la ALU del procesador. Recibe una instruccion, los valores y realiza los calculos segun el codigo de operacion. Si genera excepción, la marca y arrastra esa marca hasta la etapa final
   * TODO: refactorizar para hacer un servicio unico de ALU independiente de las excepciones de los procesadores
   * @param instr
   * @param val1
   * @param val2
   * @private
   */
  private executeALU(instr: AsgInstruction, val1: number, val2: number) {
    const imm = instr.imm ?? 0;

    // Helper para verificar excepciones FP (IEEE 754)
    const checkFPException = (res: number): ExceptionCode | null => {
      if (isNaN(res)) return ExceptionCode.FP_INVALID_OPERATION;
      if (!isFinite(res)) return ExceptionCode.FP_OVERFLOW;
      // Underflow: resultado no es cero pero es denormalizado (menor que MIN_VALUE normalizado)
      if (res !== 0 && Math.abs(res) < Number.MIN_VALUE) return ExceptionCode.FP_UNDERFLOW;
      return null;
    };

    switch (instr.opcode) {
      //Aritmetica entera
      case 'ADD': {
        const res = val1 + val2;
        if (res < -2147483648 || res > 2147483647) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.ARITHMETIC_OVERFLOW;
        }
        instr.result = res | 0;
        break;
      }
      case 'ADDI': {
        const res = val1 + imm;
        if (res < -2147483648 || res > 2147483647) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.ARITHMETIC_OVERFLOW;
        }
        instr.result = res | 0;
        break;
      }
      case 'SUB': {
        const res = val1 - val2;
        if (res < -2147483648 || res > 2147483647) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.ARITHMETIC_OVERFLOW;
        }
        instr.result = res | 0;
        break;
      }
      case 'SUBI': {
        const res = val1 - imm;
        if (res < -2147483648 || res > 2147483647) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.ARITHMETIC_OVERFLOW;
        }
        instr.result = res | 0;
        break;
      }
      case 'MULT':  instr.result = Math.floor(val1 * val2); break; // Entera
      case 'MULTI': instr.result = Math.floor(val1 * imm); break;  // Entera inmediata
      case 'DIV':
        if (val2 === 0) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.DIVISION_BY_ZERO;
          instr.result = 0;
        } else {
          instr.result = Math.floor(val1 / val2);
        }
        break;
      case 'DIVI':
        if (imm === 0) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.DIVISION_BY_ZERO;
          instr.result = 0;
        } else {
          instr.result = Math.floor(val1 / imm);
        }
        break;
      // Aritmetica entera sin signo
      case 'ADDU':
        instr.result = ((val1 >>> 0) + (val2 >>> 0)) >>> 0; break;
      case 'ADDUI':
        instr.result = ((val1 >>> 0) + (imm >>> 0)) >>> 0; break;
      case 'SUBU':
        instr.result = ((val1 >>> 0) - (val2 >>> 0)) >>> 0; break;
      case 'SUBUI':
        instr.result = ((val1 >>> 0) - (imm >>> 0)) >>> 0; break;
      case 'MULTU':
        instr.result = (val1 >>> 0) * (val2 >>> 0); break;
      case 'DIVU':
        if (val2 === 0) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.DIVISION_BY_ZERO;
          instr.result = 0;
        } else {
          instr.result = Math.floor((val1 >>> 0) / (val2 >>> 0)) >>> 0;
        }
        break;
      // Desplazamientos
      case 'SLL':
        instr.result = (val1 << val2) >>> 0; break;
      case 'SLLI':
        instr.result = (val1 << imm) >>> 0; break;
      case 'SRL':
        instr.result = (val1 >>> val2); break;
      case 'SRLI':
        instr.result = (val1 >>> imm); break;
      case 'SRA':
        instr.result = (val1 >> val2); break;
      case 'SRAI':
        instr.result = (val1 >> imm); break;

      // Aritmetica flotante simple
      // precision simple (SP): aplicar Math.fround para que el forwarding tenga la misma precisión que el banco de registros
      case 'ADDF': {
        const res = Math.fround(val1 + val2);
        const exc = checkFPException(res);
        if (exc) { instr.hasException = true; instr.exceptionCode = exc; }
        instr.result = res;
        break;
      }
      case 'SUBF': {
        const res = Math.fround(val1 - val2);
        const exc = checkFPException(res);
        if (exc) { instr.hasException = true; instr.exceptionCode = exc; }
        instr.result = res;
        break;
      }
      case 'MULTF': {
        const res = Math.fround(val1 * val2);
        const exc = checkFPException(res);
        if (exc) { instr.hasException = true; instr.exceptionCode = exc; }
        instr.result = res;
        break;
      }
      case 'DIVF':
        if (val2 === 0) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.FP_DIVISION_BY_ZERO;
          instr.result = 0;
        } else {
          const res = Math.fround(val1 / val2);
          const exc = checkFPException(res);
          if (exc) { instr.hasException = true; instr.exceptionCode = exc; }
          instr.result = res;
        }
        break;
      // Doble precision, no aplicar ninguna modificacion, JS ya maneja los numeros como 64bits
      case 'ADDD': {
        const res = val1 + val2;
        const exc = checkFPException(res);
        if (exc) { instr.hasException = true; instr.exceptionCode = exc; }
        instr.result = res;
        break;
      }
      case 'SUBD': {
        const res = val1 - val2;
        const exc = checkFPException(res);
        if (exc) { instr.hasException = true; instr.exceptionCode = exc; }
        instr.result = res;
        break;
      }
      case 'MULTD': {
        const res = val1 * val2;
        const exc = checkFPException(res);
        if (exc) { instr.hasException = true; instr.exceptionCode = exc; }
        instr.result = res;
        break;
      }
      case 'DIVD':
        if (val2 === 0) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.FP_DIVISION_BY_ZERO;
          instr.result = 0;
        } else {
          const res = val1 / val2;
          const exc = checkFPException(res);
          if (exc) { instr.hasException = true; instr.exceptionCode = exc; }
          instr.result = res;
        }
        break;
      // Comparaciones enteras r-r
      // Iguales
      case 'SEQ': instr.result = (val1 | 0) === (val2 | 0) ? 1 : 0; break;
      // Distintos
      case 'SNE': instr.result = (val1 | 0) !== (val2 | 0) ? 1 : 0; break;
      // Mayor que (Greater Than)
      case 'SGT': instr.result = (val1 | 0) > (val2 | 0) ? 1 : 0; break;
      // Mayor o igual (Greater Than or Equal)
      case 'SGE': instr.result = (val1 | 0) >= (val2 | 0) ? 1 : 0; break;
      // Menor que (Less Than)
      case 'SLT': instr.result = (val1 | 0) < (val2 | 0) ? 1 : 0; break;
      // Menor o igual (Less Than or Equal)
      case 'SLE': instr.result = (val1 | 0) <= (val2 | 0) ? 1 : 0; break;
      // Comparaciones enteras sin singno r-r
      //iguales  unsigned
      case 'SEQU': instr.result = (val1 >>> 0) === (val2 >>> 0) ? 1 : 0; break;
      // Distintos unsigned
      case 'SNEU': instr.result = (val1 >>> 0) !== (val2 >>> 0) ? 1 : 0; break;
      // Mayor que (Greater Than) unsigned
      case 'SGTU': instr.result = (val1 >>> 0) > (val2 >>> 0) ? 1 : 0; break;
      // Mayor o igual (Greater Than or Equal) unsigned
      case 'SGEU': instr.result = (val1 >>> 0) >= (val2 >>> 0) ? 1 : 0; break;
      // Menor que (Less Than) unsigned
      case 'SLTU': instr.result = (val1 >>> 0) < (val2 >>> 0) ? 1 : 0; break;
      // Menor o igual (Less Than or Equal) unsigned
      case 'SLEU': instr.result = (val1 >>> 0) <= (val2 >>> 0) ? 1 : 0; break;
      // Comparaciones inmediatas
      case 'SEQI': instr.result = (val1 | 0) === (imm | 0) ? 1 : 0; break;
      case 'SNEI': instr.result = (val1 | 0) !== (imm | 0) ? 1 : 0; break;
      case 'SGTI':  instr.result = (val1 | 0) > (imm | 0) ? 1 : 0; break;
      case 'SGEI':  instr.result = (val1 | 0) >= (imm | 0) ? 1 : 0; break;
      case 'SLTI':  instr.result = (val1 | 0) < (imm | 0) ? 1 : 0; break;
      case 'SLEI':  instr.result = (val1 | 0) <= (imm | 0) ? 1 : 0; break;
      // Comparaciones inmediatas sin signo
      //iguales  unsigned
      case 'SEQUI': instr.result = (val1 >>> 0) === (imm >>> 0) ? 1 : 0; break;
      // Distintos unsigned
      case 'SNEUI': instr.result = (val1 >>> 0) !== (imm >>> 0) ? 1 : 0; break;
      // Mayor que (Greater Than) unsigned
      case 'SGTUI': instr.result = (val1 >>> 0) > (imm >>> 0) ? 1 : 0; break;
      // Mayor o igual (Greater Than or Equal) unsigned
      case 'SGEUI': instr.result = (val1 >>> 0) >= (imm >>> 0) ? 1 : 0; break;
      // Menor que (Less Than) unsigned
      case 'SLTUI': instr.result = (val1 >>> 0) < (imm >>> 0) ? 1 : 0; break;
      // Menor o igual (Less Than or Equal) unsigned
      case 'SLEUI': instr.result = (val1 >>> 0) <= (imm >>> 0) ? 1 : 0; break;
      // Comparaciones flotantes (actualizan el bit de condicion del procesador)
      case 'EQF': case 'EQD': instr.result = this.registerFile.setFPCondition(val1 === val2); break;
      case 'NEF': case 'NED': instr.result = this.registerFile.setFPCondition(val1 !== val2); break;
      case 'LTF': case 'LTD': case 'SLTD': case 'SLTF': instr.result = this.registerFile.setFPCondition(val1 < val2); break;
      case 'GTF': case 'GTD': case 'SGTD': case 'SGTF': instr.result = this.registerFile.setFPCondition(val1 > val2); break;
      case 'LEF': case 'LED': case 'SLED': case 'SLEF': instr.result = this.registerFile.setFPCondition(val1 <= val2); break;
      case 'GEF': case 'GED': case 'SGED': case 'SGEF': instr.result = this.registerFile.setFPCondition(val1 >= val2); break;
      // Conversiones entre registros float
      case 'CVTF2D': instr.result = val1; break; // Float a Double: JS ya usa 64-bit internamente
      // entero en registro float a doble o simple precision
      case 'CVTI2D':
      case 'CVTI2F': {
        // El registro float contiene los bits de un entero (movido con MOVI2FP).
        // val1 tiene los bits interpretados como float. Debemos recuperar el entero original.
        // Convertimos el float de vuelta a sus bits y los interpretamos como int32.
        const buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, val1, false);
        instr.result = new DataView(buf).getInt32(0, false); // JS convierte int a number (64-bit double)
        break;
      }
      // Double a Float: fuerza precisión 32 bits
      case 'CVTD2F': instr.result = Math.fround(val1); break;
      case 'CVTF2I': case 'CVTD2I': instr.result = Math.trunc(val1) | 0; break; // Trunca a entero de 32 bits
      // Movimientos entre regisotrs
      case 'MOVF': // Mueve registros simple precision
      case 'MOVD': // Mueve registros doble precision
      case 'MOVI2S':  // val1 = Rs → WB escribe en VLR
      case 'MOVF2S':  // val1 = Fs → WB reinterpreta bits como bitmask de VM
        instr.result = val1; break;
// Mueve un entero a precision simple copiando bits sin conversion
      case 'MOVI2FP': {
        const buf = new ArrayBuffer(4);
        new DataView(buf).setInt32(0, val1 | 0, false);
        instr.result = new DataView(buf).getFloat32(0, false);
        break;
      }
// Mueve simple precision a entero copiando bits sin conversion
      case 'MOVFP2I': { // Rd(int) ← Rs(float) - copia bits sin conversión
        const buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, val1, false);
        instr.result = new DataView(buf).getInt32(0, false);
        break;
      }
// Mueve un registro especial (VL) a un registro entero
      case 'MOVS2I':
        instr.result = this.registerFile.vl();
        break;
// Mueve la mascara VM de vector a un registro simple precision
      case 'MOVS2F': { // Fd ← VM empaquetada como bitmask de 32 bits en float
        let mask = 0;
        const vm = this.registerFile.vectorMask();
        for (let i = 0; i < 32; i++) { if (vm[i] !== 0) mask |= (1 << i); }
        const buf = new ArrayBuffer(4);
        new DataView(buf).setInt32(0, mask, false);
        instr.result = new DataView(buf).getFloat32(0, false);
        break;
      }
// Cuenta los numeros 1 en la mascara vectorial y guarda el resultado en un registro
      case 'POP': {
        let count = 0;
        const vm = this.registerFile.vectorMask();
        for (let i = 0; i < vm.length; i++) {
          if (vm[i] !== 0) count++;
        }
        instr.result = count;
        break;
      }
      //Saltos
      case 'J':  this.resolveBranch(instr, true, imm * 4); break;
      case 'JAL':
        instr.rd     = 31;           // Enlace: R31 = dirección de retorno
        instr.result = instr.pc + 4; // PC de la instrucción siguiente a JAL
        this.resolveBranch(instr, true, imm * 4);
        break;
      case 'JR':  this.resolveBranch(instr, true, val1); break;
      case 'JALR':
        instr.rd     = 31;           // Enlace: R31 = dirección de retorno
        instr.result = instr.pc + 4; // PC de la instrucción siguiente a JALR
        this.resolveBranch(instr, true, val1);
        break;
      // Branchs
      case 'BEQZ': this.resolveBranch(instr, (val1 | 0) === 0, imm * 4); break;
      case 'BNEZ': this.resolveBranch(instr, (val1 | 0) !== 0, imm * 4); break;
      case 'BGTZ': this.resolveBranch(instr, (val1 | 0) > 0, imm * 4); break;
      case 'BLTZ': this.resolveBranch(instr, (val1 | 0) < 0, imm * 4); break;
      case 'BFPT': this.resolveBranch(instr, this.registerFile.fpConditionBit() === 1, imm * 4); break;
      case 'BFPF': this.resolveBranch(instr, this.registerFile.fpConditionBit() === 0, imm * 4); break;
      // Logica
      //en JavaScript, los operadores bit a bit (&, |, ^) convierten internamente el número a un entero de 32 bits con signo. añado el desplazamiento logico a la derecha >>> 0 para forzar a js a tratar el resultado como un entero de 32 bits sin signo
      case 'AND':  instr.result = (val1 & val2) >>> 0; break;
      case 'OR':   instr.result = (val1 | val2) >>> 0; break;
      case 'XOR':  instr.result = (val1 ^ val2) >>> 0; break;
      // Logica inmediata
      case 'ANDI':
        instr.result = (val1 & imm) >>> 0;
        break;
      case 'ORI':
        instr.result = (val1 | imm) >>> 0;
        break;
      case 'XORI':
        instr.result = (val1 ^ imm) >>> 0;
        break;
      // Cargas desde memoria (calculo de la direccion
      case 'LB':
      case 'LBU':
      case 'LH':
      case 'LHU':
      case 'LW':
      case 'LF':
      case 'LD':
        instr.result = (val2 + imm) | 0;
        break;
      case 'LHI':
        // Coloca el inmediato en los 16 bits superiores y pone a 0 los inferiores
        // En ASG, el inmediato se trata como unsigned para esta operación
        instr.result = (imm << 16) >>> 0;
        break;
      // Almacenamientos a memoria
      case 'SB':
      case 'SH':
      case 'SW':
      case 'SF':
      case 'SD':
        instr.result = (val1 + imm) | 0;
        break;
      case 'NOP':
        instr.result = 0;
        break;
      case 'TRAP':
        this.executeTrap(instr, val1);
        break;
      case 'RFE':
        this.pc = this.iar() + 4;
        this.cause.set('');
        if (this.configService.getCurrentConfig().enableBranchDelaySlot) {
          this.flushPipelineOnlyIF();
        } else {
          this.flushPipelineBelowID();
        }
        this.addLog(`RFE: retornando a 0x${this.pc.toString(16)} (IAR)`, 'info');
        break;
    }
  }

  /**
   * Etapa Memoria
   * TODO: eliminar comprobaciones de opcode a mano en el metodo
   * @param snapshot
   * @private
   */
  private doMEM(snapshot: Pipeline) {
    const instr = this.pipeline.MEM;
    if (!instr) return;

    if (instr.isVector && ['LV', 'SV', 'LVWS', 'SVWS', 'LVI', 'SVI'].includes(instr.opcode)) {

      // Latencia de arranque (startup latency): consumir ciclos antes de procesar elementos (solo operaciones de carga), la latencia es inicial al abrir el puerto de memoria
      if (instr.initDelay > 0 && ['LV', 'LVWS', 'LVI'].includes(instr.opcode)) {
        this.addLog(`MEM: ${instr.opcode} latencia de arranque: faltan ${instr.initDelay} ciclos`, 'info');
        instr.initDelay--;
        return;
      }

      this.processVectorMemoryElement(instr, snapshot);

      // Bloqueo en la etapa si aun faltan elementos por procesar
      if (instr.currentElement < this.registerFile.vl()) {
        // IMPORTANTE: Al retornar aquí, 'this.pipeline.MEM' sigue conteniendo la misma instrucción para el próximo ciclo.
        this.addLog(`MEM: ${instr.opcode} procesando elemento ${instr.currentElement}/${this.registerFile.vl()}`, 'info');
        return;
      }

      // Latencia final para operaciones de almacenamiento (después de procesar los elementos)
      if (instr.endDelay > 1 && ['SV', 'SVWS', 'SVI'].includes(instr.opcode)) {
        // cyclesRemaining actúa como marcador: solo decrementamos endDelay después del primer ciclo
        if (instr.cyclesRemaining < instr.endDelay)
          instr.endDelay--;

        instr.cyclesRemaining--;
        this.addLog(`MEM: ${instr.opcode} latencia de fin: faltan ${instr.endDelay} ciclos`, 'info');
        return;
      }

      instr.currentElement = 0; // Reset para que WB sepa que ya terminó
    } else {
      const addr = instr.result!; // Dirección calculada en EX

      switch (instr.opcode) {
        case 'LW':
          instr.result = this.safeReadMemory('DATA', instr.opcode, addr, 4, true, instr);
          this.addLog(`MEM: Leído word ${instr.result} de 0x${addr.toString(16)}`, 'info');
          break;
        case 'LH':
          instr.result = this.safeReadMemory('DATA', instr.opcode, addr, 2, true, instr);
          this.addLog(`MEM: Leído halfword ${instr.result} de 0x${addr.toString(16)}`, 'info');
          break;
        case 'LHU':
          instr.result = this.safeReadMemory('DATA', instr.opcode, addr, 2, false, instr);
          this.addLog(`MEM: Leído halfword unsigned ${instr.result} de 0x${addr.toString(16)}`, 'info');
          break;
        case 'LB':
          instr.result = this.safeReadMemory('DATA', instr.opcode, addr, 1, true, instr);
          this.addLog(`MEM: Leído byte ${instr.result} de 0x${addr.toString(16)}`, 'info');
          break;
        case 'LBU':
          instr.result = this.safeReadMemory('DATA', instr.opcode, addr, 1, false, instr); // Sin signo
          this.addLog(`MEM: Leído byte unsigned ${instr.result} de 0x${addr.toString(16)}`, 'info');
          break;
        case 'LF':
          // Leemos 4 bytes y los tratamos como Float32
          instr.result = this.safeReadMemory('DATA', instr.opcode, addr, 3, false, instr);
          this.addLog(`MEM: Leído float 32-bit de 0x${addr.toString(16)}`, 'info');
          break;
        case 'LD':
          // Leemos 8 bytes del tirón
          instr.result = this.safeReadMemory('DATA', instr.opcode, addr, 8, false, instr);
          this.addLog(`MEM: Leído double ${instr.result} de 0x${addr.toString(16)}`, 'info');
          break;
        case 'SW':
          // Usamos getFloatValue si es flotante para asegurar consistencia
          const valW = instr.isFloat ? this.getFloatValue(instr.rs2!, false) : this.registerFile.readIntRegister(instr.rs2!);
          this.safeWriteMemory('DATA', addr, valW, 4, instr);
          this.addLog(`MEM: Guardado word ${valW} en 0x${addr.toString(16)}`, 'info');
          break;
        case 'SH':
          const valH = this.registerFile.readIntRegister(instr.rs2!) & 0xFFFF;
          this.safeWriteMemory('DATA', addr, valH, 2, instr);
          this.addLog(`MEM: Guardado halfword ${valH} en 0x${addr.toString(16)}`, 'info');
          break;
        case 'SB':
          const valB = this.registerFile.readIntRegister(instr.rs2!) & 0xFF;
          this.safeWriteMemory('DATA', addr, valB, 1, instr);
          this.addLog(`MEM: Guardado byte ${valB} en 0x${addr.toString(16)}`, 'info');
          break;
        case 'SF':
          // Obtenemos solo los 32 bits del registro (isDouble = false)
          const valF = this.getFloatValue(instr.rs2!, false);
          this.safeWriteMemory('DATA', addr, valF, 3, instr); //error detectado en test unitario, float no esta escribiendo bien en memoria manteniendo el formato
          this.addLog(`MEM: Guardado float 32-bit en 0x${addr.toString(16)}`, 'info');
          break;
        case 'SD':
          // Leemos el valor de 64 bits (F[n] y F[n+1])
          const valD = this.getFloatValue(instr.rs2!, true);
          this.safeWriteMemory('DATA', addr, valD, 8, instr)
          this.addLog(`MEM: Guardado double ${valD} en 0x${addr.toString(16)}`, 'info');
          break;
      }
    }

    this.pipeline.WB = instr;
    this.pipeline.MEM = null;
  }

  /**
   * Etapa EX
   * TODO: Eliminar referencias y comprobaciones con opcodes a mano
   * @param snapshot
   * @private
   */
  private doEX(snapshot: Pipeline) {
    const instr = this.pipeline.EX;
    if (!instr) return;

    if (instr.isVector) {

      // Las operaciones de memoria vectorial: calcular dirección en EX y pasar a MEM
      if (['LV', 'SV', 'LVWS', 'SVWS', 'LVI', 'SVI'].includes(instr.opcode)) {
        const op = instr.opcode;
        // Calcular dirección base y leer stride/índices (solo una vez, en EX)
        if (instr.result === undefined) {
          if (op === 'LV') {
            // LV Vd, offset(Rs2): dirección = Rs2 + offset
            instr.result = (this.getForwardedValue(instr.rs2!, false, snapshot).value + (instr.imm ?? 0)) | 0;
          } else if (op === 'LVWS') {
            // LVWS: base en rs2, stride en imm (que contiene el número del registro)
            instr.result = this.getForwardedValue(instr.rs2!, false, snapshot).value | 0;
            // Leer stride del registro con forwarding
            const strideReg = instr.imm ?? 0;
            (instr as any).strideValue = this.getForwardedValue(strideReg, false, snapshot).value;
          } else if (op === 'LVI') {
            // LVI: base en rs2, índices en registro vectorial imm
            instr.result = this.getForwardedValue(instr.rs2!, false, snapshot).value | 0;
            // El vector de índices se leerá elemento a elemento en MEM para permitir encadenamiento
          } else if (op === 'SV') {
            // SV Vd, offset(Rs1): dirección = Rs1 + offset
            instr.result = (this.getForwardedValue(instr.rs1!, false, snapshot).value + (instr.imm ?? 0)) | 0;
          } else if (op === 'SVWS') {
            // SVWS: base en rs1, stride en imm (número de registro)
            instr.result = this.getForwardedValue(instr.rs1!, false, snapshot).value | 0;
            // Leer stride del registro con forwarding
            const strideReg = instr.imm ?? 0;
            (instr as any).strideValue = this.getForwardedValue(strideReg, false, snapshot).value;
          } else if (op === 'SVI') {
            // SVI: base en rs1, índices en registro vectorial imm
            instr.result = this.getForwardedValue(instr.rs1!, false, snapshot).value | 0;
            // El vector de índices se leerá elemento a elemento en MEM para permitir encadenamiento
          }
          instr.currentElement = 0;
          // Registrar que este registro está siendo escrito (ningún elemento listo aún)
          if (instr.rd !== undefined)
            this.registerFile.setVectorRegisterStatus(instr.rd, { instrId: instr.id!, lastElementReady: -1 });
        }
        this.addLog(`EX: ${instr.opcode} calculada dirección de memoria enviando a MEM`, 'info');

        // BLOQUEO ESTRUCTURAL: Si la etapa MEM ya está ocupada por otra instruccion, esta instrucción se queda en EX
        if (this.pipeline.MEM !== null) {
          this.addLog(`EX: ${instr.opcode} bloqueado esperando que MEM se libere`, 'warning');
          return;
        }

        this.pipeline.MEM = instr;
        this.pipeline.EX = null;
        return;
      }

      // Latencia de arranque (startup latency): consumir ciclos antes de procesar elementos
      if (instr.initDelay > 0) {
        this.addLog(`${instr.opcode} latencia de arranque: faltan ${instr.initDelay} ciclos`, 'info');
        instr.initDelay--;
        return;
      }

      // Una vez consumida la latencia, procesar elementos
      this.processVectorElement(instr, snapshot);

      // Si aún faltan elementos por procesar, la instrucción SE QUEDA en EX
      if (instr.currentElement < this.registerFile.vl()) {
        this.addLog(`${instr.opcode} procesando elemento ${instr.currentElement}/${this.registerFile.vl()}`, 'info');
        return;
      }

    } else {

      // Manejo de latencia (instrucciones multi-ciclo) se quedan en EX
      if (instr.cyclesRemaining > 1) {
        this.addLog(`${instr.opcode} en EX: faltan ${instr.cyclesRemaining} ciclos`, 'info');
        instr.cyclesRemaining--;
        return;
      }

      // Resolucion de operandos con adelantamiento (si esta habilitado)
      let v1 = 0;
      let v2 = 0;
      let source1 = 'REG';
      let source2 = 'REG';

      // Operando 1
      if (instr.rs1 !== undefined) {
        // Importante: Las instrucciones de memoria usan R para la base
        const res1 = this.getForwardedValue(instr.rs1, instr.isFloatOrigin, snapshot);
        v1 = res1.value;
        source1 = res1.source;
      }

      // Si la instrucción tiene un inmediato (y no es un salto), usamos el inmediato. Si no, buscamos el valor del registro rs2 con adelantamiento.
      if (instr.imm !== undefined && !['BNEZ', 'BGTZ', 'BLTZ', 'J', 'JUMP', 'LW', 'LD', 'LF', 'SW', 'SD', 'SF', 'LH', 'LHU', 'LB', 'LBU', 'SH', 'SB', 'LHI'].includes(instr.opcode)) {
        v2 = instr.imm;
        source2 = 'IMM';
      } else if (instr.rs2 !== undefined) {
        // En cargas de memoria (LD, LF, LW…) rs2 es el registro BASE, siempre entero, aunque la instrucción opere con datos float/double.
        const isLoadOp = ['LW', 'LD', 'LF', 'LH', 'LHU', 'LB', 'LBU'].includes(instr.opcode);
        const res2 = this.getForwardedValue(instr.rs2!, isLoadOp ? false : instr.isFloat, snapshot);
        v2 = res2.value;
        source2 = res2.source;
      }

      // Guardamos metadatos para el componente visual del cronograma
      instr.forwardingSource = {rs1: source1 as any, rs2: source2 as any};

      // TRAP 3 espera la entrada del usuario
      if (instr.opcode === 'TRAP' && instr.imm === 3) {
        const r14 = v1; // v1 = valor adelantado de R14 (resuelto arriba por getForwardedValue)
        const fd  = this.safeReadMemory('DATA', 'TRAP', r14, 4, true, instr);
        if (fd === 0 && instr.result === undefined) {
          const bufAddr  = this.safeReadMemory('DATA', 'TRAP', r14 + 4, 4, true, instr);
          const maxBytes = this.safeReadMemory('DATA', 'TRAP', r14 + 8, 4, true, instr);
          this.wasRunningBeforeTrap = this.isRunning();
          this.trapStdinRequest.set({ bufAddr, maxBytes, instrId: instr.id });
          this.pause();
          return; // Se queda en EX hasta que resolveTrapStdin() sea llamado
        }
        if (fd === 0 && instr.result !== undefined) {
          // Ya resuelto — avanzar normalmente
          this.pipeline.MEM = instr;
          this.pipeline.EX = null;
          return;
        }
      }

      // Opera en la alu
      this.executeALU(instr, v1, v2);
    }

    // BLOQUEO ESTRUCTURAL: Si la etapa MEM ya está ocupada por otra instruccion, esta se queda en EX
    if (this.pipeline.MEM !== null) {
      this.addLog(`EX: ${instr.opcode} bloqueado esperando que MEM se libere`, 'warning');
      return;
    }

    this.pipeline.MEM = instr;
    this.pipeline.EX = null;
  }

  /**
   * Etapa WB
   * @private
   */
  private doWB() {
    const instr = this.pipeline.WB;
    if (!instr) return;

    // Tratamiento de excepciones precisas
    if (instr.hasException) {
      const exCode = instr.exceptionCode ?? ExceptionCode.UNKNOWN;
      this.addLog(`WB: EXCEPCIÓN PRECISA en PC=0x${instr.pc.toString(16)}: ${exCode}`, 'error');

      // Guardar PC para retorno en IAR y la causa con el codigo de excepcion
      this.iar.set(instr.pc);
      this.cause.set(exCode);
      //limpia el pipe debajo de la instruccion
      this.flushPipeline();
      // salta al vector de interrupción correspondiente
      const vectorIndex = EXCEPTION_TO_VECTOR[exCode];
      const vectorAddr = vectorIndex * VECTOR_ENTRY_SIZE;
      this.addLog(`WB: Saltando a vector ${vectorIndex} (0x${vectorAddr.toString(16)})`, 'info');
      this.pc = vectorAddr;
      return;
    }

    //Manejo de instrucciones especiales

    // MOVI2S → actualizar el registro de longitud vectorial
    if (instr.opcode === 'MOVI2S') {
      const newVL = Math.max(0, Math.min(this.MVL, instr.result! | 0));
      this.registerFile.vl.set(newVL);
      this.addLog(`WB: VLR ← ${newVL} (máx: ${this.MVL})`, 'success');
      this.instructionsFinishedCount++;
      this.pipeline.WB = null;
      return;
    }

    // MOVF2S VM, Fs → decodificar bits del float como bitmask y actualizar VM
    if (instr.opcode === 'MOVF2S') {
      const bits = this.registerFile.setVectorMask(instr.result!);
      this.addLog(`WB: VM ← 0x${(bits >>> 0).toString(16).padStart(8, '0')}`, 'success');
      this.instructionsFinishedCount++;
      this.pipeline.WB = null;
      return;
    }

    // Comparaciones vectoriales (SEQV, SLTV, SEQSV, SLTVS): setean la mascara vectorial
    if (instr.isVector && instr.config.argNum === 2 && instr.opcode !== 'CVI') {
      this.registerFile.writeVectorMask(instr.vectorResult!.slice() as Float64Array);
      this.addLog(`WB: Vector Mask actualizado por ${instr.opcode}`, 'success');
      this.instructionsFinishedCount++;
      this.pipeline.WB = null;
      return;
    }

    // CVM: reiniciar la máscara vectorial (todos los elementos activos)
    if (instr.opcode === 'CVM') {
      this.registerFile.resetVectorMask();
      this.addLog(`WB: Vector Mask limpiada (todos los elementos activos)`, 'success');
      this.instructionsFinishedCount++;
      this.pipeline.WB = null;
      return;
    }

    // Verificamos si la instrucción tiene un registro destino (rd)
    if (instr.rd !== undefined) {

      if (instr.isVector) {
        this.registerFile.writeVectorRegister(instr.rd!, instr.vectorResult!);
      } else {
        if (instr.isFloat) {
          // Si es una instrucción de coma flotante (ej. ADD.D)
          this.registerFile.writeFloatRegister(instr.rd, instr.result!, instr.isDouble)
        } else {
          // Si es una instrucción entera (ej. ADDI), evitando actualizar R0 por error
          if (instr.rd !== 0) {
            this.registerFile.writeIntRegister(instr.rd, instr.result!);
          }
        }
      }

      this.addLog(`WB: Registro ${instr.isFloat ? 'F' : instr.isVector ? 'V' : 'R'}${instr.rd} actualizado a ${instr.isVector ? instr.vectorResult : instr.result}`, 'success');
    }

    this.instructionsFinishedCount++;
    // Una vez procesada, la instrucción sale del pipeline definitivamente
    this.pipeline.WB = null;
  }

  /**
   * Etapa ID
   * @param snapshot
   * @private
   */
  private doID(snapshot: Pipeline): boolean {
    const instr = this.pipeline.ID;
    if (!instr) return false;

    this.addLog(`ID: Decodificando ${instr.opcode}`, 'info');

    // Gestión de TRAP de parada
    if (instr.opcode === 'TRAP') {
      if (instr.imm === 6) {
        // TRAP 6: Parada unilateral e inmediata
        this.addLog('ID: TRAP 6 detectado, parada inmediata del procesador', 'error');
        this.flushPipelineBelowID();
        this.pc = this.instructionsMemory.get().length;
        this.finished.set(true);
        return true; // Bloquea avance y detiene to do
      } else if (instr.imm === 0) {
        // TRAP 0 (exit) debe esperar a que el pipeline se vacíe antes de ejecutarse. Actúa como barrera de sincronización para garantizar que todas las instrucciones anteriores completen antes de finalizar el programa
        if (this.pipeline.EX !== null || this.pipeline.MEM !== null || this.pipeline.WB !== null) {
          this.addLog('TRAP 0: Esperando a que el pipeline se vacíe antes de finalizar (Salida Ordenada)', 'info');
          return true; // Stall hasta que EX, MEM y WB estén vacíos
        }
      }
    }

    if (instr.isVector) {
      // Comprobamos si hay alguna instrucción vectorial en el pipeline (EX o MEM) que produzca los registros que necesitamos (rs1, rs2)
      const canChain = this.checkChainingPossibility(instr, snapshot);

      if (!canChain) {
        const mode = this.isChainingEnabled() ? 'Chaining' : 'Sin Chaining';
        this.addLog(`ID: Stall en ${instr.opcode} esperando datos vectoriales (${mode})`, 'warning');
        return true;
      }
    }

    // Comprobacion de dependencias de datos. Revisamos EX y MEM en el snapshot
    const stagesToCheck = [snapshot.EX, snapshot.MEM];

    for (const instrAhead of stagesToCheck) {
      if (!instrAhead) continue;

      const rdAhead = instrAhead.rd;
      const rs1Ahead = instrAhead.rs1;
      const rs2Ahead = instrAhead.rs2;
      const rdCurrent = instr.rd;
      const rs1Current = instr.rs1;
      const rs2Current = instr.rs2;

      // Ignorar R0 (siempre 0, no causa riesgos)
      if (rdAhead === 0) continue;

      // RAW (Read After Write): Lee un registro que la anterior está escribiendo
      const isRAW = rdAhead !== undefined && (rdAhead === rs1Current || rdAhead === rs2Current);
      // WAW (Write After Write): Escribe a un registro que la anterior también escribe (no se dara este caso en esta arquitectura como tal, solo para fines educativos)
      const isWAW = rdAhead !== undefined && rdCurrent !== undefined && rdAhead === rdCurrent && rdCurrent !== 0;
      // WAR (Write After Read): Escribe a un registro que la anterior lee (no se dara este caso en esta arquitectura como tal, solo para fines educativos)
      const isWAR = rdCurrent !== undefined && rdCurrent !== 0 && (rdCurrent === rs1Ahead || rdCurrent === rs2Ahead);

      // Determinar si el riesgo causa STALL
      let causesStall = false;

      if (this.isForwardingEnabled()) {
        // CON FORWARDING: Solo LOAD-USE (RAW) causa stall
        if (isRAW && instrAhead === snapshot.EX && ['LW', 'LBU', 'LH', 'LHU', 'LD', 'LF', 'LB'].includes(instrAhead.opcode)) {
          this.addLog(`ID: Riesgo RAW (LOAD-USE) con R/F${rdAhead}. Generando Stall.`, 'warning');
          this.rawStallsCount++;
          causesStall = true;
        }
      } else {
        // SIN FORWARDING: RAW siempre causa stall
        if (isRAW) {
          this.addLog(`ID: Riesgo RAW (Sin Forwarding) con R/F${rdAhead}. Stall generado.`, 'warning');
          this.rawStallsCount++;
          causesStall = true;
        }
      }

      // WAW (Write After Write): Se detecta pero NO causa stall en pipeline in-order porque las escrituras ocurren en orden en WB
      if (isWAW && !causesStall) {
        this.addLog(`ID: Dependencia WAW detectada: ambas escriben a R/F${rdCurrent} (no causa stall).`, 'info');
        this.wawStallsCount++;
      }

      // WAR (Write After Read): Se detecta pero NO causa stall en pipeline in-order porque las lecturas (ID/EX) ocurren antes que las escrituras (WB)
      if (isWAR && !causesStall) {
        this.addLog(`ID: Dependencia WAR detectada: escribo a R/F${rdCurrent} que ${instrAhead.opcode} leyó (no causa stall).`, 'info');
        this.warStallsCount++;
      }

      if (causesStall)
        return true;
    }

    // Riesgo Estructural: Etapa EX ocupada
    // Si la instrucción en EX aún no ha salido (por latencia o porque MEM está bloqueada), bloqueamos la entrada desde ID (Stall).
    if (this.pipeline.EX !== null) {
      this.addLog(`ID: Riesgo Estructural: Etapa EX ocupada. Generando Stall.`, 'warning');
      this.structuralStallsCount++;
      return true;
    }

    this.pipeline.EX = instr;
    this.pipeline.ID = null;
    return false;
  }

  private static readonly BRANCH_OPCODES = new Set([
    'BEQZ', 'BNEZ', 'BGTZ', 'BLTZ', 'BFPT', 'BFPF', 'J', 'JAL', 'JR', 'JALR'
  ]);

  /**
   * Etapa IF
   * @private
   */
  private doIF() {
    this.pipeline.ID = this.pipeline.IF;

    if (this.instructionsMemory.at(this.pc) !== undefined) {
      const word = this.safeReadMemory('INST', 'IF', this.pc, 4);
      const instr = AsgInstructionFactoryService.decode(word, this.pc, this.cycle());

      if (instr) {
        const cfgLatency = getConfiguredLatency(instr.opcode, this.configService.getCurrentConfig().latencies);
        if (cfgLatency !== undefined) instr.setCyclesRemaining(cfgLatency);

        const delaySlotEnabled = this.configService.getCurrentConfig().enableBranchDelaySlot;
        const fetchingDelaySlot = this.delaySlotPendingTarget !== null;

        const prediction = this.branchPredictor.predict(this.pc, instr.opcode);
        (instr as any).predictedTaken = prediction.taken;
        (instr as any).predictedTarget = prediction.target;
        (instr as any).ghrSnapshot = prediction.ghrSnapshot;
        (instr as any).hybridLocalTaken = prediction.localTaken;
        (instr as any).hybridGlobalTaken = prediction.globalTaken;
        this.branchPredictor.updateGHRSpeculative(prediction.taken);

        this.pipeline.IF = instr;
        this.addLog(`IF: Capturada instrucción ${instr.opcode} en PC=0x${this.pc.toString(16)}`, 'info');

        if (fetchingDelaySlot) {
          // Esta instrucción es el delay slot: redirigir al target guardado
          this.pc = this.delaySlotPendingTarget!;
          this.delaySlotPendingTarget = null;
          this.addLog(`IF: Delay slot capturado, redirigiendo a 0x${this.pc.toString(16)}`, 'info');
        } else if (delaySlotEnabled && prediction.taken && AsgPipelinedProcessorService.BRANCH_OPCODES.has(instr.opcode?.toUpperCase() ?? '')) {
          // Branch predicho taken con delay slot: forzar fetch del delay slot primero
          this.delaySlotPendingTarget = prediction.target;
          this.pc = instr.pc + 4;
          this.addLog(`IF: Branch predicho taken, capturando delay slot en 0x${this.pc.toString(16)}`, 'info');
        } else if (prediction.taken) {
          this.pc = prediction.target;
          this.addLog(`IF: Predicción -> Salto a 0x${this.pc.toString(16)}`, 'info');
        } else {
          this.pc += 4;
        }
      } else {
        this.pipeline.IF = null;
      }
    } else {
      this.pipeline.IF = null;
    }
  }

  /**
   * Helper para obtener los datos de un registro con forwarding (si habilitado) o desde registro arquitectonico
   * @param regIndex
   * @param isFloat
   * @param snapshot
   * @private
   */
  private getForwardedValue(regIndex: number, isFloat: boolean, snapshot: Pipeline): { value: number, source: string } {
    // R0 es siempre 0, no hay forwarding para él
    if (regIndex === 0 && !isFloat) return { value: 0, source: 'REG' };

    if (this.isForwardingEnabled()) {
      // Primero se comprueba si hay forwarding desde EX/MEM (Instrucción en etapa MEM)
      const instrInMEM = snapshot.MEM;
      if (instrInMEM && instrInMEM.rd === regIndex && instrInMEM.isFloat === isFloat && !instrInMEM.isVector) {
        //error descubierto en test unitario. si no es float hay que normalizar a entero con signo porque si se trata sin signo, mas adelante puede saltar overflow y no tratariamos el error al no llevar el signo
        return { value: isFloat ? instrInMEM.result! : (instrInMEM.result! | 0), source: 'MEM' };
      }

      // Segundo probamos si hay forwarding desde MEM/WB (Instrucción en etapa WB)
      const instrInWB = snapshot.WB;
      if (instrInWB && instrInWB.rd === regIndex && instrInWB.isFloat === isFloat && !instrInWB.isVector) {
        return { value: isFloat ? instrInWB.result! : (instrInWB.result! | 0), source: 'WB' };
      }
    }

    // Si no, leer del banco de registros
    if (isFloat) {
      // La instrucción que está pidiendo el dato AHORA está en EX
      const currentInstr = this.pipeline.EX;
      const isDoubleNeeded = currentInstr?.isDoubleSource || this.registerFile.isFloatRegisterDouble(regIndex) || false;

      return { value: this.getFloatValue(regIndex, isDoubleNeeded), source: 'REG' };
    } else {
      return { value: this.registerFile.readIntRegister(regIndex), source: 'REG' };
    }
  }

  /**
   * Metodo para reiniciar el procesador a estado inicial
   */
  override reset() {
    // Reiniciar PC, ciclos y el estado del procesador
    this.pc = CODE_BASE; // El código de usuario empieza después de la tabla de vectores
    this.cycle.set(0);
    this.finished.set(false);
    this.isStopped.set(false);
    this.hasDataHazardStall.set(false);

    //Limpiar banco de registros y memoria de datos
    this.registerFile.reset();
    this.dataMemory.reset();

    //vaciar pipeline y variables de control de branch delay slot
    this.pipeline = {
      IF: null,
      ID: null,
      EX: null,
      MEM: null,
      WB: null
    };
    this.delaySlotPendingTarget = null;

    // Limpiar cronograma
    this.timeline.set([]);
    this.timelineIndex.clear();

    // logs y estadisticas
    this.logService.reset();
    this.controlHazardsCount = 0;
    this.rawStallsCount = 0;
    this.wawStallsCount = 0;
    this.warStallsCount = 0;
    this.structuralStallsCount = 0;
    this.instructionsFinishedCount = 0;
    this.branchHitsCount = 0;
    this.branchMissesCount = 0;
    this.branchPredictor.reset();
    this.updateStats();

    // Limpiar solicitudes I/O pendientes, consola e IAR
    this.iar.set(0);
    this.cause.set('');
    this.trapStdinRequest.set(null);
    this.consoleOutput.set([]);
    this.wasRunningBeforeTrap = false;
  }

  /**
   * SISTEMA DE TRAPS del procesador
   *
   * Trap 0 → exit()        — termina el programa de manera controlada (finalizando las instrucciones pendientes)
   * Trap 1 → open()        — abre fichero (no soportado en este simulador)
   * Trap 2 → close()       — cierra fichero (no soportado en este simulador)
   * Trap 3 → read()        — lee bytes de fichero / stdin (fd=0). SOLO fd=0 (por pantalla, no soportado desde fichero)
   * Trap 4 → write()       — escribe bytes en fichero / stdout (fd=1,2). SOLO fd=1,2 (por pantalla, no soportado a fichero).
   * Trap 5 → printf()      — salida formateada a stdout
   * Trap 6 -> exit() (forced) - termina el programa de manera unilateral y para el procesador
   *
   * Convención de registros:
   * R14 — dirección del bloque de parámetros en memoria de datos
   * R1  — valor de retorno de la funcion
   *
   *
   * @param instr
   * @param r14Addr
   * @private
   */
  private executeTrap(instr: AsgInstruction, r14Addr: number): void {
    const trapCode = instr.imm ?? 0;
    const r14 = r14Addr; // Valor adelantado de R14 (ya resuelto con forwarding en doEX)
    // IAR: almacena la dirección de retorno de la instruccion siguente al TRAP actual para retornar
    this.iar.set((instr.pc + 4) & 0xFFFFFFFF);

    switch (trapCode) {
      // TRAP 6 se maneja en este procesador en el momento en que se decodifica en la etapa ID y bloquea el resto de etapas hasta que finalicen las instrucciones anteriores
      case 0:
        this.addLog(`TRAP ${trapCode}: Programa terminado`, 'success');
        // Vaciar el pipeline para descartar instrucciones posteriores
        this.flushPipelineBelowID();
        // Establecer PC fuera del rango válido para que no se carguen más instrucciones
        this.pc = this.instructionsMemory.get().length;
        instr.result = 0;
        break;
      case 1:
        this.addLog('TRAP 1: open() no soportado en el simulador', 'warning');
        instr.result = -1;
        break;
      case 2:
        this.addLog('TRAP 2: close() no soportado en el simulador', 'warning');
        instr.result = -1;
        break;
      // lee el bloque de parámetros en R14: [fd(4), bufAddr(4), count(4)]
      case 3: {
        const fd = this.safeReadMemory('DATA', 'TRAP', r14, 4, true, instr);
        if (fd !== 0) {
          this.addLog(`TRAP 3: fd=${fd} no soportado (solo fd=0/stdin)`, 'warning');
          instr.result = -1;
        }
        // fd=0 (stdin): el stall asíncrono se gestiona en doEX antes de llegar aquí
        // Si llegamos aquí, la lectura ya está resuelta (result ≠ undefined)
        break;
      }
      // lee bloque de parámetros en R14: [fd(4), bufAddr(4), count(4)]
      // write() escribe exactamente count bytes — no se detiene en null.
      case 4: {
        const fd4 = this.safeReadMemory('DATA', 'TRAP', r14, 4, true, instr);
        const bufAddr4 = this.safeReadMemory('DATA', 'TRAP', r14 + 4, 4, true, instr);
        const count4 = this.safeReadMemory('DATA', 'TRAP', r14 + 8, 4, true, instr);
        if (fd4 === 1 || fd4 === 2) {
          let text = '';
          for (let i = 0; i < count4; i++) {
            const byte = this.safeReadMemory('DATA', 'TRAP', bufAddr4 + i, 1, false, instr);
            text += String.fromCharCode(byte);
          }
          this.trapPrint(text);
          instr.result = count4;
        } else {
          this.addLog(`TRAP 4: fd=${fd4} no soportado (solo fd=1/stdout, fd=2/stderr)`, 'warning');
          instr.result = -1;
        }
        break;
      }
      // Bloque de parámetros en R14: [fd(4), bufAddr(4), count(4)]
      // Se pasa r14 directamente; trapFormatPrintf lee mem[r14] para obtener la dirección de la cadena de formato y los args desde r14 + 4.
      case 5: {
        this.addLog(`TRAP 5: R14=0x${r14.toString(16)}, bloque de parámetros en mem[0x${r14.toString(16)}]`, 'info');
        const output = this.trapFormatPrintf(r14, r14 + 4, instr);
        this.trapPrint(output);
        instr.result = output.length;
        break;
      }
      default:
        this.addLog(`TRAP ${trapCode}: código desconocido`, 'error');
        instr.result = -1;
    }
  }

  /**
   * Helper para resolver la lectura de stdin (TRAP 3, fd=0) cuando el usuario confirma desde consola
   * Escribe la cadena introducida en el buffer de memoria y reanuda la ejecución.
   */
  override resolveTrapStdin(input: string): void {
    const req  = this.trapStdinRequest();
    const instr = this.pipeline.EX;
    if (req && instr && instr.opcode === 'TRAP') {
      const bytes = this.trapWriteString(req.bufAddr, input, req.maxBytes, instr);
      instr.result = bytes;
      this.registerFile.writeIntRegister(1, bytes); // R1 = bytes leídos
      this.addLog(`TRAP 3 (stdin): "${input}" → buffer[0x${req.bufAddr.toString(16)}], ${bytes} bytes`, 'success');
    }
    this.trapStdinRequest.set(null);
    if (this.wasRunningBeforeTrap) {
      this.wasRunningBeforeTrap = false;
      this.run();
    }
  }

  /**
   * Helper que añade una linea a la consola del procesador y registra en el log de eventos
   * @param text
   * @private
   */
  private trapPrint(text: string): void {
    this.consoleOutput.update(lines => [...lines, text]);
    this.addLog(`[stdout] ${text.replace(/\n/g, '↵')}`, 'success');
  }

  /**
   * Helper para leer una cadena terminada en null (o hata maxLen bytes) desde memroria
   * @param addr
   * @param maxLen
   * @param instr
   * @private
   */
  private trapReadString(addr: number, maxLen: number = 256, instr?: AsgInstruction): string {
    let result = '';
    for (let i = 0; i < maxLen; i++) {
      const byte = this.safeReadMemory('DATA', 'TRAP', addr + i, 1, false, instr);
      if (!byte) break;  // detiene en 0 (null terminator) o undefined (fuera de rango)
      result += String.fromCharCode(byte);
    }
    return result;
  }

  /**
   * Escribe una cadena en memoria de datos y añade el terminador nulo.
   * Devuelve el número de bytes escritos (sin contar el null).
   */
  private trapWriteString(addr: number, text: string, maxBytes: number, instr?: AsgInstruction): number {
    const limit = Math.min(text.length, maxBytes - 1);
    for (let i = 0; i < limit; i++) {
      this.safeWriteMemory('DATA', addr + i, text.charCodeAt(i), 1, instr);
    }
    this.safeWriteMemory('DATA', addr + limit, 0, 1, instr); // null terminator
    return limit;
  }

  /**
   * Implementacion de la funcion printf de C para TRAP 5
   * @param fmtPtrAddr dirección dentro del bloque de parámetros donde está el puntero a la cadena de formato (es decir, R14; mem[fmtPtrAddr] = dir. del string).
   * @param argsAddr dirección del primer argumento numérico (R14 + 4).
   * @param instr objeto instruccion para manejo de excepciones
   * @private
   */
  private trapFormatPrintf(fmtPtrAddr: number, argsAddr: number, instr?: AsgInstruction): string {
    const fmtAddr = this.safeReadMemory('DATA', 'TRAP', fmtPtrAddr, 4, true, instr);
    const fmt = this.trapReadString(fmtAddr, 256, instr);
    this.addLog(`TRAP 5: fmtPtrAddr=0x${fmtPtrAddr.toString(16)} → fmtAddr=0x${fmtAddr.toString(16)}, fmt="${fmt.substring(0, 40).replace(/\n/g, '↵')}" (${fmt.length} chars)`, 'info');
    let result = '';
    let argOffset = 0;
    let i = 0;

    while (i < fmt.length) {
      const ch = fmt[i];

      if (ch === '%' && i + 1 < fmt.length) {
        i++;
        const spec = fmt[i];
        switch (spec) {
          case 'd': case 'i': {
            const val = this.safeReadMemory('DATA', 'TRAP', argsAddr + argOffset, 4, true, instr);
            result += val.toString();
            argOffset += 4;
            break;
          }
          case 'u': {
            const val = this.safeReadMemory('DATA', 'TRAP', argsAddr + argOffset, 4, false, instr);
            result += (val >>> 0).toString();
            argOffset += 4;
            break;
          }
          case 'f': {
            const val = this.safeReadMemory('DATA', 'TRAP', argsAddr + argOffset, 9, false, instr); // 8 bytes for float64
            result += val.toFixed(6);
            argOffset += 8;
            break;
          }
          case 'g': case 'e': {
            const val = this.safeReadMemory('DATA', 'TRAP', argsAddr + argOffset, 9, false, instr);
            result += spec === 'g' ? val.toPrecision(6) : val.toExponential(6);
            argOffset += 8;
            break;
          }
          case 's': {
            const strPtr = this.safeReadMemory('DATA', 'TRAP', argsAddr + argOffset, 4, true, instr);
            result += this.trapReadString(strPtr, 256, instr);
            argOffset += 4;
            break;
          }
          case 'c': {
            const val = this.safeReadMemory('DATA', 'TRAP', argsAddr + argOffset, 4, true, instr);
            result += String.fromCharCode(val & 0xFF);
            argOffset += 4;
            break;
          }
          case 'x': case 'X': {
            const val = this.safeReadMemory('DATA', 'TRAP', argsAddr + argOffset, 4, false, instr);
            const hex = (val >>> 0).toString(16);
            result += spec === 'X' ? hex.toUpperCase() : hex;
            argOffset += 4;
            break;
          }
          case '%':
            result += '%';
            break;
          default:
            result += '%' + spec;
        }
      } else {
        result += ch;
      }
      i++;
    }
    return result;
  }

  /**
   * Helper para resolver el salto de una instruccion de salto con manejo del predictor de saltos incorporado
   * @param instr
   * @param actuallyTaken
   * @param targetPC
   * @private
   */
  private resolveBranch(instr: AsgInstruction, actuallyTaken: boolean, targetPC: number) {
    const predictedTaken: boolean = (instr as any).predictedTaken || false;
    const predictedTarget: number = (instr as any).predictedTarget || 0;
    const ghrSnapshot: number = (instr as any).ghrSnapshot ?? 0;
    const hybridLocalTaken: boolean = (instr as any).hybridLocalTaken ?? false;
    const hybridGlobalTaken: boolean = (instr as any).hybridGlobalTaken ?? false;

    const delaySlotEnabled = this.configService.getCurrentConfig().enableBranchDelaySlot;
    // Con delay slot, el slot +4 (delay slot) ya está en ID y siempre se ejecuta. El PC correcto TRAS el delay slot depende de la resolucion del salto.
    const nextPCCorrect = actuallyTaken ? targetPC : (delaySlotEnabled ? instr.pc + 8 : instr.pc + 4);
    const actualPathTaken = predictedTaken ? predictedTarget : (delaySlotEnabled ? instr.pc + 8 : instr.pc + 4);

    this.branchPredictor.update(instr.pc, actuallyTaken, targetPC, ghrSnapshot, hybridLocalTaken, hybridGlobalTaken);

    const mispredicted = (predictedTaken !== actuallyTaken) || (actuallyTaken && predictedTaken && predictedTarget !== targetPC);

    if (mispredicted) {
      this.branchMissesCount++;
      this.branchPredictor.rollbackGHR(ghrSnapshot, actuallyTaken);

      // la suerte ha hecho que la prediccion fuera fallida pero el camino seguido por el procesador fuera correcto, por lo que no hacemos flush
      if (actualPathTaken === nextPCCorrect) {
        this.addLog(`EX: Predicción fallida en 0x${instr.pc.toString(16)}, pero camino correcto. Sin flush.`, 'info');
      } else {
        // corregimos el camino y flush
        this.addLog(`EX: Predicción FALLIDA en 0x${instr.pc.toString(16)}. Corrigiendo...`, 'warning');
        this.pc = nextPCCorrect;
        if (delaySlotEnabled) {
          this.flushPipelineOnlyIF(); // El delay slot en ID se conserva
        } else {
          this.flushPipelineBelowID();
        }
      }
    } else {
      //prediccion correcta, continuamos
      this.branchHitsCount++;
      this.addLog(`EX: Predicción ACERTADA en 0x${instr.pc.toString(16)}.`, 'success');
    }
  }

  /**
   * Helper para vaciar el pipeline completamente
   * @private
   */
  private flushPipeline() {
    if (this.pipeline.IF || this.pipeline.ID || this.pipeline.EX || this.pipeline.MEM) {
      this.controlHazardsCount++;
      this.addLog(`Riesgo de Control: Pipeline vaciado (Flush). Penalización aplicada.`, 'warning');
    }

    this.flushTimelineInstructions();

    this.pipeline.IF = null;
    this.pipeline.ID = null;
    this.pipeline.EX = null;
    this.pipeline.MEM = null;
    this.pipeline.WB = null;
  }

  /**
   * Helper para vaciar el pipeline antes de la etapa ID
   * @private
   */
  private flushPipelineBelowID() {
    if (this.pipeline.IF || this.pipeline.ID) {
      this.controlHazardsCount++;
      this.addLog(`Riesgo de Control: Pipeline vaciado (Flush). Penalización aplicada.`, 'warning');
      this.flushTimelineInstructions();
    }
    this.pipeline.IF = null;
    this.pipeline.ID = null;
  }

  /**
   * Helper para vaciar unicamente la etapa IF, manteniendo la instruccion que esta en ID (branch delay slot)
   * @private
   */
  private flushPipelineOnlyIF() {
    if (this.pipeline.IF) {
      this.controlHazardsCount++;
      this.addLog(`Riesgo de Control: Flush IF (delay slot en ID preservado).`, 'warning');
      const currentCycle = this.cycle();
      if (this.pipeline.IF.id !== undefined) {
        const entry = this.timelineIndex.get(this.pipeline.IF.id);
        if (entry) entry.flushed = true;
      }
    }
    this.pipeline.IF = null;
  }

  /**
   * Helper para marcar en el timeline instrucciones que han sido eliminadas por un flush
   * @private
   */
  private flushTimelineInstructions() {
    // Marcar instrucciones como flushed en el timeline
    const currentCycle = this.cycle();
    for (const instr of [this.pipeline.IF, this.pipeline.ID]) {
      if (instr && instr.id !== undefined) {
        const entry = this.timelineIndex.get(instr.id);
        if (entry) {
          entry.flushed = true;
          entry.stages[currentCycle] = 'FL';
        }
      }
    }
    // Notificar cambio en timeline
    this.timeline.update(rows => [...rows]);
  }

  /**
   * Helper para actualizar las estadisticas en cada ciclo
   * @private
   */
  private updateStats() {
    const cpi = this.instructionsFinishedCount > 0
      ? (this.cycle() / this.instructionsFinishedCount)
      : 0;

    // Total de stalls de datos
    const totalDataStalls = this.rawStallsCount + this.wawStallsCount +
      this.warStallsCount + this.structuralStallsCount;

    // % de ciclos que el procesador estuvo "parado" por riesgos
    const stallRate = this.cycle() > 0
      ? ((totalDataStalls / this.cycle()) * 100)
      : 0;

    const totalBranches = this.branchHitsCount + this.branchMissesCount;
    const branchHitRate = totalBranches > 0
      ? (this.branchHitsCount / totalBranches) * 100
      : 0;

    this.stats.set({
      controlHazards: this.controlHazardsCount,
      rawStalls: this.rawStallsCount,
      wawStalls: this.wawStallsCount,
      warStalls: this.warStallsCount,
      structuralStalls: this.structuralStallsCount,
      instructionsFinished: this.instructionsFinishedCount,
      cpi: parseFloat(cpi.toFixed(2)),
      stallRate: parseInt(stallRate.toFixed(1)),
      branchHits: this.branchHitsCount,
      branchMisses: this.branchMissesCount,
      branchHitRate: parseFloat(branchHitRate.toFixed(2))
    });
  }

  /**
   * Helper para actualizar el timeline
   * @private
   */
  private updateTimeline() {
    const currentCycle = this.cycle();
    const stageKeys: (keyof Pipeline)[] = ['IF', 'ID', 'EX', 'MEM', 'WB'];
    let hasNewRow = false;

    stageKeys.forEach(stageName => {
      const instr = this.pipeline[stageName];
      if (!instr || instr.id === undefined) return;

      let entry = this.timelineIndex.get(instr.id);

      if (!entry) {
        entry = {
          id: instr.id,
          pc: instr.pc,
          raw: instr.toString(),
          stages: {},
          completed: false,
          isVector: instr.isVector
        };
        this.timelineIndex.set(instr.id, entry);
        hasNewRow = true;
      }

      let label = stageName as string;
      if ((stageName === 'EX' || stageName === 'MEM') && instr.isVector) {
        if (instr.initDelay > 0) {
          // Latencia inicial: mostrar ciclos restantes entre corchetes
          label = `${stageName}[${instr.initDelay}]`;
        } else if (instr.currentElement < this.registerFile.vl()) {
          // Procesando elementos: mostrar elemento actual entre paréntesis
          label = `${stageName}(${instr.currentElement})`;
        } else if (instr.endDelay > 0) {
          // Latencia final: mostrar ciclos restantes entre corchetes
          label = `${stageName}[${instr.endDelay}]`;
        }
      }

      entry.stages[currentCycle] = label;

      if (stageName === 'WB') entry.completed = true;
    });

    // Si hay filas nuevas, reconstruimos el array desde el índice (una sola vez).
    // Si no, hacemos un update mínimo para notificar a Angular que las stages cambiaron.
    if (hasNewRow) {
      this.timeline.set(Array.from(this.timelineIndex.values()));
    } else {
      // update — necesario para que Angular evalúe los bindings de stages
      this.timeline.update(rows => [...rows]);
    }
  }

  /**
   * Procesa elementos vectoriales teniendo en cuenta el chaining (si esta habilitado) y el numero de lanes configuradas
   * @param instr
   * @param snapshot
   * @private
   */
  private processVectorElement(instr: AsgInstruction, snapshot: Pipeline) {
    // COMPROBACIÓN DE DISPONIBILIDAD (Sincronización de Lanes)
    // Comprobamos si hay alguna instrucción vectorial en el pipeline (EX o MEM) que produzca los registros que necesitamos (rs1, rs2)
    const canChain = this.checkChainingPossibility(instr, snapshot);

    if (!canChain) {
      this.addLog(`EX: Pausa en carril en ${instr.opcode} esperando datos (Chaining)`, 'warning');
      return;
    }

    const vl = this.registerFile.vl();
    const lanes = this.aluLanes();
    const startIdx = instr.currentElement;
    if (!instr.vectorResult) instr.vectorResult = new Float64Array(this.MVL);
    const op = instr.opcode.toUpperCase();

    // Simulamos el procesamiento paralelo de 'n' elementos por ciclo
    for (let l = 0; l < lanes; l++) {
      const i = startIdx + l;

      // Si ya procesamos todos los elementos del Vector Length, paramos
      if (i >= vl) break;

      // Aplicar máscara vectorial: saltar elementos inactivos
      if (!this.registerFile.isVectorMaskElementActive(i)) continue;

      let val1: number, val2: number;

      if (op.includes('SV')) {
        val1 = this.getForwardedValue(instr.rs1!, true, snapshot).value; // Fi
        val2 = this.getVectorElementValue(instr.rs2!, i, snapshot);      // Vj
      } else if (op.includes('VS')) {
        val1 = this.getVectorElementValue(instr.rs1!, i, snapshot);      // Vj
        // en estas operaciones siempre va a ser un escalar. detectado en test unitario el error
        val2 = this.getForwardedValue(instr.rs2!, true, snapshot).value; // Fi
      } else {
        // Caso Vector-Vector
        val1 = this.getVectorElementValue(instr.rs1!, i, snapshot);
        val2 = this.getVectorElementValue(instr.rs2!, i, snapshot);
      }

      // ALU Vectorial. TODO: sacar a un servicio propio
      let res = 0;
      let exception: ExceptionCode | null = null;

      switch (true) {
        case op.startsWith('ADD'):  res = val1 + val2; break;
        case op.startsWith('SUB'):  res = val1 - val2; break;
        case op.startsWith('MULT'): res = val1 * val2; break;
        case op.startsWith('DIV'): {
          if (val2 === 0) {
            exception = ExceptionCode.FP_DIVISION_BY_ZERO;
            res = 0;
          } else {
            res = val1 / val2;
          }
          break;
        }
        case op.startsWith('SEQ'):  res = val1 === val2 ? 1 : 0; break;
        case op.startsWith('SNE'):  res = val1 !== val2 ? 1 : 0; break;
        case op.startsWith('SGT'):  res = val1 >   val2 ? 1 : 0; break;
        case op.startsWith('SLT'):  res = val1 <   val2 ? 1 : 0; break;
        case op.startsWith('SGE'):  res = val1 >=  val2 ? 1 : 0; break;
        case op.startsWith('SLE'):  res = val1 <=  val2 ? 1 : 0; break;
        case op === 'CVI': {        // Vd[i] = i * Rs  (stride desde registro entero)
          const stride = this.getForwardedValue(instr.rs1!, false, snapshot).value;
          res = i * stride;
          break;
        }
        case op === 'CVM':          res = 1; break;
        default:
          this.addLog(`Opcode no implementado en EX vectorial: ${op}`, 'error');
      }

      // Verificar excepciones FP y Overflow
      if (!exception) {
        if (isNaN(res)) {
          exception = ExceptionCode.FP_INVALID_OPERATION;
        } else if (!isFinite(res)) {
          exception = ExceptionCode.FP_OVERFLOW;
        } else if (res !== 0 && Math.abs(res) < Number.MIN_VALUE) {
          // FP Underflow: resultado no es cero pero es más pequeño que el mínimo representable
          exception = ExceptionCode.FP_UNDERFLOW;
        } /*else if (!op.includes('F') && !op.includes('D')) {
          // Truncar a 32 bits para detectar overflow entero
          const res32 = res | 0;
          if (res !== res32) exception = ExceptionCode.ARITHMETIC_OVERFLOW;
        }*/
      }

      if (exception) {
        instr.hasException = true;
        instr.exceptionCode = exception;
      }

      instr.vectorResult[i] = res;

      // ACTUALIZACIÓN DE STATUS PARA CHAINING
      // Cada vez que un carril termina un elemento, notificamos que ese elemento está listo para que otra instrucción en EX o MEM lo pueda usar.
      if (instr.rd !== undefined) {
        this.registerFile.setVectorRegisterStatus(instr.rd, {
          instrId: instr.id!,
          lastElementReady: i
        });
      }
    }

    instr.currentElement += lanes;

    // Si terminamos el vector, el pipeline avanzará esta instrucción a MEM en el siguiente ciclo, meto un log
    if (instr.currentElement >= vl)
      this.addLog(`EX: Instrucción ${instr.opcode} completó sus ${vl} elementos`, 'success');
  }

  /**
   * Obtiene el valor de un registro vectorial
   * @param regIdx
   * @param elementIdx
   * @param snapshot
   * @private
   */
  private getVectorElementValue(regIdx: number, elementIdx: number, snapshot: Pipeline): number {
    // V0 en arquitectura vectorial suele ser el vector cero
    //if (regIdx === 0) return 0.0;

    // Si el Chaining está desactivado, leo directamente del banco de registros.
    if (!this.isChainingEnabled())
      return this.registerFile.readVectorElement(regIdx, elementIdx);

    // CHAINING DESDE MEM: Compruebo si la instruccion actualmente en MEM está produciendo este registro
    const instrInMEM = this.pipeline.MEM;
    if (instrInMEM && instrInMEM.isVector && instrInMEM.rd === regIdx) {
      // Si ya procesó el elemento que necesitamos, recuperamos el dato directamente de la etapa MEM
      if (elementIdx < instrInMEM.currentElement)
        return instrInMEM.vectorResult![elementIdx];
    }

    // CHAINING DESDE WB: Compruebo si la instruccion actualmente en WB está produciendo este registro
    const instrInWB = this.pipeline.WB;
    if (instrInWB && instrInWB.isVector && instrInWB.rd === regIdx)
      return instrInWB.vectorResult![elementIdx]; //si esta en WB tiene el vector completo, por lo que entendemos que no hay que comprobar si el currentElement es mayor que el actual aqui

    // CHAINING EX - MEM. Solo si el que pide el dato es una instrucción en MEM (como SV) y el productor está en EX.
    const instrInEX = snapshot.EX;
    if (instrInEX && instrInEX.isVector && instrInEX.rd === regIdx) {
      // Evitamos que una instrucción en EX se lea a sí misma
      const isSelfLookup = this.pipeline.EX?.id === instrInEX.id;
      // Si el elemento ya fue procesado en EX, lo devolvemos
      if (!isSelfLookup && elementIdx < instrInEX.currentElement)
        return instrInEX.vectorResult![elementIdx];
    }

    // Por ultimo, si no hemos obtenido el dato con forwarding leemos del banco de registros
    return this.registerFile.readVectorElement(regIdx, elementIdx);
  }

  /**
   * Determina si una instrucción puede procesar elementos vectoriales. Implementa la lógica de Chaining y detección de Riesgos Estructurales.
   * @param instrID
   * @param snapshot
   * @param fromStage 'ID' para verificación completa, 'MEM' solo chaining de datos
   * @private
   */
  private checkChainingPossibility(instrID: AsgInstruction, snapshot: Pipeline, fromStage: 'ID' | 'MEM' = 'ID'): boolean {
    // toda instrucción vectorial consulta la máscara en EX, pero la máscara solo se actualiza en WB (comparaciones,
    // así que una instrucción podría leer una máscara todavía no actualizada por una comparación inmediatamente anterior que aún estuviera en EX o MEM.
    // lo comprobamos aqui: detectado en test unitario
    if (instrID.isVector) {
      const isVMWriter = (i: AsgInstruction | null): boolean =>
        i !== null && i.id !== instrID.id && ((i.isVector && i.config.argNum === 2 && i.opcode !== 'CVI') || i.opcode === 'CVM' || i.opcode === 'MOVF2S');

      // si la comprobación viene desde MEM, la propia instrucción ya está en MEM, asi que la que haya en EX es mas nueva y no hay que comprobarla. Desde ID si hay que mirar ambas etapas
      const blockedByEX = fromStage !== 'MEM' && isVMWriter(snapshot.EX);
      if (blockedByEX || isVMWriter(snapshot.MEM)) {
        this.addLog(`Chaining Stall: ${instrID.opcode} espera a que la máscara vectorial (VM) se actualice`, 'warning');
        return false;
      }
    }

    // Determinar los lanes según el tipo de instrucción
    const opcode = instrID.opcode.toUpperCase();
    const isMemoryOp = ['LV', 'SV', 'LVWS', 'SVWS', 'LVI', 'SVI'].includes(opcode);
    const lanes = isMemoryOp ? this.memoryLanes() : this.aluLanes();

    // Determinar qué registros son VECTORIALES según el opcode
    const vectorRegsToRead: number[] = [];

    if (['LV', 'LVWS', 'LVI'].includes(opcode)) {
      // Loads vectoriales: rd es vectorial, rs2 es base (escalar), NO verificar rs1/rs2
      // Para LVI: imm es vector de índices
      if (opcode === 'LVI' && instrID.imm !== undefined) {
        vectorRegsToRead.push(instrID.imm);
      }
    } else if (['SV', 'SVWS', 'SVI'].includes(opcode)) {
      // Stores vectoriales: rs2 es vector fuente, rs1 es base (escalar)
      if (instrID.rs2 !== undefined) vectorRegsToRead.push(instrID.rs2);
      // Para SVI: imm es vector de índices
      if (opcode === 'SVI' && instrID.imm !== undefined) {
        vectorRegsToRead.push(instrID.imm);
      }
    } else if (opcode.includes('SV') /*&& !opcode.startsWith('S')*/) {
      // Escalar-Vector (ADDSV, etc.): rs1=escalar, rs2=vector
      if (instrID.rs2 !== undefined) vectorRegsToRead.push(instrID.rs2);
    } else if (opcode.includes('VS') || opcode.includes('VI')) {
      // Vector-Escalar (ADDVS) o Vector-Inmediato: rs1=vector, rs2=escalar/imm
      if (instrID.rs1 !== undefined) vectorRegsToRead.push(instrID.rs1);
    } else if (instrID.isVector) {
      // Vector-Vector: ambos son vectoriales
      if (instrID.rs1 !== undefined) vectorRegsToRead.push(instrID.rs1);
      if (instrID.rs2 !== undefined) vectorRegsToRead.push(instrID.rs2);
    }

    for (const regIdx of vectorRegsToRead) {
      if (regIdx === 0) continue;

      const status = this.registerFile.getVectorRegisterStatus(regIdx);
      if (!status) continue; // El registro no está siendo escrito por nadie

      // IMPORTANTE: Si el productor es la propia instrucción, continuamos
      if (status.instrId === instrID.id) continue;

      // buscamos quien esta escribiendo el registro en estos momentos
      const producerInEX = snapshot.EX?.id === status.instrId ? snapshot.EX : null;
      const producerInMEM = snapshot.MEM?.id === status.instrId ? snapshot.MEM : null;
      const producer = producerInEX || producerInMEM;

      if (producer) {
        if (this.isChainingEnabled()) {
          // Aqui es necesario que el productor haya terminado al menos hasta el elemento que este carril va a consumir. Si la instrucción va a procesar elementos [0,1,2,3], necesita que el elemento 3 esté listo.
          // si VL no es múltiplo de lanes, el último tramo procesa menos elementos de los que caben en el carril, si no el stall pide un elemento que ningún productor va a dar nunca, parando en bucle infinito.
          const neededElement = Math.min(instrID.currentElement + lanes, this.registerFile.vl()) - 1;
          if (status.lastElementReady < neededElement) {
            this.addLog(`Chaining Stall: V${regIdx} solo tiene listo hasta el elem ${status.lastElementReady}, necesito ${neededElement}`, 'warning');
            return false; // Stall: No hay suficientes datos para llenar los Lanes este ciclo
          }
        } else {
          // Sin chaining necesitamos el vector completo. Si la instrucción productora sigue en EX o MEM, significa que el vector aun no se ha terminado de calcular. No podemos empezar nada.
          this.addLog(`Chaining Stall: V${regIdx} no está listo aún`, 'warning');
          return false; // Stall estricto hasta que la anterior desaparezca
        }
      }
    }

    // RIESGO ESTRUCTURAL: Solo verificar desde ID (no desde MEM). Si la unidad funcional está ocupada por una instrucción multi-ciclo
    if (fromStage === 'ID' && snapshot.EX && !snapshot.EX.isVector && snapshot.EX.cyclesRemaining > 0)
      return false;

    return true;
  }

  /**
   * Método para procesar elementos de memoria vectorial.
   * @param instr
   * @param snapshot
   * @private
   */
  private processVectorMemoryElement(instr: AsgInstruction, snapshot: Pipeline) {
    const lanes = this.memoryLanes(); // Usamos la configuración de memoria
    const vl = this.registerFile.vl();
    const startIdx = instr.currentElement;

    // COMPROBACIÓN DE DISPONIBILIDAD (Sincronización de Lanes)
    // Verificar chaining , no verifica riesgos estructurales aqui (ya se hizo en ID)
    const canChain = this.checkChainingPossibility(instr, snapshot, 'MEM');

    if (!canChain) {
      this.addLog(`MEM: Pausa en carril en ${instr.opcode} esperando datos vectoriales (Chaining)`, 'warning');
      return;
    }

    for (let l = 0; l < lanes; l++) {
      const i = startIdx + l;
      if (i >= vl) break;

      // Aplicar máscara vectorial: saltar elementos inactivos
      if (!this.registerFile.isVectorMaskElementActive(i)) continue;

      // Calculamos la dirección según el tipo de acceso vectorial
      let addr: number;
      switch (instr.opcode) {
        case 'LVWS':
        case 'SVWS': {
          // Acceso con stride: addr[i] = base + stride * i
          const stride = (instr as any).strideValue ?? 8;
          addr = instr.result! + stride * i;
          break;
        }
        case 'LVI':
        case 'SVI': {
          // Gather/Scatter: addr[i] = base + indices[i]
          // Obtenemos el índice elemento a elemento permitiendo Chaining
          const index = this.getVectorElementValue(instr.imm!, i, this.pipeline);
          addr = instr.result! + index;
          break;
        }
        default:
          // LV / SV: acceso secuencial con stride de 8 bytes
          addr = instr.result! + i * 8;
      }

      const isLoad = instr.opcode === 'LV' || instr.opcode === 'LVWS' || instr.opcode === 'LVI';
      if (isLoad) {
        if (!instr.vectorResult) instr.vectorResult = new Float64Array(this.MVL);
        instr.vectorResult[i] = this.safeReadMemory('DATA', instr.opcode, addr, 8, true, instr);
        if (instr.rd !== undefined)
          this.registerFile.setVectorRegisterStatus(instr.rd, { instrId: instr.id!, lastElementReady: i });
        this.addLog(`MEM: Cargado elemento ${i} de V${instr.rd} desde 0x${addr.toString(16)}`, 'info');
      } else {
        // SV / SVWS / SVI
        const value = this.getVectorElementValue(instr.rs2!, i, this.pipeline);
        this.safeWriteMemory('DATA', addr, value, 8, instr);
        this.addLog(`MEM: Guardado elemento ${i} en 0x${addr.toString(16)}`, 'info');
      }
    }

    instr.currentElement += lanes;
  }
}
