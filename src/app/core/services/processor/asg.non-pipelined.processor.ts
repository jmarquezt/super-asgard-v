import { Injectable, signal } from '@angular/core';
import {CODE_BASE, EXCEPTION_TO_VECTOR, ExceptionCode, VECTOR_ENTRY_SIZE} from '../../models/asg.exceptions';
import { Pipeline } from '../../models/asg.models';
import {getConfiguredLatency} from '../../models/asg.config'
import {AsgInstruction} from '../../models/instructions/asg.instruction';
import {AsgInstructionFactoryService} from '../assembly/asg.instruction-factory';
import {MemoryAlignmentError} from '../asg.memory';
import {AsgProcessorService} from './asg.processor';

/**
 * Servicio del Procesador No-Segmentado (Non-Pipelined)
 *
 * Es idéntico al procesador segmentado pero monociclo.
 * Cada instrucción completa todas sus etapas (IF, ID, EX, MEM, WB) antes de que la siguiente instrucción comience.
 *
 * - Sin hazards: no hay solapamiento de instrucciones
 * - CPI base = 5 (para instrucciones simples)
 * - Instrucciones con latencia (MULT, DIV, etc.) generan ciclos adicionales en la etapa EX
 * - Las estadísticas son compatibles con el procesador segmentado, pero mas reducidas
 */
@Injectable({ providedIn: 'root' })
export class AsgNonPipelinedProcessorService extends AsgProcessorService {

  //estado del pipeline
  pipeline: Pipeline = { IF: null, ID: null, EX: null, MEM: null, WB: null };
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

  private instructionsFinishedCount = 0;
  // Etapa actual de la instruccion en curso
  private currentStage: string  = 'IDLE';
  // Instruccion actual en curso
  private currentInstr: AsgInstruction | null = null;

  constructor() {
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

  /**
   * Método para cargar el procesador inicialmente y prepararlo para la ejecución
   * @param instructions
   * @param dataMemory
   * @param initialCodePtr
   * @param pcToLine
   */
  override load(instructions: Uint8Array, dataMemory: Uint8Array, initialCodePtr: number = CODE_BASE, pcToLine?: Map<number, number>) {
    this.instructionsMemory.set(instructions);
    this.dataMemory.load(dataMemory);
    this.pc = initialCodePtr;
    this.cycle.set(0);
    this.finished.set(false);
    // Limpiar el pipeline para empezar de cero
    this.pipeline = { IF: null, ID: null, EX: null, MEM: null, WB: null };
    this.pcToLine = pcToLine ?? new Map();
    this.currentStage = 'IDLE';
    this.currentInstr = null;
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
   * Método que simula un ciclo de reloj
   */
  override nextCycle(): void {
    this.logService.beginCycle();
    this.cycle.update((c) => c + 1);

    // En modo no-segmentado, ejecutamos una etapa por ciclo para la instrucción actual
    switch (this.currentStage) {
      case 'IDLE':
        // No hay instrucción en curso, intentar fetch
        this.doIF();
        break;

      case 'IF':
        // La instrucción fue capturada, pasar a decode
        this.doID();
        break;

      case 'ID':
        // Decodificada, pasar a execute
        this.doEX();
        break;

      case 'EX':
      case 'EX-LATENCY':
        // Si es una ejecucion con latencia, volver a ejecutar EX
        if (this.currentStage === 'EX-LATENCY') {
          this.doEX(); // Continuar procesando elementos
        } else {
          //avanzar a memoria
          this.doMEM(); // Todos los elementos procesados
        }
        break;

      case 'MEM':
      case 'MEM-LATENCY':
        if (this.currentStage === 'MEM-LATENCY') {
          //latencia de memorias
          this.doMEM(); // Continuar procesando elementos
        } else {
          //pasamos a wb
          this.doWB(); // Todos los elementos procesados
          // Completar la instrucción inmediatamente en el mismo ciclo
          this.completeInstruction();
        }
        break;

      case 'WB':
        // Instricccion completada, limpio el pipe y las variables auxiliares de instruccion actual y current stage
        this.pipeline.WB = null;
        this.currentStage = 'IDLE';
        this.currentInstr = null;
        // Intentar fetch de la siguiente instrucción
        this.doIF();
        break;
    }

    this.updateTimeline();
    this.logService.flushLogs();
  }

  /**
   * Verifica si el procesador ha terminado la ejecución.
   * Se considera terminado si:
   * 1. El PC apunta más allá de la última instrucción del programa.
   * 2. El pipeline esta en idle y no hay instruccion actual
   */
  override isFinished(): boolean {
    // Comprobar si el PC ha superado la última instrucción disponible
    const noMoreInstructions = this.instructionsMemory.at(this.pc) === undefined;
    const nothingInProgress = this.currentStage === 'IDLE' && this.currentInstr === null;

    return noMoreInstructions && nothingInProgress;
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
      if (res !== 0 && Math.abs(res) < Number.MIN_VALUE) return ExceptionCode.FP_UNDERFLOW;
      return null;
    };

    switch (instr.opcode) {
      // Aritmetcia entera
      case 'ADD': {
        const res = (val1 + val2) | 0;
        // Detección de overflow en suma con signo:
        // Si los operandos tienen el mismo signo y el resultado tiene signo contrario marca excepcion
        if (((val1 ^ res) & (val2 ^ res)) < 0) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.ARITHMETIC_OVERFLOW;
        }
        instr.result = res;
        break;
      }
      case 'ADDI': {
        const res = (val1 + imm) | 0;
        // Detección de overflow en suma inmediata con signo
        if (((val1 ^ res) & (imm ^ res)) < 0) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.ARITHMETIC_OVERFLOW;
        }
        instr.result = res;
        break;
      }
      case 'SUB': {
        const res = (val1 - val2) | 0;
        // Detección de overflow en resta con signo:
        // Si los operandos tienen signos distintos y el signo del resultado es distinto al de val1 marca excepcion
        if (((val1 ^ val2) & (val1 ^ res)) < 0) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.ARITHMETIC_OVERFLOW;
        }
        instr.result = res;
        break;
      }
      case 'SUBI': {
        const res = (val1 - imm) | 0;
        if (((val1 ^ imm) & (val1 ^ res)) < 0) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.ARITHMETIC_OVERFLOW;
        }
        instr.result = res;
        break;
      }
      case 'MULT':
        instr.result = Math.floor(val1 * val2);
        break;
      case 'MULTI':
        instr.result = Math.floor(val1 * imm);
        break;
      case 'DIV':
        // excepcion en division por 0
        if (val2 === 0) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.DIVISION_BY_ZERO;
          instr.result = 0;
        } else {
          instr.result = Math.floor(val1 / val2);
        }
        break;
      case 'DIVI':
        // excepcion en division por 0
        if (imm === 0) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.DIVISION_BY_ZERO;
          instr.result = 0;
        } else {
          instr.result = Math.floor(val1 / imm);
        }
        break;

      // ARITMETICA ENTERA SIN SIGNO
      case 'ADDU':
        instr.result = ((val1 >>> 0) + (val2 >>> 0)) >>> 0;
        break;
      case 'ADDUI':
        instr.result = ((val1 >>> 0) + (imm >>> 0)) >>> 0;
        break;
      case 'SUBU':
        instr.result = ((val1 >>> 0) - (val2 >>> 0)) >>> 0;
        break;
      case 'SUBUI':
        instr.result = ((val1 >>> 0) - (imm >>> 0)) >>> 0;
        break;
      case 'MULTU':
        instr.result = (val1 >>> 0) * (val2 >>> 0);
        break;
      case 'DIVU':
        // division por 0 con errores
        if (val2 === 0) {
          instr.hasException = true;
          instr.exceptionCode = ExceptionCode.DIVISION_BY_ZERO;
          instr.result = 0;
        } else {
          instr.result = Math.floor((val1 >>> 0) / (val2 >>> 0)) >>> 0;
        }
        break;
      // DESPLAZAMIENTOS
      case 'SLL':
        instr.result = (val1 << val2) >>> 0;
        break;
      case 'SLLI':
        instr.result = (val1 << imm) >>> 0;
        break;
      case 'SRL':
        instr.result = (val1 >>> val2);
        break;
      case 'SRLI':
        instr.result = (val1 >>> imm);
        break;
      case 'SRA':
        instr.result = (val1 >> val2);
        break;
      case 'SRAI':
        instr.result = (val1 >> imm);
        break;

      // ARITMETICA FLOTANTE SIMPLE Y DOBLE
      // Precision simple (SP): aplicar Math.fround para consistencia con Float32Array
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
      // Doble precision (DP): mantener 64-bit completo
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
      // Comparaciones enteras R-R
      // Iguales
      case 'SEQ':
        instr.result = (val1 | 0) === (val2 | 0) ? 1 : 0;
        break;
      // Distintos
      case 'SNE':
        instr.result = (val1 | 0) !== (val2 | 0) ? 1 : 0;
        break;
      // Mayor que (Greater Than)
      case 'SGT':
        instr.result = (val1 | 0) > (val2 | 0) ? 1 : 0;
        break;
      // Mayor o igual (Greater Than or Equal)
      case 'SGE':
        instr.result = (val1 | 0) >= (val2 | 0) ? 1 : 0;
        break;
      // Menor que (Less Than)
      case 'SLT':
        instr.result = (val1 | 0) < (val2 | 0) ? 1 : 0;
        break;
      // Menor o igual (Less Than or Equal)
      case 'SLE':
        instr.result = (val1 | 0) <= (val2 | 0) ? 1 : 0;
        break;
      // Comparaciones enteras unsigned
      //iguales unsigned
      case 'SEQU':
        instr.result = (val1 >>> 0) === (val2 >>> 0) ? 1 : 0;
        break;
      // Distintos unsigned
      case 'SNEU':
        instr.result = (val1 >>> 0) !== (val2 >>> 0) ? 1 : 0;
        break;
      // Mayor que (Greater Than) unsigned
      case 'SGTU':
        instr.result = (val1 >>> 0) > (val2 >>> 0) ? 1 : 0;
        break;
      // Mayor o igual (Greater Than or Equal) unsigned
      case 'SGEU':
        instr.result = (val1 >>> 0) >= (val2 >>> 0) ? 1 : 0;
        break;
      // Menor que (Less Than) unsigned
      case 'SLTU':
        instr.result = (val1 >>> 0) < (val2 >>> 0) ? 1 : 0;
        break;
      // Menor o igual (Less Than or Equal) unsigned
      case 'SLEU':
        instr.result = (val1 >>> 0) <= (val2 >>> 0) ? 1 : 0;
        break;
      // Comparaciones inmediatas con signo
      case 'SEQI':
        instr.result = (val1 | 0) === (imm | 0) ? 1 : 0;
        break;
      case 'SNEI':
        instr.result = (val1 | 0) !== (imm | 0) ? 1 : 0;
        break;
      case 'SGTI':
        instr.result = (val1 | 0) > (imm | 0) ? 1 : 0;
        break;
      case 'SGEI':
        instr.result = (val1 | 0) >= (imm | 0) ? 1 : 0;
        break;
      case 'SLTI':
        instr.result = (val1 | 0) < (imm | 0) ? 1 : 0;
        break;
      case 'SLEI':
        instr.result = (val1 | 0) <= (imm | 0) ? 1 : 0;
        break;
      // Comparaciones inmediatas sin signo
      //iguales  unsigned
      case 'SEQUI':
        instr.result = (val1 >>> 0) === (imm >>> 0) ? 1 : 0;
        break;
      // Distintos unsigned
      case 'SNEUI':
        instr.result = (val1 >>> 0) !== (imm >>> 0) ? 1 : 0;
        break;
      // Mayor que (Greater Than) unsigned
      case 'SGTUI':
        instr.result = (val1 >>> 0) > (imm >>> 0) ? 1 : 0;
        break;
      // Mayor o igual (Greater Than or Equal) unsigned
      case 'SGEUI':
        instr.result = (val1 >>> 0) >= (imm >>> 0) ? 1 : 0;
        break;
      // Menor que (Less Than) unsigned
      case 'SLTUI':
        instr.result = (val1 >>> 0) < (imm >>> 0) ? 1 : 0;
        break;
      // Menor o igual (Less Than or Equal) unsigned
      case 'SLEUI':
        instr.result = (val1 >>> 0) <= (imm >>> 0) ? 1 : 0;
        break;
      // Comparaciones flotantes simples y dobles -> actualizan el FP bit condition del procesador
      case 'EQF':
      case 'EQD':
        instr.result = this.registerFile.setFPCondition(val1 === val2);
        break;
      case 'NEF':
      case 'NED':
        instr.result = this.registerFile.setFPCondition(val1 !== val2);
        break;
      case 'LTF':
      case 'LTD':
      case 'SLTD':
      case 'SLTF':
        instr.result = this.registerFile.setFPCondition(val1 < val2);
        break;
      case 'GTF':
      case 'GTD':
      case 'SGTD':
      case 'SGTF':
        instr.result = this.registerFile.setFPCondition(val1 > val2);
        break;
      case 'LEF':
      case 'LED':
      case 'SLED':
      case 'SLEF':
        instr.result = this.registerFile.setFPCondition(val1 <= val2);
        break;
      case 'GEF':
      case 'GED':
      case 'SGED':
      case 'SGEF':
        instr.result = this.registerFile.setFPCondition(val1 >= val2);
        break;
      // Conversiones sobre registros float
      // Precision simple a precision doble
      case 'CVTF2D':
        instr.result = val1;
        break;
      // Entero a doble (dos registros) o simple (un registro)
      case 'CVTI2D':
      case 'CVTI2F': {
        // El registro float contiene un entero (movido con MOVI2FP).
        // val1 tiene los bits interpretados como float. Recuperamos el entero original.
        const buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, val1, false);
        instr.result = new DataView(buf).getInt32(0, false);
        break;
      }
      //Convierte doble precision a simple precison
      case 'CVTD2F':
        instr.result = Math.fround(val1);
        break;
      // convierte doble y simple precision a entero
      case 'CVTF2I':
      case 'CVTD2I':
        instr.result = Math.trunc(val1) | 0;
        break;
      // Movimientos entre registros
      case 'MOVF': // Mueve registros simple precision
      case 'MOVD': // Mueve registros doble precision
      case 'MOVI2S':  // val1 = Rs → WB escribe en VLR
      case 'MOVF2S':  // val1 = Fs → WB reinterpreta bits como bitmask de VM
        instr.result = val1;
        break;
      // Mueve un entero a precision simple copiando bits sin conversion
      case 'MOVI2FP': {
        const buf = new ArrayBuffer(4);
        new DataView(buf).setInt32(0, val1 | 0, false);
        instr.result = new DataView(buf).getFloat32(0, false);
        break;
      }
      // Mueve simple precision a entero copiando bits sin conversion
      case 'MOVFP2I': {
        const buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, val1, false);
        instr.result = new DataView(buf).getInt32(0, false);
        break;
      }
      // Mueve un registro especial (VL) a un registro entero
      case 'MOVS2I':  // Rd ← VLR
        instr.result = this.registerFile.vl();
        break;
      // Mueve la mascara VM de vector a un registro simple precision
      case 'MOVS2F': {
        let mask = 0;
        const vm = this.registerFile.vectorMask();
        for (let i = 0; i < 32; i++) {
          if (vm[i] !== 0) mask |= (1 << i);
        }
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
      // Saltos
      case 'J':
        this.resolveBranch(instr, true, imm * 4);
        break;
      case 'JAL':
        instr.rd = 31;           // Enlace: R31 = dirección de retorno
        instr.result = instr.pc + 4; // PC de la instrucción siguiente a JAL como resultado
        this.resolveBranch(instr, true, imm * 4);
        break;
      case 'JR':
        this.resolveBranch(instr, true, val1);
        break;
      case 'JALR':
        instr.rd = 31;           // Enlace: R31 = dirección de retorno
        instr.result = instr.pc + 4; // PC de la instrucción siguiente a JALR como resultado
        this.resolveBranch(instr, true, val1);
        break;
      // Branchs
      case 'BEQZ':
        this.resolveBranch(instr, (val1 | 0) === 0, imm * 4);
        break;
      case 'BNEZ':
        this.resolveBranch(instr, (val1 | 0) !== 0, imm * 4);
        break;
      case 'BGTZ':
        this.resolveBranch(instr, (val1 | 0) > 0, imm * 4);
        break;
      case 'BLTZ':
        this.resolveBranch(instr, (val1 | 0) < 0, imm * 4);
        break;
      case 'BFPT':
        this.resolveBranch(instr, this.registerFile.fpConditionBit() === 1, imm * 4);
        break;
      case 'BFPF':
        this.resolveBranch(instr, this.registerFile.fpConditionBit() === 0, imm * 4);
        break;
      // Logica
      case 'AND':
        instr.result = (val1 & val2) | 0;
        break;
      case 'OR':
        instr.result = (val1 | val2) | 0;
        break;
      case 'XOR':
        instr.result = (val1 ^ val2) | 0;
        break;
      // Logica inmediata, trantando el inmediato como unsigned
      case 'ANDI':
        instr.result = (val1 & (imm & 0xFFFF)) | 0;
        break;
      case 'ORI':
        instr.result = (val1 | (imm & 0xFFFF)) | 0;
        break;
      case 'XORI':
        instr.result = (val1 ^ (imm & 0xFFFF)) | 0;
        break;
      // Carga desde memoria, calculo de la direccion
      case 'LB':
      case 'LBU':
      case 'LH':
      case 'LHU':
      case 'LW':
      case 'LF':
      case 'LD':
        instr.result = (val2 + imm) | 0; // Dirección base + offset
        break;
      case 'LHI':
        // Coloca el inmediato en los 16 bits superiores y pone a 0 los inferiores
        instr.result = (imm << 16) | 0;
        break;
      // Almacenamientos, calculo de las direcciones
      case 'SB':
      case 'SH':
      case 'SW':
      case 'SF':
      case 'SD':
        instr.result = (val1 + imm) | 0; // Dirección base + offset
        break;
      case 'NOP':
        instr.result = 0;
        break;
      case 'TRAP':
        this.executeTrap(instr, val1);
        break;
      case 'RFE':
        // Return From Exception: restaura el PC desde IAR y vacía el pipeline
        this.pc = this.iar() + 4;
        this.cause.set(''); // Limpiar causa de excepcion
        this.currentStage = 'IF';
        this.addLog(`RFE: retornando a 0x${this.pc.toString(16)} (IAR)`, 'info');
        break;
    }
  }

  /**
   * Etapa IF
   * @private
   */
  private doIF() {
    // Verificar si hay más instrucciones
    if (this.instructionsMemory.at(this.pc) === undefined) {
      this.currentStage = 'IDLE';
      this.currentInstr = null;
      return;
    }

    const word = this.safeReadMemory('INST', 'IF', this.pc, 4);
    const instr = AsgInstructionFactoryService.decode(word, this.pc, this.cycle());

    if (instr) {
      // Aplicar latencia configurada
      const cfgLatency = getConfiguredLatency(instr.opcode, this.configService.getCurrentConfig().latencies);
      if (cfgLatency !== undefined)
        instr.setCyclesRemaining(cfgLatency);

      this.currentInstr = instr;
      this.pipeline.IF = instr;
      this.addLog(`IF: Capturada instrucción ${instr.opcode} en PC=0x${this.pc.toString(16)}`, 'info');
      this.currentStage = 'IF';
      this.pc += 4; // Flujo secuencial
    } else {
      this.currentStage = 'IDLE';
    }
  }

  /**
   * Etapa ID
   * @private
   */
  private doID() {
    if (!this.currentInstr) return;

    this.pipeline.IF = null;
    this.pipeline.ID = this.currentInstr;
    this.addLog(`ID: Decodificando ${this.currentInstr.opcode}`, 'info');

    this.currentStage = 'ID';
  }

  /**
   * Etapa EX
   * TODO: eliminar comprobaciones a mano de instrucciones
   * @private
   */
  private doEX() {
    if (!this.currentInstr) return;

    this.pipeline.ID = null;
    this.pipeline.EX = this.currentInstr;
    const instr = this.currentInstr;

    if (instr.isVector) {

      // Las operaciones de memoria vectorial: calcular dirección en EX y pasar a MEM
      if (['LV', 'SV', 'LVWS', 'SVWS', 'LVI', 'SVI'].includes(instr.opcode)) {
        const op = instr.opcode;
        // Calcular dirección base (solo una vez, en EX)
        if (instr.result === undefined) {
          if (op === 'LV') {
            // LV: base en rs2, offset en imm
            const baseReg = this.getRegisterValue(instr, instr.rs2!, false);
            const offset = instr.imm ?? 0;
            instr.result = (baseReg + offset) | 0;
          } else if (op === 'LVWS') {
            // LVWS: base en rs2, stride en registro imm
            instr.result = this.getRegisterValue(instr, instr.rs2!, false) | 0;
            const strideReg = instr.imm ?? 0;
            (instr as any).strideValue = this.getRegisterValue(instr, strideReg, false);
          } else if (op === 'LVI') {
            // LVI: base en rs2, índices en registro vectorial imm
            instr.result = this.getRegisterValue(instr, instr.rs2!, false) | 0;
            const indexReg = instr.imm ?? 0;
            (instr as any).vectorIndices = this.registerFile.readVectorRegister(indexReg);
          } else if (op === 'SV') {
            // SV: base en rs1, offset en imm
            const baseReg = this.getRegisterValue(instr, instr.rs1!, false);
            const offset = instr.imm ?? 0;
            instr.result = (baseReg + offset) | 0;
          } else if (op === 'SVWS') {
            // SVWS: base en rs1, stride en registro imm
            instr.result = this.getRegisterValue(instr, instr.rs1!, false) | 0;
            const strideReg = instr.imm ?? 0;
            (instr as any).strideValue = this.getRegisterValue(instr, strideReg, false);
          } else if (op === 'SVI') {
            // SVI: base en rs1, índices en registro vectorial imm
            instr.result = this.getRegisterValue(instr, instr.rs1!, false) | 0;
            const indexReg = instr.imm ?? 0;
            (instr as any).vectorIndices = this.registerFile.readVectorRegister(indexReg);
          }

          instr.currentElement = 0;
        }
        this.currentStage = 'EX';
        return;
      }

      // Latencia de arranque (startup latency): consumir ciclos antes de procesar elementos
      if (instr.initDelay > 0) {
        // cyclesRemaining actúa como marcador: solo decrementamos initDelay después del primer ciclo
        if (instr.cyclesRemaining < instr.initDelay)
          instr.initDelay--;

        instr.cyclesRemaining--;
        if (instr.initDelay > 0) {
          this.addLog(`${instr.opcode} latencia de arranque: faltan ${instr.initDelay} ciclos`, 'info');
          this.currentStage = 'EX-LATENCY';
          return;
        }
      }

      // Una vez consumida la latencia, procesar elementos
      this.processVectorElement(instr);

      // Si aún faltan elementos por procesar, la instrucción SE QUEDA en EX
      if (instr.currentElement < this.registerFile.vl()) {
        this.addLog(`${instr.opcode} procesando elemento ${instr.currentElement}/${this.registerFile.vl()}`, 'info');
        this.currentStage = 'EX-LATENCY';
        return;
      }

    } else {
      // Manejo de latencia (instrucciones multi-ciclo como MUL.D)
      if (instr.cyclesRemaining > 1) {
        this.addLog(`${instr.opcode} en EX: faltan ${instr.cyclesRemaining} ciclos`, 'info');
        instr.cyclesRemaining--;
        this.currentStage = 'EX-LATENCY';
        return;
      }

      // RESOLUCIÓN DE OPERANDOS
      let v1 = 0;
      let v2 = 0;

      // RESOLVER OPERANDO 1 (Solo si rs1 está definido)
      if (instr.rs1 !== undefined)
        v1 = this.getRegisterValue(instr, instr.rs1!, instr.isFloatOrigin);

      // Si la instrucción tiene un inmediato (y no es un salto ni memoria), usamos el inmediato.
      // Si no, buscamos el valor del registro rs2 con adelantamiento.
      if (instr.imm !== undefined && !['BNEZ', 'BGTZ', 'BLTZ', 'J', 'JUMP', 'LW', 'LD', 'LF', 'SW', 'SD', 'SF', 'LH', 'LHU', 'LB', 'LBU', 'SH', 'SB', 'LHI'].includes(instr.opcode)) {
        v2 = instr.imm;
      } else if (instr.rs2 !== undefined) {
        // En cargas de memoria (LD, LF, LW) rs2 es el registro BASE, siempre entero, aunque la instrucción opere con datos float/double.
        const isLoadOp = ['LW', 'LD', 'LF', 'LH', 'LHU', 'LB', 'LBU'].includes(instr.opcode);
        v2 = this.getRegisterValue(instr, instr.rs2!, isLoadOp ? false : instr.isFloat);
      }

      // TRAP 3 hay que esperar por la entrada del usuario
      if (instr.opcode === 'TRAP' && instr.imm === 3) {
        const fd  = this.safeReadMemory('DATA', 'TRAP', v1, 4, true, instr);
        if (fd === 0 && instr.result === undefined) {
          const bufAddr  = this.safeReadMemory('DATA', 'TRAP', v1 + 4, 4, true, instr);
          const maxBytes = this.safeReadMemory('DATA', 'TRAP', v1 + 8, 4, true, instr);
          this.wasRunningBeforeTrap = this.isRunning();
          this.trapStdinRequest.set({ bufAddr, maxBytes, instrId: instr.id });
          this.pause();
          return; // Se queda en EX hasta que resolveTrapStdin() sea llamado
        }
        if (fd === 0 && instr.result !== undefined) {
          // Ya resuelto — avanzar normalmente
          this.currentStage = 'EX';
          return;
        }
      }

      // Ejecutar la operacion en ALU
      this.executeALU(instr, v1, v2);
    }

    this.currentStage = 'EX';
  }

  /**
   * Etapa MEMORIA
   * TODO: refactorizar comprobaciones de operaciones a mano con codigos de operacion
   * @private
   */
  private doMEM() {
    if (!this.currentInstr) return;

    this.pipeline.EX = null;
    this.pipeline.MEM = this.currentInstr;

    const instr = this.currentInstr;

    if (instr.isVector && ['LV', 'SV', 'LVWS', 'SVWS', 'LVI', 'SVI'].includes(instr.opcode)) {

      // Latencia de arranque (startup latency): consumir ciclos antes de procesar elementos para operaciones de carga, la latencia es inicial al abrir el puerto de memoria
      if (instr.initDelay > 0 && ['LV', 'LVWS', 'LVI'].includes(instr.opcode)) {
        // cyclesRemaining actúa como marcador: solo decrementamos initDelay después del primer ciclo
        if (instr.cyclesRemaining < instr.initDelay)
          instr.initDelay--;

        instr.cyclesRemaining--;
        if (instr.initDelay > 0) {
          this.addLog(`MEM: ${instr.opcode} latencia de arranque: faltan ${instr.initDelay} ciclos`, 'info');
          this.currentStage = 'MEM-LATENCY';
          return;
        }
        // initDelay llegó a 0, se procesan elementos en este mismo ciclo
      }
      //parche para los almacenamientos vectoriales, que se comen un ciclo de espera
      const hadPending = instr.currentElement < this.registerFile.vl();
      this.processVectorMemoryElement(instr);

      // Se bloquea en la etapa MEM mientras se procesan elementos
      if ((instr.currentElement < this.registerFile.vl() && ['LV', 'LVWS', 'LVI'].includes(instr.opcode)) || (hadPending && ['SV', 'SVWS', 'SVI'].includes(instr.opcode))) {
        this.addLog(`MEM: ${instr.opcode} procesando elemento ${instr.currentElement}/${this.registerFile.vl()}`, 'info');
        if (instr.currentElement > this.registerFile.vl()) instr.currentElement = this.registerFile.vl(); // solo para que el cronograma no muestre un elemento fuera de rango
        this.currentStage = 'MEM-LATENCY';
        return;
      }

      // Latencia final para operaciones de almacenamiento de memoria (después de procesar elementos)
      if (instr.endDelay > 0 && ['SV', 'SVWS', 'SVI'].includes(instr.opcode)) {
        // cyclesRemaining actúa como marcador: solo decrementamos endDelay después del primer ciclo
        if (instr.cyclesRemaining < instr.endDelay)
          instr.endDelay--;

        instr.cyclesRemaining--;
        this.addLog(`MEM: ${instr.opcode} latencia de fin: faltan ${instr.endDelay} ciclos`, 'info');
        this.currentStage = 'MEM-LATENCY';
        if (instr.endDelay == 1) {
          // endDelay ultimo ciclo de latencia saltamos a mem directamente
          this.currentStage = 'MEM';
        }
        return;
      }

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
          instr.result = this.safeReadMemory('DATA', instr.opcode, addr, 1, false, instr);
          this.addLog(`MEM: Leído byte unsigned ${instr.result} de 0x${addr.toString(16)}`, 'info');
          break;
        case 'LF': // Load Float (32 bits)
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
        case 'SF': // Store Float (32 bits)
          // Obtenemos solo los 32 bits del registro
          const valF = this.getFloatValue(instr.rs2!, false);
          this.safeWriteMemory('DATA', addr, valF, 3, instr); //error detectado en test unitario, float no esta escribiendo en memoria correctamente su valor
          this.addLog(`MEM: Guardado float 32-bit en 0x${addr.toString(16)}`, 'info');
          break;
        case 'SD':
          // Leemos el valor de 64 bits (F[n] y F[n+1])
          const valD = this.getFloatValue(instr.rs2!, true);
          this.safeWriteMemory('DATA', addr, valD, 8, instr);
          this.addLog(`MEM: Guardado double ${valD} en 0x${addr.toString(16)}`, 'info');
          break;
      }
    }

    this.currentStage = 'MEM';
  }

  /**
   * Etapa WB
   * @private
   */
  private doWB() {
    if (!this.currentInstr) return;

    this.pipeline.MEM = null;
    this.pipeline.WB = this.currentInstr;

    const instr = this.currentInstr;

    // Tratamiento de excepciones precisas: la excepcion viaja con la instruccion por el pipe hasta aquí, momento en que la tratamos
    // Si la instrucción tiene excepción, manejarla antes de escribir resultados
    if (instr.hasException) {
      const exCode = instr.exceptionCode ?? ExceptionCode.UNKNOWN;
      this.addLog(`WB: EXCEPCIÓN PRECISA en PC=0x${instr.pc.toString(16)}: ${exCode}`, 'error');
      // Guardar el PC actual en el registro IAR y el codigo de error en cause
      this.iar.set(instr.pc);
      this.cause.set(exCode);
      // Saltar al vector de interrupción correspondiente
      const vectorIndex = EXCEPTION_TO_VECTOR[exCode];
      const vectorAddr = vectorIndex * VECTOR_ENTRY_SIZE;
      this.addLog(`WB: Saltando a vector ${vectorIndex} (0x${vectorAddr.toString(16)})`, 'info');
      this.pc = vectorAddr;
      this.currentStage = 'WB';
      return;
    }

    //Manejo de instrucciones especiales

    // MOVI2S → actualizar el registro de longitud vectorial
    if (instr.opcode === 'MOVI2S') {
      const newVL = Math.max(0, Math.min(this.MVL, instr.result! | 0));
      this.registerFile.vl.set(newVL);
      this.addLog(`WB: VLR ← ${newVL} (máx: ${this.MVL})`, 'success');
      this.currentStage = 'WB';
      return;
    }

    // MOVF2S → decodificar bits del float como bitmask y actualizar VM
    if (instr.opcode === 'MOVF2S') {
      const bits = this.registerFile.setVectorMask(instr.result!);
      this.addLog(`WB: VM ← 0x${(bits >>> 0).toString(16).padStart(8, '0')}`, 'success');
      this.currentStage = 'WB';
      return;
    }

    // Comparaciones vectoriales (SEQV, SLTV, SEQSV, SLTVS): setean la mascara vectorial
    if (instr.isVector && instr.config.argNum === 2 && instr.opcode !== 'CVI') {
      this.registerFile.writeVectorMask(instr.vectorResult!.slice() as Float64Array);
      this.addLog(`WB: Vector Mask actualizado por ${instr.opcode}`, 'success');
      this.currentStage = 'WB';
      return;
    }

    // CVM: reiniciar la máscara vectorial (todos los elementos activos)
    if (instr.opcode === 'CVM') {
      this.registerFile.resetVectorMask();
      this.addLog(`WB: Vector Mask limpiada (todos los elementos activos)`, 'success');
      this.currentStage = 'WB';
      return;
    }

    // TRAP 6 parada incondicional del procesador, los trap guardan en r1 su codigo pero en este caso no queremos corromper r1 con esta parada, mantenemos el procesador tal cual esta en la ejecución
    if (instr.opcode === 'TRAP' && instr.imm === 6) {
      this.currentStage = 'WB';
      return;
    }

    // Resto de operacioness, verificamos si la instrucción tiene un registro destino (rd)
    if (instr.rd !== undefined) {

      if (instr.isVector) {
        this.registerFile.writeVectorRegister(instr.rd!, instr.vectorResult!);
      } else {
        if (instr.isFloat) {
          // Si es una instrucción de coma flotante (ej. ADD.D)
          this.setFloatValue(instr.rd, instr.result!, instr.isDouble);
        } else {
          // Si es una instrucción entera (ej. ADDI). R0 nunca se actualiza en ASG
          if (instr.rd !== 0) {
            this.registerFile.writeIntRegister(instr.rd, instr.result!);
          }
        }
      }

      this.addLog(`WB: Registro ${instr.isFloat ? 'F' : instr.isVector ? 'V' : 'R'}${instr.rd} actualizado a ${instr.isVector ? instr.vectorResult : instr.result}`, 'success');
    }

    this.currentStage = 'WB';
  }

  /**
   * Helper para terminar una instruccion
   * @private
   */
  private completeInstruction(): void {
    if (!this.currentInstr) return;

    // Marcar la entrada del timeline como completada (WB ya se registró en doWB)
    const entry = this.timelineIndex.get(this.currentInstr.id);
    if (entry)
      entry.completed = true;

    if (!this.currentInstr.hasException) {
      this.instructionsFinishedCount++;
      this.updateStats();

      this.addLog(`WB: Instrucción ${this.currentInstr.opcode} completada`, 'success');
    } else {
      this.addLog(`WB: Instrucción ${this.currentInstr.opcode} completada con excepcion`, 'warning');
    }
  }

  /**
   * Helper para el acceso al fichero de registros
   * @param instr
   * @param regIndex
   * @param isFloat
   * @private
   */
  private getRegisterValue(instr: AsgInstruction, regIndex: number, isFloat: boolean): number {
    // R0 es siempre 0
    if (regIndex === 0 && !isFloat) return 0;

    // No existe forwarding por lo que se lee siempre del fichero de registros arquitectonico
    if (isFloat) {
      const isDoubleNeeded = instr?.isDoubleSource || this.registerFile.floatRegisterTypes()[regIndex] === 'D' || false;

      return this.getFloatValue(regIndex, isDoubleNeeded)
    } else {
      return this.registerFile.readIntRegister(regIndex);
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
    //Limoiar banco de registros y memoria de datos
    this.registerFile.reset();
    this.dataMemory.reset();
    //vaciar pipeline y variables de control de stage e instruccion actual
    this.pipeline = {
      IF: null,
      ID: null,
      EX: null,
      MEM: null,
      WB: null
    };
    this.currentStage = 'IDLE';
    this.currentInstr = null;
    // Limpiar el historico del cronograma, logs y estadisticas
    this.timeline.set([]);
    this.timelineIndex.clear();
    this.logService.reset();
    this.instructionsFinishedCount = 0;
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
    // IAR: almacena la dirección de retorno de la instruccion siguente al TRAP actual para retornar
    this.iar.set((instr.pc + 4) & 0xFFFFFFFF);

    switch (trapCode) {
      // Para el procesador monociclo trap 0 y trap 6 realmente se comportan igual, puesto que no hay paralelismo, no hay que esperar a que terminen las instrucciones anteriores, estan terminadas por definicion cuando se empieza a procesar el trap
      case 0:
      case 6:
        this.addLog(`TRAP ${trapCode}: Programa terminado`, 'success');
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
        const fd = this.safeReadMemory('DATA', 'TRAP', r14Addr, 4, true, instr);
        if (fd !== 0) {
          this.addLog(`TRAP 3: fd=${fd} no soportado (solo fd=0/stdin)`, 'warning');
          instr.result = -1;
        }
        // fd=0 (stdin): el stall asíncrono se gestiona en doEX antes de llegar aquí
        // Si llegamos aquí, la lectura ya está resuelta (result ≠ undefined)
        break;
      }
      // lee el bloque de parámetros en R14: [fd(4), bufAddr(4), count(4)]
      // write() escribe exactamente count bytes — no se detiene en null.
      case 4: {
        const fd4 = this.safeReadMemory('DATA', 'TRAP', r14Addr, 4, true, instr);
        const bufAddr4 = this.safeReadMemory('DATA', 'TRAP', r14Addr + 4, 4, true, instr);
        const count4 = this.safeReadMemory('DATA', 'TRAP', r14Addr + 8, 4, true, instr);
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
      // lee Bloque de parámetros en R14: [fd(4), bufAddr(4), count(4)]
      // Se pasa r14 directamente; trapFormatPrintf lee mem[r14] para obtener la dirección de la cadena de formato y los args desde r14 + 4.
      case 5: {
        this.addLog(`TRAP 5: R14=0x${r14Addr.toString(16)}, bloque de parámetros en mem[0x${r14Addr.toString(16)}]`, 'info');
        const output = this.trapFormatPrintf(r14Addr, r14Addr + 4, instr);
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
   * Helper para marcar la linea actual en la etapa EX en el editor
   */
  override getExSourceLine(): number | null {
    const exInstr = this.currentInstr;
    if (!exInstr) return null;
    return this.pcToLine.get(exInstr.pc) ?? exInstr.id;
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
   * Helper para escribir una cadena en emmoria añadiendo el terminador nulo al final. Devuelve el numero de bytes escritos (sin contar el null)
   * @param addr
   * @param text
   * @param maxBytes
   * @param instr
   * @private
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
            const val = this.safeReadMemory('DATA', 'TRAP', argsAddr + argOffset, 9, false, instr);
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
   * Helper para resolver el salto de una instruccion de salto
   * @param instr
   * @param taken
   * @param targetPC
   * @private
   */
  private resolveBranch(instr: AsgInstruction, taken: boolean, targetPC: number) {
    if (taken) {
      this.pc = targetPC;
      this.addLog(`Salto tomado a 0x${targetPC.toString(16)}`, 'info');
    }
  }

  /**
   * Helper para actualizar las estadisticas en cada ciclo de ejecucion
   * @private
   */
  private updateStats() {
    const cpi = this.instructionsFinishedCount > 0
      ? (this.cycle() / this.instructionsFinishedCount)
      : 0;

    this.stats.set({
      controlHazards: 0,
      rawStalls: 0,
      wawStalls: 0,
      warStalls: 0,
      structuralStalls: 0,
      instructionsFinished: this.instructionsFinishedCount,
      cpi: parseFloat(cpi.toFixed(2)),
      stallRate: 0,
      branchHits: 0,
      branchMisses: 0,
      branchHitRate: 0
    });
  }

  /**
   * Helper para actualizar el cronograma del procesador
   * @private
   */
  private updateTimeline() {
    const currentCycle = this.cycle();

    if (!this.currentInstr || this.currentInstr.id === undefined) return;

    let entry = this.timelineIndex.get(this.currentInstr.id);

    if (!entry) {
      entry = {
        id: this.currentInstr.id,
        pc: this.currentInstr.pc,
        raw: this.currentInstr.toString(),
        stages: {},
        completed: false,
        isVector: this.currentInstr.isVector,
      };
      this.timelineIndex.set(this.currentInstr.id, entry);
    }

    let stage = this.currentStage;
    if (this.currentStage === 'EX-LATENCY') {
      stage = 'EX';
    } else if (this.currentStage === 'MEM-LATENCY') {
      stage = 'MEM';
    }

    let label = stage;
    if ((stage === 'EX' || stage === 'MEM') && this.currentInstr.isVector) {
      if (this.currentInstr.initDelay > 0) {
        // Latencia inicial: mostrar ciclos restantes entre corchetes
        label = `${stage}[${this.currentInstr.initDelay}]`;
      } else if (this.currentInstr.currentElement <= this.registerFile.vl()) {
        // Procesando elementos: mostrar elemento actual entre paréntesis
        label = `${stage}(${this.currentInstr.currentElement})`;
      } else if (this.currentInstr.endDelay > 0) {
        // Latencia final: mostrar ciclos restantes entre corchetes
        label = `${stage}[${this.currentInstr.endDelay}]`;
      }
    }

    /*if (stage === 'EX' && !this.currentInstr.isVector) {
      if (this.currentInstr.cyclesRemaining > 1) {
        // Procesando elementos: mostrar los ciclos restantes entre corchetes
        label = `${stage}(${this.currentInstr.cyclesRemaining})`;
      }
    }*/

    entry.stages[currentCycle] = label;

    if (this.currentStage === 'WB')
      entry.completed = true;

    this.timeline.set(Array.from(this.timelineIndex.values()));
  }

  /**
   * Procesa elementos vectoriales teniendo en cuenta la configuracion de LANES del procesador
   * TODO: sacar el ALU vectorial de aqui a un servicio propio
   * @param instr
   * @private
   */
  private processVectorElement(instr: AsgInstruction) {
    const vl = this.registerFile.vl();
    const lanes = this.aluLanes();
    const startIdx = instr.currentElement;
    if (!instr.vectorResult) instr.vectorResult = new Float64Array(this.MVL);
    const op = instr.opcode.toUpperCase();

    // Simulamos el procesamiento paralelo de 'n' elementos por ciclo segun la configuracion de lanes
    for (let l = 0; l < lanes; l++) {
      const i = startIdx + l;

      // Si ya procesamos todos los elementos del Vector Length, paramos
      if (i >= vl) break;

      // Aplicar máscara vectorial: saltar elementos inactivos
      if (!this.registerFile.isVectorMaskElementActive(i)) continue;

      let val1: number, val2: number;

      if (op.includes('SV')) {
        val1 = this.getRegisterValue(instr, instr.rs1!, true);
        val2 = this.getVectorElementValue(instr.rs2!, i);      // Vj
      } else if (op.includes('VS')) {
        val1 = this.getVectorElementValue(instr.rs1!, i);      // Vj
        //segundo operando en estas instrucciones siempre es un escalar no inmediato
        val2 = this.getRegisterValue(instr, instr.rs2!, true); // Fi
      } else {
        // Caso Vector-Vector
        val1 = this.getVectorElementValue(instr.rs1!, i);
        val2 = this.getVectorElementValue(instr.rs2!, i);
      }

      // Operar (ALU Vectorial)
      let res = 0;
      let exception: ExceptionCode | null = null;

      switch (true) {
        case op.startsWith('ADD'):  res = val1 + val2; break;
        case op.startsWith('SUB'):  res = val1 - val2; break;
        case op.startsWith('MULT'): res = val1 * val2; break;
        case op.startsWith('DIV'): {
          if (val2 === 0) {
            // marcar excepcion en division por 0
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
          const stride = this.getRegisterValue(instr, instr.rs1!, false);
          res = i * stride;
          break;
        }
        case op === 'CVM':          res = 1; break;                 // @deprecated, la mascara se reseta en WB
        default:
          this.addLog(`Opcode no implementado en EX vectorial: ${op}`, 'error');
      }

      // Verificar excepciones FP y Overflow (IEEE 754)
      if (!exception) {
        if (isNaN(res)) {
          exception = ExceptionCode.FP_INVALID_OPERATION;
        } else if (!isFinite(res)) {
          exception = ExceptionCode.FP_OVERFLOW;
        } else if (res !== 0 && Math.abs(res) < Number.MIN_VALUE) {
          exception = ExceptionCode.FP_UNDERFLOW;
        } /*else if (!op.includes('F') && !op.includes('D')) {
          const res32 = res | 0;
          if (res !== res32) exception = ExceptionCode.ARITHMETIC_OVERFLOW;
        }*/
      }

      if (exception) {
        instr.hasException = true;
        instr.exceptionCode = exception;
        // No retornar - continuar procesando para mantener consistencia del estado
      }
      // guardo el resultado en la posicion del vector resultados
      instr.vectorResult[i] = res;
    }

    // avanza el puntero de elementos procesados
    instr.currentElement += lanes;

    // Si terminamos el vector, el pipeline avanzará esta instrucción a MEM en el siguiente ciclo
    if (instr.currentElement >= vl) {
      this.addLog(`EX: Instrucción ${instr.opcode} completó sus ${vl} elementos`, 'success');
    }
  }

  /**
   * Helper para obtener un vector desde registro
   * @param regIdx
   * @param elementIdx
   * @private
   */
  private getVectorElementValue(regIdx: number, elementIdx: number): number {
    // V0 en arquitectura vectorial suele ser el vector cero
    //if (regIdx === 0) return 0.0;
    // Sin chaining en non-pipelined, leemos del banco de registros
    return this.registerFile.readVectorElement(regIdx, elementIdx);
  }

  /**
   * Procesa elementos de memoria vectorial teniendo en cuenta la configuracion de LANES del procesador
   * @param instr
   * @private
   */
  private processVectorMemoryElement(instr: AsgInstruction) {
    const lanes = this.memoryLanes(); // Usamos la configuración de memoria
    const vl = this.registerFile.vl();
    const startIdx = instr.currentElement;

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
          // Usamos el valor de stride leído en EX
          const stride = (instr as any).strideValue ?? 8;
          addr = instr.result! + stride * i;
          break;
        }
        case 'LVI':
        case 'SVI': {
          // Gather/Scatter: addr[i] = base + indices[i]
          // Usamos el vector de índices leído en EX
          const indices = (instr as any).vectorIndices as Float64Array;
          const index = indices ? indices[i] : 0;
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
        this.addLog(`MEM: Cargado elemento ${i} de V${instr.rd} desde 0x${addr.toString(16)}`, 'info');
      } else {
        // SV / SVWS / SVI
        const value = this.getVectorElementValue(instr.rs2!, i);
        this.safeWriteMemory('DATA', addr, value, 8, instr);
        this.addLog(`MEM: Guardado elemento ${i} en 0x${addr.toString(16)}`, 'info');
      }
    }

    instr.currentElement += lanes;
  }
}
