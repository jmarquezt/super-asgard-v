import {computed, Injectable, signal} from '@angular/core';
import {CODE_BASE, EXCEPTION_TO_VECTOR, ExceptionCode, VECTOR_ENTRY_SIZE} from '../../models/asg.exceptions';
import { createEmptyStats, FetchBuffer, InFlightInstruction, InstructionState, RegisterType, ResolvedOperands, STAGE_LABELS, SuperscalarStats} from '../../models/asg.models';
import {AsgInstruction} from '../../models/instructions/asg.instruction';
import {ASG_MAP, FunctionalUnitType} from '../../models/asg.map';
import {AsgInstructionFactoryService} from '../assembly/asg.instruction-factory';
import {AsgBranchPredictorService, PredictResult} from '../asg.bp';
import {MemoryAlignmentError, MemoryOutOfBoundsError} from '../asg.memory';
import {SuperscalarConfig, VECTOR_COMPARISON_OPCODES} from '../../models/asg.config';
import {RRF} from '../../models/superscalar/rrf';
import {ROB, ROBEntry, ROBTag, robTagEquals} from '../../models/superscalar/rob';
import {CDB, CDBResult} from '../../models/superscalar/cdb';
import {getFunctionalUnitType} from '../../models/superscalar/fu';
import {FunctionalUnitPool} from '../../models/superscalar/fu-pool';
import {createReservationStations, DistributedRS, IReservationStations, RSEntry} from '../../models/superscalar/rs';
import {AsgProcessorService} from './asg.processor';
import {RegisterAlignmentError} from '../asg.register-file';

/**
 * Servicio del Procesador Superescalar
 * Basado en el modelo del libro de la asignatura
 *
 * Pipeline de 6 etapas: IF → ID → II → EX → WR → RI
 * - IF: Instruction Fetch
 * - ID: Instruction Decode + Renombramiento explícito (RRF)
 * - II: Instruction Issue (Distribución, Supervisión, Emisión)
 * - EX: Execute (en Unidades Funcionales, out of order)
 * - WR: Write Results (publica en CDB, actualiza ROB)
 * - RI: Retire (commit en orden, actualiza registros arquitectónicos)
 */
@Injectable({ providedIn: 'root' })
export class AsgSuperscalarProcessorService extends AsgProcessorService {

  // Configuración de vector chaining (desde config del usuario en UI)
  private isChainingEnabled = computed(() => this.configService.getCurrentConfig().enableVectorChaining);
  // Solapamiento de init vectorial en la misma UF (desde config del usuario en UI
  private isVectorInitOverlapEnabled = computed(() => this.configService.getCurrentConfig().superscalar.enableVectorInitOverlap);
  private config!: SuperscalarConfig;
  // Getter de compatibilidad para acceder al RRF
  private get rrf() { return this.registerFile.getRRF(); }
  private rob!: ROB;
  private rs!: IReservationStations;
  private cdb!: CDB;
  private fuPool!: FunctionalUnitPool;
  // Nivel de especulación (contador de branches no resueltos)
  private speculationDepth: number = 0;
  // Checkpoints de RRF para recovery de misprediction
  private rrfCheckpoints: Map<number, ReturnType<RRF['snapshot']>> = new Map();

  private initialPC: number = 0;
  private nextInstrId: number = 0;
  private fetchBuffer: FetchBuffer = { instructions: [], pcs: [] };
  public inFlight: Map<number, InFlightInstruction> = new Map();
  // Instrucciones retiradas en el ultimo ciclo. Necesito este array para mostrarlas en la interfaz, ya que se limpian del pool antes de que la interfaz actualice y se pierden
  public lastRetiredInFlight: InFlightInstruction[] = [];
  // Estadisticas de la maquina
  private stats: SuperscalarStats = createEmptyStats();

  constructor() {
    super(true);

    const globalConfig = this.configService.getCurrentConfig();
    this.config = globalConfig.superscalar;

    this.rob = new ROB(this.config.robSize);
    this.rs = createReservationStations(this.config);
    this.cdb = new CDB(this.config.cdbWidth);
    this.fuPool = new FunctionalUnitPool(this.config, globalConfig.latencies, {
      vl: this.registerFile.vl(),
      aluLanes: globalConfig.aluLanes,
      memLanes: globalConfig.memLanes
    });
    this.branchPredictor = new AsgBranchPredictorService(globalConfig.branchPredictionStrategy);
    this.branchPredictor.setStrategy(globalConfig.branchPredictionStrategy, globalConfig.ghrBits);
  }

  /**
   * Método para cargar el procesador inicialmente y prepararlo para la ejecución
   * @param instructions
   * @param dataMemory
   * @param initialCodePtr
   * @param pcToLine
   */
  override load(instructions: Uint8Array, dataMemory: Uint8Array, initialCodePtr: number = CODE_BASE, pcToLine?: Map<number, number>): void {
    this.instructionsMemory.set(instructions);
    this.dataMemory.load(dataMemory); // load() preserva los datos iniciales para reset
    this.pcToLine = pcToLine ?? new Map();
    this.initialPC = initialCodePtr;
    this.pc = this.initialPC;
    this.cycle.set(0);
    this.finished.set(false);
    this.branchPredictor.reset(); // Limpiar historial

    this.addLog(`[LOAD] instructions.length=${instructions.length}, dataMemory.length=${dataMemory.length}, initialCodePtr=${initialCodePtr}, this.pc after reset=${this.pc}`, 'info');
  }

  /**
   * Método principal para el funcionamiento del procesador, ejecuta un intervalo segun la velocidad indicada y ejecuta un ciclo en cada vuelta del intervalo hasta la finalizacion de la ejecucion
   */
  override run(): void {
    if (this.isRunning() || this.finished()) return;

    this.isRunning.set(true);
    this.isStopped.set(false);

    this.runInterval = setInterval(() => {
      const cycles = this.cyclesPerTick();

      for (let i = 0; i < cycles; i++) {
        if (!this.isRunning() || this.finished() || this.isStopped()) {
          this.pause();
          return;
        }

        // Si la línea tiene un breakpoint, paramos antes de ejecutar el ciclo
        if (this.shouldStopAtBreakpoint()) {
          this.pause();
          this.addLog(`Breakpoint alcanzado en línea ${this.getCurrentSourceLine()}`, 'warning');
          return;
        }

        this.nextCycle();

        // Verificar si el ciclo pausó por TRAP u otra razón
        if (!this.isRunning())
          return;
      }
    }, this.speed());
  }

  /**
   * Metodo para reiniciar el procesador a estado inicial
   */
  override reset(): void {
    // Limpiar logs
    this.logService.reset();

    // Reinicializar componentes con configuración actual
    const globalConfig = this.configService.getCurrentConfig();
    this.config = globalConfig.superscalar;

    // Reset banco de registros y memoria
    this.registerFile.reset();
    this.dataMemory.reset();
    // Actualizar configuración vectorial según config actual
    this.aluLanes.set(globalConfig.aluLanes);
    this.memoryLanes.set(globalConfig.memLanes);

    this.rob = new ROB(this.config.robSize);
    this.rs = createReservationStations(this.config);
    this.cdb = new CDB(this.config.cdbWidth);
    this.fuPool = new FunctionalUnitPool(this.config, globalConfig.latencies, {
      vl: this.registerFile.vl(),
      aluLanes: globalConfig.aluLanes,
      memLanes: globalConfig.memLanes
    });
    this.branchPredictor = new AsgBranchPredictorService(globalConfig.branchPredictionStrategy);
    this.branchPredictor.setStrategy(globalConfig.branchPredictionStrategy, globalConfig.ghrBits);

    // Reset estado
    this.pc = this.initialPC;
    this.nextInstrId = 0;
    this.fetchBuffer = { instructions: [], pcs: [] };
    this.inFlight.clear();
    this.speculationDepth = 0;
    this.rrfCheckpoints.clear();
    this.registerFile.clearVectorRegisterStatus();
    this.registerFile.resetVectorMask();
    this.lastRetiredInFlight = [];
    this.cycle.set(0);
    this.isRunning.set(false);
    this.finished.set(false);
    this.isStopped.set(false);

    // Reset estadísticas y timeline
    this.stats = createEmptyStats();
    this.timeline.set([]);
    this.timelineIndex.clear();

    // Reset consola y TRAP
    this.consoleOutput.set([]);
    this.trapStdinRequest.set(null);
    this.iar.set(0);
    this.cause.set('');

    this.addLog('Procesador superescalar reseteado', 'info');
  }

  /**
   * Método que simula la ejecucion de un ciclo de reloj
   */
  override nextCycle(): void {
    if (this.finished()) return;

    // Pausar procesador mientras espera entrada de stdin (pero no si ya la tenemos)
    const trapReq = this.trapStdinRequest();
    if (trapReq && !(trapReq as any).pendingInput) {
      this.addLog('[PAUSED] Esperando entrada stdin...', 'info');
      return;
    }

    const currentCycle = this.cycle() + 1;
    this.cycle.set(currentCycle);

    // DEBUG: Estado antes del ciclo
    /*console.log(`\n           CYCLE ${currentCycle}           `);
    console.log(`[PRE] PC=${this.pc}, fetchBuffer=${this.fetchBuffer.instructions.length}, inFlight=${this.inFlight.size}`);
    console.log(`[PRE] ROB entries=${this.rob.getAllEntries().filter(e => e.ocupada).length}`);
    console.log(`[PRE] RS entries=${this.rs.getAllOccupied().length}`);*/

    // Actualizar configuración vectorial cada ciclo por si VL ha cambiado con alguna instruccion
    this.fuPool.updateVectorConfig({
      vl: this.registerFile.vl(),
      aluLanes: this.aluLanes(),
      memLanes: this.memoryLanes()
    });

    // Ejecutar etapas en orden inverso para evitar conflictos (las etapas finales procesan antes que las iniciales), asi una instruccion no avanza varias etapas en un mismo ciclo
    this.stageRI(currentCycle);
    this.stageWR(currentCycle);
    this.stageEX(currentCycle);
    this.stageII(currentCycle);
    this.stageID(currentCycle);
    this.stageIF(currentCycle);

    // Actualizar estadísticas
    this.updateStats(currentCycle);

    // Verificar si terminó
    this.checkFinished();

    // Actualizar timeline para visualización (antes de cleanup para mostrar flushed)
    this.updateTimeline();

    // Limpiar entradas inflight retiradas/flushed para evitar que el mapa crezca y para evitar conflictos cuando el ROB reutiliza tags
    this.cleanupInflight();

    // DEBUG: Estado después del ciclo
    /*console.log(`[POST] InFlight states:`);
    for (const [id, inf] of this.inFlight) {
      console.log(`  [${id}] ${inf.instr.opcode} state=${inf.state} robTag=[${inf.robTag?.slot}][${inf.robTag?.generation}] cycleIF=${inf.cycleIF} cycleID=${inf.cycleID} cycleII=${inf.cycleII} cycleEX=${inf.cycleEX}`);
    }
    console.log(`[POST] finished=${this.finished()}`);*/
  }

  /**
   * Verifica si el procesador ha terminado la ejecución.
   * Esta implementacion considera terminado si la señal finished = true
   */
  override isFinished(): boolean {
    return this.finished();
  }

  /** Devuelve la línea del editor correspondiente al PC actual. */
  override getCurrentSourceLine(): number {
    return this.pcToLine.get(this.pc) ?? -1;
  }

  /**
   * Obtiene las líneas de código de todas las instrucciones en ejecución (EX) para resaltar múltiples líneas en el editor
   */
  getExecutingSourceLines(): number[] {
    const lines: number[] = [];
    for (const inflight of this.inFlight.values()) {
      if (inflight.state === 'EXECUTING') {
        const sourceLine = this.pcToLine.get(inflight.pc);
        if (sourceLine !== undefined && sourceLine > 0) {
          lines.push(sourceLine);
        }
      }
    }
    return lines;
  }

  /**
   * Etapa IF
   * TODO: traducciones de log y no los textos a mano
   * @param currentCycle
   * @private
   */
  private stageIF(currentCycle: number): void {
    const instrMemLen = this.instructionsMemory.get().length;
    // DEBUG
    //console.log(`[IF] cycle=${currentCycle}, PC=${this.pc}, instrMemLen=${instrMemLen}, initialPC=${this.initialPC}`);

    // Detiene el fetch si hay un TRAP 0 (exit) o 6 (stop) en vuelo en el pipeline. Esto actúa como una barrera que detiene la entrada de nuevas instrucciones.
    // Si la instrucción TRAP se limpia por un salto mal predicho, el fetch se reanudará automáticamente.
    const hasExitTrap = Array.from(this.inFlight.values()).some(inf =>
      inf.instr.opcode === 'TRAP' && (inf.instr.imm === 0 || inf.instr.imm === 6) && inf.state !== 'RETIRED' && inf.state !== 'FLUSHED'
    );

    if (hasExitTrap) {
      this.addLog('[IF] TRAP 0/6 en vuelo, fetch detenido por precaución', 'warning');
      return;
    }

    // Detener el fetch si hay un TRAP está esperando stdin
    if (this.trapStdinRequest()) {
      this.addLog('[IF] TRAP esperando entrada de datos, fetch detenido', 'info');
      return;
    }

    // Detener el fetch si el ROB o el buffer de instrucciones estan llenos
    if (this.rob.isFull()) {
      this.stats.robFullStalls++;
      this.addLog('[IF] ROB lleno, fetch detenido', 'warning');
      return;
    }

    const maxFetch = this.config.issueWidth;
    const bufferSpace = maxFetch * 2 - this.fetchBuffer.instructions.length;

    if (bufferSpace <= 0) {
      this.stats.fetchStalls++;
      this.addLog('[IF] Fetch Buffer lleno, fetch detenido', 'warning');
      return;
    }

    let fetched = 0;
    while (fetched < Math.min(maxFetch, bufferSpace)) {
      // Verificar fin de programa
      if (this.pc >= instrMemLen) {
        this.addLog(`[IF] PC ${this.pc} >= instrMemLen ${instrMemLen}, fetch detenido`, 'info');
        break;
      }

      const currentPC = this.pc;
      const instr = this.fetchInstruction(currentPC);
      if (!instr) {
        this.addLog(`[IF] fetchInstruction(${currentPC}) returned null`, 'error');
        break;
      }
      this.addLog(`[IF] Fetched: ${instr.opcode} con PC=${currentPC}`, 'info');

      // Detectar si es un branch/jump
      const isBranch = this.isBranchInstruction(instr);
      let prediction: PredictResult | null = null;

      if (isBranch) {
        // Hacer predicción
        prediction = this.branchPredictor.predict(currentPC, instr.opcode);
        this.stats.branchPredictions++;

        // Actualizar GHR especulativamente
        this.branchPredictor.updateGHRSpeculative(prediction.taken);
      }

      this.fetchBuffer.instructions.push(instr);
      this.fetchBuffer.pcs.push(currentPC);

      // Crear entrada en timeline
      const id = this.nextInstrId++;
      const inflight: InFlightInstruction = {
        id,
        instr,
        pc: currentPC,
        state: 'FETCHED',
        robTag: { slot: -1, generation: 0 },
        rsIndex: null,
        fuId: null,
        cycleIF: currentCycle,
        cycleID: null,
        cycleII: null,
        cycleII_D: null,
        cycleII_S: null,
        cycleII_E: null,
        cycleEX: null,
        cycleWR: null,
        cycleRI: null,
        speculative: this.speculationDepth > 0,
        flushed: false,
        isBranch,
        prediction,
        branchResolved: false,
        actualTaken: null,
        actualTarget: null,
        resolvedOperands: null,
        execV1: 0,
        execV2: 0,
        execVL: 0,
        cyclesRemainingEX: 0,
        currentElement: 0,
        vectorResult: null,
        vectorPhase: null,
        cyclesRemainingInPhase: 0,
        initDelay: 0,
        endDelay: 0,
        executionPhaseLabel: null,
        isPendingOnFU: false,
        trapParams: null
      };

      this.inFlight.set(id, inflight);

      if (isBranch)
        this.speculationDepth++;

      if (isBranch && prediction?.taken) {
        this.pc = prediction.target;
        this.addLog(`IF: ${instr.opcode} predicción TAKEN → PC=${prediction.target}`, 'info');
      } else {
        this.pc += 4;
      }

      fetched++;
      this.stats.instructionsFetched++;

      if (isBranch && prediction?.taken)
        break;
    }
  }

  /**
   * Helper para identificar si una instruccion es un branch
   * TODO: eliminar estas comprobaciones a mano con opcodes
   * @param instr
   * @private
   */
  private isBranchInstruction(instr: AsgInstruction): boolean {
    const op = instr.opcode?.toUpperCase() ?? '';
    return ['BEQZ', 'BNEZ', 'BGTZ', 'BLTZ', 'BFPT', 'BFPF', 'J', 'JAL', 'JR', 'JALR'].includes(op);
  }

  /**
   * Helper para obtener de memoria una instruccion con un PC dado
   * @param pc
   * @private
   */
  private fetchInstruction(pc: number): AsgInstruction | null {
    const instrMem = this.instructionsMemory.get();
    if (pc + 4 > instrMem.length) return null;

    // Decodificar instrucción desde memoria binaria usando InstructionFactory
    const word =
      (instrMem[pc] << 24) |
      (instrMem[pc + 1] << 16) |
      (instrMem[pc + 2] << 8) |
      instrMem[pc + 3];

    const lineNum = this.pcToLine.get(pc) ?? (pc / 4);
    try {
      return AsgInstructionFactoryService.decode(word, pc, lineNum);
    } catch (e) {
      this.addLog(`Error decodificando instrucción en PC=${pc}: ${e}`, 'error');
      return null;
    }
  }

  /**
   * Etapa ID
   * @param currentCycle
   * @private
   */
  private stageID(currentCycle: number): void {
    const toDecode = Math.min(
      this.fetchBuffer.instructions.length,
      this.config.issueWidth,
      this.rob.freeEntries()
    );

    for (let i = 0; i < toDecode; i++) {
      const instr = this.fetchBuffer.instructions.shift()!;
      const pc = this.fetchBuffer.pcs.shift()!;

      // Encontrar la instrucción en vuelo
      const inflight = this.findInflightByPC(pc);
      if (!inflight) continue;

      // Obtener información del registro destino
      const destInfo = this.getDestinationRegister(instr);

      // Asignar entrada en ROB
      const robTag = this.rob.allocate(
        instr,
        pc,
        destInfo?.num ?? null,
        destInfo?.type ?? null,
        currentCycle,
        this.isStoreInstruction(instr),
        inflight.speculative
      );

      if (robTag === null) {
        // ROB lleno, devolver al buffer
        this.fetchBuffer.instructions.unshift(instr);
        this.fetchBuffer.pcs.unshift(pc);
        break;
      }

      // marcar las instrucciones desconocidas en el rob (en caso de llegar aquí) en AsgInstructionFactoryService.decode() ya se marcó como excepción, pero si no la tratamos, se ejecuta en el procesador como un NOP
      if (instr.hasException)
        this.rob.markException(robTag.slot, instr.exceptionCode ?? ExceptionCode.ILLEGAL_INSTRUCTION);

      // IMPORTANTE: Resolver operandos ANTES de actualizar RRF. Esto evita que la instrucción obtenga su propio ROB tag como fuente
      inflight.robTag = robTag;
      inflight.resolvedOperands = this.resolveOperands(instr, robTag);

      // Ahora sí renombrar registro destino en RRF (Figura 2.40: marcar Ocupado=1, Índice=robTag)
      if (destInfo)
        this.rrf.rename(destInfo.type, destInfo.num, robTag);

      // Si es branch, guardar checkpoint de RRF y configurar info de predicción
      if (inflight.isBranch && inflight.prediction) {
        this.rrfCheckpoints.set(robTag.slot, this.rrf.snapshot());
        this.rob.setBranchInfo(robTag.slot, inflight.prediction.taken, inflight.prediction.target);
      }

      // Actualizar estado
      inflight.state = 'DECODED';
      inflight.cycleID = currentCycle;

      this.addLog(`ID: ${instr.opcode} → ROB[${robTag.slot}:${robTag.generation}]`, 'info');
    }
  }

  /**
   * Helper para preparar el registro destino de una instruccion
   * @param instr
   * @private
   */
  private getDestinationRegister(instr: AsgInstruction): { type: RegisterType; num: number } | null {
    // Obtener registro destino según el tipo de instrucción
    const info = ASG_MAP[instr.opcode?.toUpperCase()];
    if (!info) return null;

    const op = instr.opcode?.toUpperCase() ?? '';

    // MOVI2S escribe VLR (Vector Length Register)
    if (op === 'MOVI2S')
      return { type: 'VLR', num: 0 };

    // MOVF2S escribe VM (Vector Mask)
    if (op === 'MOVF2S')
      return { type: 'VM', num: 0 };

    // CVM escribe VM (Vector Mask)
    if (op === 'CVM')
      return { type: 'VM', num: 0 };

    // Comparaciones vectoriales (SEQ, SNE, SGT, etc.) escriben VM
    const isVectorComparison = op.startsWith('SEQ') || op.startsWith('SNE') || op.startsWith('SGT') || op.startsWith('SLT') || op.startsWith('SGE') || op.startsWith('SLE');
    if (info.type === 'V' && isVectorComparison)
      return { type: 'VM', num: 0 };

    // Stores no escriben en registros
    if (info.type === 'M' && instr.opcode?.startsWith('S')) return null;

    // Branches/Jumps normalmente no escriben (excepto JAL/JALR)
    if (info.type === 'B') return null;
    if (info.type === 'J' && !['JAL', 'JALR'].includes(instr.opcode.toUpperCase())) return null;

    // Comparaciones flotantes escriben en el bit de condición FPBC
    const isFPCompare = ['EQF', 'NEF', 'LTF', 'GTF', 'LEF', 'GEF', 'EQD', 'NED', 'LTD', 'GTD', 'LED', 'GED'].includes(op);
    if (isFPCompare)
      return { type: 'FPBC', num: 0 };

    // Instrucciones sin registro destino (stores, etc.)
    if (instr.rd === undefined) return null;

    const regNum = instr.rd;
    const regType: RegisterType = info.target === 'V' ? 'V' : info.target === 'F' || info.target === 'D' ? 'F' : 'R';

    return { type: regType, num: regNum };
  }

  /**
   * Helper para identificar si una instruccion es un almacenamiento en memoria
   * TODO: eliminar estas comprobaciones a mano con opcodes
   * @param instr
   * @private
   */
  private isStoreInstruction(instr: AsgInstruction): boolean {
    const op = instr.opcode?.toUpperCase() ?? '';
    return ['SB', 'SH', 'SW', 'SF', 'SD', 'SV', 'SVWS', 'SVI'].includes(op);
  }

  /**
   * Helper para identificar si una instruccion es una carga desde memoria
   * TODO: eliminar estas comprobaciones a mano con opcodes
   * @param instr
   * @private
   */
  private isLoadInstruction(instr: AsgInstruction): boolean {
    const op = instr.opcode?.toUpperCase() ?? '';
    return ['LB', 'LH', 'LW', 'LF', 'LD', 'LBU', 'LHU', 'LV', 'LVWS', 'LVI'].includes(op);
  }

  /**
   * Etapa II completa (Distribucion - Supervision y EMision)
   * @param currentCycle
   * @private
   */
  private stageII(currentCycle: number): void {
    // Sub-fase 1: Distribución (instrucciones decodificadas → RS)
    this.distributeToRS(currentCycle);

    // Sub-fase 2: Supervisión (actualizar RS con resultados del CDB)
    for (const result of this.cdb.getResults()) {
      this.rs.updateFromCDB(result);
    }

    // Sub-fase 2.5: Limpiar ROBTags stale de las RS
    this.cleanStaleRSOperands();

    // Sub-fase 3: Emisión (RS listas → UF)
    this.issueFromRS(currentCycle);
  }

  /**
   * Helper para distribuir las instrucciones disponibles en el ciclo a las RS
   * @param currentCycle
   * @private
   */
  private distributeToRS(currentCycle: number): void {
    // Obtener instrucciones decodificadas en vuelo pendientes de distribución
    const robHead = this.rob.getHeadTag();
    const robSize = this.rob.getSize();
    const decoded = Array.from(this.inFlight.values())
      .filter(inf => inf.state === 'DECODED')
      .sort((a, b) => {
        const posA = ((a.robTag?.slot ?? 0) - robHead + robSize) % robSize;
        const posB = ((b.robTag?.slot ?? 0) - robHead + robSize) % robSize;
        return posA - posB;
      });

    //console.log(`[II-D] ${decoded.length} instructions waiting to dispatch`);

    for (const inflight of decoded) {
      const instr = inflight.instr;
      const fuType = getFunctionalUnitType(instr.opcode ?? 'NOP');

      // Verificar espacio en RS
      if (!this.rs.hasSpace(fuType)) {
        this.addLog(`[II-D] ${instr.opcode} ROB[${inflight.robTag?.slot}]: RS ${fuType} llena, esperando hueco libre`, 'warning');
        this.stats.rsFullStalls++;
        continue;
      }

      // Usar operandos pre-resueltos en stageID (NO re-resolver para evitar capturar dependencias posteriores)
      const operands = inflight.resolvedOperands!;

      // Verificar si los tags ya tienen valores disponibles en el ROB
      if (operands.q1 !== null) {
        const robResult = this.rob.lookupValue(operands.q1);
        if (robResult.found) {
          operands.v1 = robResult.value ?? 0;
          operands.q1 = null;
          operands.v1Ready = true;
        } else if (robResult.stale) {
          // ROBTag stale: el productor ya hizo commit, leer directamente del registro arquitectónico
          const regInfo = this.getSourceRegisterInfo(instr, 1);
          if (regInfo) {
            // El escalar de una instrucción vectorial con escalar siempre es double
            const isDouble = (regInfo.type === 'F' && instr.isVector) ? true : (instr.isDoubleSource ?? false);
            operands.v1 = this.readArchitecturalRegister(regInfo.type, regInfo.num, isDouble, instr.opcode, operands.q1);
            operands.q1 = null;
            operands.v1Ready = true;
          }
        }
      }
      if (operands.q2 !== null) {
        const robResult = this.rob.lookupValue(operands.q2);
        if (robResult.found) {
          operands.v2 = robResult.value ?? 0;
          operands.q2 = null;
          operands.v2Ready = true;
        } else if (robResult.stale) {
          // ROBTag stale: el productor ya hizo commit, leer directamente del registro arquitectónico
          const regInfo = this.getSourceRegisterInfo(instr, 2);
          if (regInfo) {
            //mismo caso que arriba
            const isDouble = (regInfo.type === 'F' && instr.isVector) ? true : (instr.isDoubleSource ?? false);
            operands.v2 = this.readArchitecturalRegister(regInfo.type, regInfo.num, isDouble, instr.opcode, operands.q2);
            operands.q2 = null;
            operands.v2Ready = true;
          }
        }
      }

      if (operands.qVL !== null) {
        const robResult = this.rob.lookupValue(operands.qVL);
        if (robResult.found) {
          operands.vl = robResult.value ?? 0;
          operands.qVL = null;
          operands.vlReady = true;
        } else if (robResult.stale) {
          // ROBTag stale: el MOVI2S productor ya hizo commit, leer VLR directamente
          operands.vl = this.readArchitecturalRegister('VLR', 0, false, instr.opcode, operands.qVL);
          operands.qVL = null;
          operands.vlReady = true;
        }
      }

      // Crear entrada RS (robTag no puede ser null aquí porque la instrucción ya pasó por ID)
      const rsEntry: RSEntry = {
        ocupada: true,
        lista: operands.v1Ready && operands.v2Ready && operands.vlReady,
        opcode: instr.opcode ?? '',
        fuType,
        v1: operands.v1,
        q1: operands.q1,
        v2: operands.v2,
        q2: operands.q2,
        vVL: operands.vl,
        qVL: operands.qVL,
        destino: inflight.robTag!,
        instrRef: instr,
        cycleDispatched: currentCycle,
        addressBase: null,
        addressOffset: 0,
        effectiveAddress: null
      };

      //probar a hacer dispatch a la estacion de reserva
      const rsIndex = this.rs.dispatch(rsEntry, fuType);
      if (rsIndex === -1) {
        this.addLog(`[II-D] ${instr.opcode} ROB[${inflight.robTag?.slot}]: RS ${fuType} llena, esperando hueco libre`, 'warning');
        continue;
      }

      inflight.rsIndex = rsIndex;
      inflight.state = 'DISPATCHED';
      inflight.cycleII = currentCycle;
      inflight.cycleII_D = currentCycle;  // Registrar ciclo de Dispatch

      const q1Str = operands.q1 ? `${operands.q1.slot}:${operands.q1.generation}` : 'null';
      const q2Str = operands.q2 ? `${operands.q2.slot}:${operands.q2.generation}` : 'null';
      //console.log(`[II-D] ${instr.opcode}: dispatched to RS[${rsIndex}], v1=${operands.v1},q1=${q1Str},v1Ready=${operands.v1Ready},v2=${operands.v2},q2=${q2Str},v2Ready=${operands.v2Ready},lista=${rsEntry.lista}`);
      this.addLog(`II-D: ${instr.opcode} → RS[${rsIndex}]`, 'info');
    }
  }

  /**
   * Limpia operandos con ROBTags stale en las RS y obtiene su valor. Esto puede ocurrir si el productor hizo commit antes de que el CDB publicara el resultado.
   */
  private cleanStaleRSOperands(): void {
    const allRS = this.rs.getAllOccupied();

    // DEBUG: mostrar estado de RS
    /*const waiting = allRS.filter(e => !e.lista);
    if (waiting.length > 0) {
      console.log(`[RS Status] ${waiting.length} entries waiting for operands:`);
      for (const e of waiting.slice(0, 5)) {
        const q1Info = e.q1 ? `ROB[${e.q1.slot}:${e.q1.generation}]` : 'ready';
        const q2Info = e.q2 ? `ROB[${e.q2.slot}:${e.q2.generation}]` : 'ready';
        const robEntry1 = e.q1 ? this.rob.getEntry(e.q1.slot) : null;
        const robEntry2 = e.q2 ? this.rob.getEntry(e.q2.slot) : null;
        const rob1Status = robEntry1 ? `ocup=${robEntry1.ocupada},fin=${robEntry1.finalizada},gen=${robEntry1.generation}` : 'N/A';
        const rob2Status = robEntry2 ? `ocup=${robEntry2.ocupada},fin=${robEntry2.finalizada},gen=${robEntry2.generation}` : 'N/A';
        console.log(`  ${e.opcode} destino=${e.destino.slot}: q1=${q1Info}(${rob1Status}), q2=${q2Info}(${rob2Status})`);
      }
    }*/

    for (const entry of allRS) {
      let updated = false;

      if (entry.q1 !== null) {
        const robResult = this.rob.lookupValue(entry.q1);
        if (robResult.found) {
          entry.v1 = robResult.value ?? 0;
          entry.q1 = null;
          updated = true;
        } else if (robResult.stale) {
          // ROBTag stale: leer del registro arquitectónico
          const regInfo = this.getSourceRegisterInfoFromRS(entry, 1);
          if (regInfo) {
            const isDouble = (regInfo.type === 'F' && entry.instrRef?.isVector) ? true : (entry.instrRef?.isDoubleSource ?? false);
            entry.v1 = this.readArchitecturalRegister(regInfo.type, regInfo.num, isDouble, entry.opcode, entry.q1);
            entry.q1 = null;
            updated = true;
            //console.log(`[RS Cleanup] ${entry.opcode}: q1 was stale, read v1=${entry.v1} from arch reg`);
          }
        }
      }

      if (entry.q2 !== null) {
        const robResult = this.rob.lookupValue(entry.q2);
        if (robResult.found) {
          entry.v2 = robResult.value ?? 0;
          entry.q2 = null;
          updated = true;
        } else if (robResult.stale) {
          // ROBTag stale: leer del registro arquitectónico
          const regInfo = this.getSourceRegisterInfoFromRS(entry, 2);
          if (regInfo) {
            const isDouble = (regInfo.type === 'F' && entry.instrRef?.isVector) ? true : (entry.instrRef?.isDoubleSource ?? false);
            entry.v2 = this.readArchitecturalRegister(regInfo.type, regInfo.num, isDouble, entry.opcode, entry.q2);
            entry.q2 = null;
            updated = true;
            //console.log(`[RS Cleanup] ${entry.opcode}: q2 was stale, read v2=${entry.v2} from arch reg`);
          }
        }
      }

      if (entry.qVL !== null) {
        const robResult = this.rob.lookupValue(entry.qVL);
        if (robResult.found) {
          entry.vVL = robResult.value ?? 0;
          entry.qVL = null;
          updated = true;
        } else if (robResult.stale) {
          entry.vVL = this.readArchitecturalRegister('VLR', 0, false, entry.opcode, entry.qVL);
          entry.qVL = null;
          updated = true;
        }
      }

      // Actualizar flag lista si se modificaron operandos
      if (updated)
        entry.lista = (entry.q1 === null) && (entry.q2 === null) && (entry.qVL === null);
    }
  }

  /**
   * Obtiene información del registro fuente desde una entrada de RS
   */
  private getSourceRegisterInfoFromRS(entry: RSEntry, operandNum: 1 | 2): { type: RegisterType; num: number } | null {
    if (!entry.instrRef) return null;
    return this.getSourceRegisterInfo(entry.instrRef, operandNum);
  }

  /**
   * Helper para preparar los registros usados por una instruccion para asignar las dependencias
   * @param instr
   * @param selfRobTag
   * @private
   */
  private resolveOperands(instr: AsgInstruction, selfRobTag: ROBTag): ResolvedOperands {
    // Obtener registros fuente
    const info = ASG_MAP[instr.opcode?.toUpperCase() ?? ''];
    if (!info)
      return { v1: 0, q1: null, v1Ready: true, v2: 0, q2: null, v2Ready: true, vl: null, qVL: null, vlReady: true };

    const opcode = instr.opcode?.toUpperCase() ?? '';
    const regType: RegisterType = info.origin === 'V' ? 'V' : info.origin === 'F' || info.origin === 'D' ? 'F' : 'R';
    const isDouble = instr.isDoubleSource ?? false;

    // MOVS2I lee VLR explícitamente
    if (opcode === 'MOVS2I') {
      const vlrOp = this.getOperandValue('VLR', 0, opcode, selfRobTag, false);
      return {
        v1: vlrOp.value,
        q1: vlrOp.tag,
        v1Ready: vlrOp.ready,
        v2: null,
        q2: null,
        v2Ready: true,
        vl: null,
        qVL: null,
        vlReady: true
      };
    }

    // MOVS2F y POP leen VM explícitamente
    if (opcode === 'MOVS2F' || opcode === 'POP') {
      const vmOp = this.getOperandValue('VM', 0, opcode, selfRobTag, false);
      return {
        v1: vmOp.value,
        q1: vmOp.tag,
        v1Ready: vmOp.ready,
        v2: null,
        q2: null,
        v2Ready: true,
        vl: null,
        qVL: null,
        vlReady: true
      };
    }

    // Las instrucciones vectoriales leen implícitamente VLR, se resuelve aqui via renombrado
    let vl: number | null = null;
    let qVL: ROBTag | null = null;
    let vlReady = true;
    if (instr.isVector) {
      const vlrOp = this.getOperandValue('VLR', 0, opcode, selfRobTag, false);
      vl = vlrOp.value;
      qVL = vlrOp.tag;
      vlReady = vlrOp.ready;

      const vmLookup = this.registerFile.lookupVMRename();
      if (vmLookup.ocupado && 'robTag' in vmLookup) {
        this.addLog(`ID: ${opcode} depende de VM en ROB[${vmLookup.robTag.slot}]`, 'info');
        // Similar para VM
      }
    }

    // Para LOADS, el assembler pone la base en rs2
    // Para STORES, el assembler pone la base en rs1 y el valor en rs2
    // Para otras instrucciones, rs1 es el primer operando
    let rs: number;
    if (info.type === 'M' && !opcode.startsWith('S')) {
      rs = instr.rs2 ?? 0;
    } else {
      rs = instr.rs1 ?? 0;
    }

    const rt = instr.rs2 ?? 0;

    // Saltos flotantes dependen del bit de condición FPBC
    if (opcode === 'BFPT' || opcode === 'BFPF') {
      const { value, tag, ready } = this.getOperandValue('FPBC', 0, opcode, selfRobTag, false);
      return { v1: value, q1: tag, v1Ready: ready, v2: 0, q2: null, v2Ready: true, vl: null, qVL: null, vlReady: true };
    }

    // Determinar tipo de rs1 para instrucciones mixtas escalar-vector
    let rs1Type = regType;
    if (info.type === 'V' && opcode.includes('SV') /*&& !opcode.startsWith('S')*/) {
      // Instrucciones Escalar-Vector (ADDSV, SUBSV, etc.): rs1 es Float
      rs1Type = 'F';
    }

    // Operando 1, igual si es vector con operando escalar, es siempre doble
    const v1IsDouble = (info.type === 'V' && rs1Type === 'F') ? true : isDouble;
    const { value: v1, tag: q1, ready: v1Ready } = this.getOperandValue(rs1Type, rs, opcode, selfRobTag, v1IsDouble);

    // Operando 2 (r o inmediato)
    let v2: number | null = null;
    let q2: ROBTag | null = null;
    let v2Ready = true;

    if (info.type === 'I') {
      // Inmediato
      v2 = instr.imm ?? 0;
    } else if (info.type === 'R' || info.type === 'V') {
      // Operaciones aritméticas tipo R y vectoriales
      // Para instrucciones mixtas escalar-vector, rs2 puede tener tipo diferente
      let rs2Type = regType;
      if (info.type === 'V') {
        if (opcode.includes('SV') /*&& !opcode.startsWith('S')*/) {
          // ADDSV: rs1=Float, rs2=Vector
          rs2Type = 'V';
        } else if (opcode.includes('VS')) {
          // ADDVS: rs1=Vector, rs2=Float
          rs2Type = 'F';
        }
      }
      //igual que el operando 1
      const v2IsDouble = (info.type === 'V' && rs2Type === 'F') ? true : isDouble;
      const op2 = this.getOperandValue(rs2Type, rt, opcode, selfRobTag, v2IsDouble);
      v2 = op2.value;
      q2 = op2.tag;
      v2Ready = op2.ready;
    } else if (info.type === 'M') {
      // Stores: necesitan rs2 (valor a almacenar)
      // Loads: solo necesitan rs1/rs2 (base) que ya está en v1
      const opcode = instr.opcode?.toUpperCase() ?? '';
      if (opcode.startsWith('S')) {
        const storeRegType: RegisterType = info.target === 'V' ? 'V' : (info.target === 'F' || info.target === 'D') ? 'F' : 'R';
        const storeIsDouble = info.target === 'D';
        const op2 = this.getOperandValue(storeRegType, rt, opcode, selfRobTag, storeIsDouble);
        v2 = op2.value;
        q2 = op2.tag;
        v2Ready = op2.ready;
      } else if (opcode === 'LVWS' || opcode === 'LVI') {
        // LVWS/LVI: Necesitan un 2º operando en v2 (stride escalar o índices vectoriales)
        const regType: RegisterType = opcode === 'LVWS' ? 'R' : 'V';
        const regNum = instr.imm ?? 0;
        const op2 = this.getOperandValue(regType, regNum, opcode, selfRobTag, false);
        v2 = op2.value;
        q2 = op2.tag;
        v2Ready = op2.ready;
      }
    } else if (info.type === 'J' || info.type === 'C') {
      // Jumps: JR/JALR necesitan rs1 que ya está en v1
      // J/JAL solo usan imm
      // No necesitan v2
    }

    return { v1, q1, v1Ready, v2, q2, v2Ready, vl, qVL, vlReady };
  }

  /**
   * Helper para obtener un valor float desde el ARF con control de excepciones
   * Marca FP_INVALID_OPERATION si el alnieamiento no es correcto
   * TODO: meter un tipo de excepcionCode que sea propio del alineamiento FP
   * @param index
   * @param isDouble
   * @param opcode
   * @param robTag
   */
  override getFloatValue(index: number, isDouble: boolean, opcode?: string, robTag?: ROBTag): number {
    try {
      return this.registerFile.getFloatRegister(index, isDouble);
    } catch (e: any) {
      if (e instanceof RegisterAlignmentError) {
        if (robTag) {
          this.rob.markException(robTag.slot, ExceptionCode.FP_INVALID_OPERATION);
        } else {
          this.addLog(`EXCEPCIÓN NO PRECISA: ${e.message} en operación ${opcode}`, 'error');
          this.pause();
        }
      }
      return 0;
    }
  }

  /**
   * Helper para guardar un valor float al ARF con control de excepciones
   * Marca FP_INVALID_OPERATION si el alnieamiento no es correcto
   * TODO: meter un tipo de excepcionCode que sea propio del alineamiento FP
   * @param index
   * @param value
   * @param isDouble
   * @param opcode
   * @param robTag
   */
  override setFloatValue(index: number, value: number, isDouble: boolean, opcode?: string, robTag?: ROBTag): void {
    try {
      return this.registerFile.writeFloatRegister(index, value, isDouble);
    } catch (e: any) {
      if (e instanceof RegisterAlignmentError) {
        if (robTag) {
          this.rob.markException(robTag.slot, ExceptionCode.FP_INVALID_OPERATION);
        } else {
          this.addLog(`EXCEPCIÓN NO PRECISA: ${e.message} en operación ${opcode}`, 'error');
          this.pause();
        }
      }
    }
  }

  /**
   * Helper para obtener el valor de un operando, primero consulta si el registro buscado esta reescrito en RRF y si no obtiene su valor del ARF
   * @param type
   * @param regNum
   * @param opcode
   * @param selfRobTag
   * @param isDouble
   * @private
   */
  private getOperandValue(type: RegisterType, regNum: number, opcode:string, selfRobTag: ROBTag, isDouble: boolean = false): {
    value: number | null; tag: ROBTag | null; ready: boolean;
  } {
    // R0 siempre es 0
    if (type === 'R' && regNum === 0)
      return { value: 0, tag: null, ready: true };

    // Consultar RRF (Figura 2.40: si Ocupado=1, leer de ROB[Índice]; si no, leer Datos del banco de registros)
    const rrfResult = this.rrf.lookup(type, regNum);
    const robTagInfo = rrfResult.ocupado ? `${rrfResult.robTag.slot}:${rrfResult.robTag.generation}` : 'none';
    const selfRobTagInfo = `${selfRobTag.slot}:${selfRobTag.generation}`
    //console.log(`[getOperandValue] selfRobTag=${selfRobTag.slot}:${selfRobTag.generation}, type=${type}, regNum=${regNum}, ocupado=${rrfResult.ocupado}, robTag=${robTagInfo}`);

    if (!rrfResult.ocupado || (rrfResult.ocupado && (robTagInfo === selfRobTagInfo))) {
      // Ocupado=0: Valor disponible en registro arquitectónico
      const value = this.readArchitecturalRegister(type, regNum, isDouble, opcode, selfRobTag);
      //console.log(`[getOperandValue] Reading from architectural register: value=${value}`);
      return { value, tag: null, ready: true };
    }

    // Ocupado=1: Hay dependencia, consultar ROB[Índice]
    const robResult = this.rob.lookupValue(rrfResult.robTag);
    if (robResult.found) {
      // Valor ya disponible en el ROB
      //console.log(`[getOperandValue] ROB[${rrfResult.robTag.slot}:${rrfResult.robTag.generation}] value available: ${robResult.value}`);
      if (type === 'V' && robResult.vectorValue)
        return { value: 0, tag: null, ready: true };
      return { value: robResult.value ?? 0, tag: null, ready: true };
    } else if (robResult.stale) {
      // ROBTag stale: el productor ya hizo commit, leer del registro arquitectónico
      //console.log(`[getOperandValue] ROB[${rrfResult.robTag.slot}:${rrfResult.robTag.generation}] is STALE, reading from ARF`);
      const value = this.readArchitecturalRegister(type, regNum, isDouble, opcode, selfRobTag);
      return { value, tag: null, ready: true };
    }

    // Operando no disponible, esperar
    //console.log(`[getOperandValue] Waiting for ROB[${rrfResult.robTag.slot}:${rrfResult.robTag.generation}] (type=${type}, regNum=${regNum})`);
    return { value: null, tag: rrfResult.robTag, ready: false };
  }

  /**
   * Obtiene información del registro fuente de una instrucción
   * @param operandNum 1 para rs1/base, 2 para rs2/rt
   */
  private getSourceRegisterInfo(instr: AsgInstruction, operandNum: 1 | 2): { type: RegisterType; num: number } | null {
    const info = ASG_MAP[instr.opcode?.toUpperCase() ?? ''];
    if (!info) return null;

    const opcode = instr.opcode?.toUpperCase() ?? '';
    const regType: RegisterType = info.origin === 'V' ? 'V' : info.origin === 'F' || info.origin === 'D' ? 'F' : 'R';

    if (operandNum === 1) {
      // Para LOADS, base está en rs2; para otras, en rs1
      const regNum = (info.type === 'M' && !opcode.startsWith('S')) ? (instr.rs2 ?? 0) : (instr.rs1 ?? 0);
      // Tipo especial para instrucciones escalar-vector
      let rs1Type = regType;
      if (info.type === 'V' && opcode.includes('SV') /*&& !opcode.startsWith('S')*/) {
        rs1Type = 'F';
      }
      return { type: rs1Type, num: regNum };
    } else {
      // Operando 2 (rt)
      const regNum = instr.rs2 ?? 0;
      let rs2Type = regType;
      if (info.type === 'V') {
        if (opcode.includes('SV') /*&& !opcode.startsWith('S')*/) {
          rs2Type = 'V';
        } else if (opcode.includes('VS')) {
          rs2Type = 'F';
        }
      }
      if (info.type === 'M' && opcode.startsWith('S')) {
        // Store: rs2 tiene el tipo del target
        rs2Type = info.target === 'V' ? 'V' : (info.target === 'F' || info.target === 'D') ? 'F' : 'R';
      }
      return { type: rs2Type, num: regNum };
    }
  }

  /**
   * Lee un valor directamente del registro arquitectónico (sin consultar RRF)
   */
  private readArchitecturalRegister(type: RegisterType, regNum: number, isDouble: boolean, opcode:string, robTag: ROBTag): number {
    if (type === 'R') {
      return this.registerFile.readIntRegister(regNum);
    } else if (type === 'F') {
      return this.getFloatValue(regNum, isDouble, opcode, robTag);
    } else if (type === 'FPBC') {
      return this.registerFile.fpConditionBit();
    } else if (type === 'VLR') {
      return this.registerFile.vl();
    } else {
      // Tipo 'V': placeholder, el valor real se lee durante ejecución en executeVectorALU
      return 0;
    }
  }

  /**
   * Helper para emitir instrucciones distribuidas desde las RS a UF
   * @param currentCycle
   * @private
   */
  private issueFromRS(currentCycle: number): void {
    // No emitir instrucciones si TRAP está esperando stdin
    if (this.trapStdinRequest()) {
      this.addLog('[II-E] TRAP esperando entrada stdin, bloqueo de issue a UF', 'warning');
      return;
    }

    // Obtener instrucciones distribuidas que pueden emitir
    const dispatched = Array.from(this.inFlight.values()).filter(inf => inf.state === 'DISPATCHED');
    //console.log(`[II-E] ${dispatched.length} instructions dispatched, checking for issue`);

    for (const inflight of dispatched) {
      const fuType = getFunctionalUnitType(inflight.instr.opcode ?? 'NOP');
      const isVector = inflight.instr.isVector ?? false;

      // Verificar disponibilidad de UF
      let canOverlapInit = false;
      if (!this.fuPool.hasAvailable(fuType)) {
        // Para instrucciones vectoriales, verificar si podemos solapar init (si está habilitado en la configuracion)
        if (isVector && this.isVectorInitOverlapEnabled() && this.fuPool.hasAvailableForVectorOverlap(fuType)) {
          // Verificar que la instrucción actual en la FU ya pasó del init
          const overlappableFuId = this.fuPool.getOverlappableFU(fuType);
          if (overlappableFuId !== -1) {
            const currentInFU = Array.from(this.inFlight.values()).find(
              inf => inf.fuId === overlappableFuId && inf.state === 'EXECUTING'
            );
            // Solo permitir solapamiento si la instrucción actual ya pasó del init
            if (currentInFU && currentInFU.vectorPhase !== 'init') {
              canOverlapInit = true;
            }
          }
        }
        if (!canOverlapInit) {
          this.stats.structuralStalls++;
          continue;
        }
      }

      // DEBUG: mostrar todas las RS listas para este tipo
      //const allReady = this.rs.getReadyToIssue(fuType, 10);
      //console.log(`[II-E] Checking ${inflight.instr.opcode} (robTag=[${inflight.robTag?.slot}][${inflight.robTag?.generation}], fuType=${fuType}): ready RS count=${allReady.length}, ready destinos=[${allReady.map(r => r.destino).join(',')}]`);

      // Obtener RS listas para este tipo
      const ready = this.rs.getReadyToIssue(fuType, 1);
      if (ready.length === 0 || !robTagEquals(ready[0].destino, inflight.robTag)) continue;

      const rsEntry = ready[0];

      // MEMORY ORDERING: Los loads (escalares y vectoriales) deben esperar a que stores anteriores calculen su dirección
      if (this.isLoadInstruction(inflight.instr)) {
        if (!this.canIssueLoad(inflight.robTag)) {
          this.addLog(`II-E: ${inflight.instr.opcode} load bloqueado, esperando store pendiente`, 'warning');
          continue;
        }
      }

      // CONVOYS VECTORIALES: Verificar si una instrucción vectorial puede emitir. Las instrucciones vectoriales pueden formar convoy si:
      // No hay dependencias estructurales (ya verificado antes, si llega aquí esto se cumple)
      // Si hay dependencias de datos (RAW), el productor ya debe estar ejecutando para aprovechar chaining elemento-por-elemento
      if (isVector && !this.canIssueAsConvoy(inflight)) {
        this.addLog(`II-E: ${inflight.instr.opcode} bloqueado. esperando dependencias de datos`, 'warning');
        continue;
      }

      // Reservar UF (normal o como pendiente para solapamiento)
      let fuId: number;
      if (canOverlapInit) {
        fuId = this.fuPool.reservePending(fuType, inflight.robTag!, inflight.rsIndex!, rsEntry);
        if (fuId !== -1) {
          inflight.isPendingOnFU = true;
          this.addLog(`II-E: ${inflight.instr.opcode} → FU[${fuId}] (solapamiento de init)`, 'info');
        }
      } else {
        fuId = this.fuPool.reserve(fuType, inflight.robTag!, inflight.rsIndex!, rsEntry);
      }
      if (fuId === -1) continue;

      // Marcar RS como no lista para evitar que getReadyToIssue la devuelva de nuevo en el mismo ciclo para otras instrucciones
      rsEntry.lista = false;
      // Capturar operandos para usar durante ejecución
      inflight.execV1 = rsEntry.v1 ?? 0;
      inflight.execV2 = rsEntry.v2 ?? 0;
      inflight.execVL = rsEntry.vVL ?? this.registerFile.vl();
      // Actualizar estado
      inflight.fuId = fuId;
      inflight.state = 'ISSUED';
      inflight.cycleII_E = currentCycle;  // Registrar ciclo de Emisión

      // FIX: Para instrucciones vectoriales, registrar INMEDIATAMENTE en vRegisterStatus
      // Esto previene que la siguiente instrucción verifica convoy antes de que el productor actualice el estado en la etapa EX
      if (isVector && inflight.instr.rd !== undefined) {
        this.registerFile.setVectorRegisterStatus(inflight.instr.rd, {
          instrId: inflight.id,
          lastElementReady: -1  // Ningún elemento listo aún (esperando initDelay)
        });
      }

      // Marcar en ROB
      this.rob.markIssued(inflight.robTag!.slot);
      this.addLog(`II-E: ${inflight.instr.opcode} → FU[${fuId}]`, 'info');
    }
  }

  /**
   * Etapa de ejecucion
   * TODO: quitar comprobaciones a mano de opcodes
   * @param currentCycle
   * @private
   */
  private stageEX(currentCycle: number): void {
    // Actualizar cyclesRemainingEX ANTES del tick
    const busyUnitsBeforeTick = this.fuPool.getBusyUnits();
    for (const unit of busyUnitsBeforeTick) {
      if (unit.robTag !== null) {
        const inflight = this.findInflightByRobTag(unit.robTag);
        if (inflight) {
          // Para instrucciones vectoriales, calcular basándose en las fases
          if (inflight.instr.isVector && inflight.vectorPhase !== null) {
            const vl = inflight.execVL;
            const op = inflight.instr.opcode.toUpperCase();
            const isMemoryOp = ['LV', 'SV', 'LVWS', 'SVWS', 'LVI', 'SVI'].includes(op);
            const lanes = isMemoryOp ? this.memoryLanes() : this.aluLanes();
            const elementsRemaining = vl - inflight.currentElement;
            const processingCyclesRemaining = Math.ceil(elementsRemaining / lanes);

            if (inflight.vectorPhase === 'init') {
              // En init: ciclos de init + procesamiento + end
              inflight.cyclesRemainingEX = inflight.cyclesRemainingInPhase + processingCyclesRemaining + inflight.endDelay;
            } else if (inflight.vectorPhase === 'processing') {
              // En processing: ciclos de procesamiento + end
              inflight.cyclesRemainingEX = processingCyclesRemaining + inflight.endDelay;
            } else if (inflight.vectorPhase === 'end') {
              // En end: solo ciclos de end
              inflight.cyclesRemainingEX = inflight.cyclesRemainingInPhase;
            }
          } else {
            // Instrucciones escalares: usar cyclesRemaining de la UF
            inflight.cyclesRemainingEX = unit.cyclesRemaining;
          }
        }
      }
    }

    // Marcar instrucciones como en ejecución
    for (const inflight of this.inFlight.values()) {
      if (inflight.state === 'ISSUED' && inflight.cycleEX === null) {
        inflight.state = 'EXECUTING';
        inflight.cycleEX = currentCycle;

        // Si es vector, inicializar fases de ejecución
        if (inflight.instr.isVector) {
          const delays = this.getVectorDelays(inflight.instr.opcode);
          inflight.initDelay = delays.initDelay;
          inflight.endDelay = delays.endDelay;

          // Stores empiezan en fase 'processing', otros en 'init'
          const isStore = ['SV', 'SVWS', 'SVI'].includes(inflight.instr.opcode.toUpperCase());
          if (isStore) {
            inflight.vectorPhase = 'processing';
            inflight.cyclesRemainingInPhase = 0; // Procesa inmediatamente
            // Preparar vectorStoreData para stores vectoriales
            const op = inflight.instr.opcode.toUpperCase();
            if (op === 'SV' || op === 'SVWS' || op === 'SVI') {
              const imm = inflight.instr.imm ?? 0;
              let baseAddr: number;
              let storeImm: number;

              if (op === 'SV') {
                // SV: execV1 es base, imm es offset
                baseAddr = inflight.execV1 + imm;
                storeImm = 0;
              } else {
                // SVWS/SVI: execV1 es base, imm es número de registro stride/índices
                baseAddr = inflight.execV1;
                storeImm = imm;
              }

              this.executeVectorStore(inflight.instr, baseAddr, storeImm, inflight.robTag!.slot, inflight.execVL);
            }
          } else {
            inflight.vectorPhase = 'init';
            inflight.cyclesRemainingInPhase = delays.initDelay;
          }

          // CONVOY CON SOLAPAMIENTO DE INIT: Liberar dependencias aqui para que las instrucciones dependientes emitan mientras el productor esta en fase init, solapando
          // El control de datos se hace en checkVectorChainingPossibility. vRegisterStatus ya se actualizó en II-E al emitir, cuando lo actualizaba aqui, fallaba el solapamiento y entraba en bucle infinito
          this.releaseVectorDependencies(inflight.robTag!);
        }
      }
    }

    // VECTOR CHAINING: Procesar elementos incrementalmente durante ejecución
    const finishedVectorInstructions: { unitId: number; robTag: ROBTag; result: number; vectorResult: Float64Array | null }[] = [];
    for (const inflight of this.inFlight.values()) {
      if (inflight.state === 'EXECUTING' && inflight.instr.isVector && inflight.vectorPhase !== null) {
        this.processVectorElementsIncremental(inflight);

        // Si terminó (vectorPhase = null), liberar UF
        if (inflight.vectorPhase === null && inflight.fuId !== null) {
          const fin = this.fuPool.finishVectorInstruction(inflight.fuId);
          if (fin) {
            finishedVectorInstructions.push(fin);
            this.addLog(`[EX] ${inflight.instr.opcode} vector completo, finalizadas todas las fases, liberando FU[${inflight.fuId}]`, 'info');
          }
        }
      }
    }

    // Avanzar ciclo en UFs ESCALARES y obtener las que terminaron
    const finishedScalarInstructions = this.fuPool.tick(currentCycle);

    // Combinar instrucciones escalares y vectoriales terminadas
    const finished = [...finishedScalarInstructions, ...finishedVectorInstructions];

    // IMPORTANTE: Procesar STORES primero, luego LOADS para garantizar que si un store y un load terminan en el mismo ciclo, el store actualice primero su storeAddress/storeValue en el ROB,permitiendo que el load haga forwarding correctamente.

    // Separar stores y loads
    const stores = finished.filter(fin => {
      const inf = this.findInflightByRobTag(fin.robTag);
      return inf && this.isStoreInstruction(inf.instr);
    });
    const nonStores = finished.filter(fin => {
      const inf = this.findInflightByRobTag(fin.robTag);
      return inf && !this.isStoreInstruction(inf.instr);
    });

    // Procesar stores primero
    for (const fin of stores) {
      this.executeFinishedInstruction(fin, currentCycle);
    }

    // Luego procesar el resto (loads y otras instrucciones)
    for (const fin of nonStores) {
      this.executeFinishedInstruction(fin, currentCycle);
    }
  }

  /**
   * Helper para ejecutar una instruccion y geenerar el resultado
   * @param fin
   * @param currentCycle
   * @private
   */
  private executeFinishedInstruction(fin: { unitId: number; robTag: ROBTag; result: number; vectorResult: Float64Array | null }, currentCycle: number): void {
    const inflight = this.findInflightByRobTag(fin.robTag);
    if (!inflight) return;

    // Para instrucciones vectoriales, el resultado ya fue calculado incrementalmente
    // Para instrucciones escalares, calcularlo ahora
    //console.log(`[executeFinishedInstruction] ${inflight.instr.opcode} isVector=${inflight.instr.isVector}`);
    if (inflight.instr.isVector) {
      // Resultado vectorial ya está en inflight.vectorResult, copiarlo al ROB
      const robEntry = this.rob.getEntry(inflight.robTag!.slot);
      if (robEntry) {
        robEntry.valor = 0;
        robEntry.vectorResult = inflight.vectorResult;
        //console.log(`[executeFinishedInstruction] Vector instruction, setting valor=0`);
      }
    } else {
      // Calcular resultado escalar
      const result = this.executeInstruction(inflight.instr, inflight);
      //console.log(`[executeFinishedInstruction] Scalar result: value=${result.value}`);

      // Si la instrucción debe esperar (partial overlap con stores pendientes o TRAP 3 esperando stdin)
      if (result.stall) {
        //console.log(`[executeFinishedInstruction] ${inflight.instr.opcode} robTag=[${inflight.robTag?.slot}][${inflight.robTag?.generation}] returned stall=true`);
        // Re-reservar la UF por 1 ciclo más
        const fuType = getFunctionalUnitType(inflight.instr.opcode ?? 'NOP');
        // Buscar la entrada RS por robTag
        const rsEntry = this.rs.getAllOccupied().find(e => robTagEquals(e.destino, inflight.robTag));
        if (rsEntry && inflight.rsIndex !== null) {
          const newFuId = this.fuPool.reserve(fuType, inflight.robTag!, inflight.rsIndex, rsEntry);
          if (newFuId >= 0) {
            inflight.fuId = newFuId;
            // Mantener en estado EXECUTING - se reintentará el próximo ciclo
            //console.log(`[executeFinishedInstruction] Re-reserved FU[${newFuId}], will retry next cycle`);
            this.addLog(`[EX] ${inflight.instr.opcode} stalled: ejecutando...`, 'info');
            return; // NO transicionar a FINISHED
          }
        }
        // Si no hay UF disponible, stall de todos modos (se retomará después)
        //console.log(`[executeFinishedInstruction] No FU available for re-reservation`);
        this.addLog(`${inflight.instr.opcode} stalled: UF no disponible en este ciclo`, 'warning');
        return;
      }

      // Guardar resultado temporalmente en la entrada ROB (para que WR lo publique)
      const robEntry = this.rob.getEntry(inflight.robTag!.slot);
      if (robEntry) {
        robEntry.valor = result.value;
        robEntry.vectorResult = result.vectorResult;
      }
    }

    // Resolver branches en EX
    if (inflight.isBranch && !inflight.branchResolved)
      this.resolveBranch(inflight, currentCycle);

    inflight.state = 'FINISHED';
  }

  /**
   * Resuelve un branch: evalúa el resultado real y detecta misprediction
   */
  private resolveBranch(inflight: InFlightInstruction, currentCycle: number): void {
    const instr = inflight.instr;
    const op = instr.opcode?.toUpperCase() ?? '';
    const pc = inflight.pc;

    // Obtener el valor del registro fuente para branches condicionales
    const v1 = inflight.execV1;
    // Evaluar condición del branch. el ensamblador guarda la dirección absoluta / 4 en imm, por lo que el target = imm * 4
    let actualTaken = false;
    const imm = instr.imm ?? 0;
    const branchTarget = imm * 4; // Dirección absoluta del salto

    switch (op) {
      case 'BEQZ':
        actualTaken = (v1 | 0) === 0;
        break;
      case 'BNEZ':
        actualTaken = (v1 | 0) !== 0;
        break;
      case 'BGTZ':
        actualTaken = (v1 | 0) > 0;
        break;
      case 'BLTZ':
        actualTaken = (v1 | 0) < 0;
        break;
      case 'J':
      case 'JAL':
        actualTaken = true;
        break;
      case 'JR':
      case 'JALR':
        actualTaken = true;
        break;
      case 'BFPT':
        actualTaken = v1 === 1;
        break;
      case 'BFPF':
        actualTaken = v1 === 0;
        break;
    }

    // Calcular target real
    let actualTarget: number;
    if (op === 'JR' || op === 'JALR') {
      // Saltos por registro: target es el valor del registro
      actualTarget = v1;
    } else {
      // Saltos directos: target = imm * 4 si tomado, pc + 4 si no
      actualTarget = actualTaken ? branchTarget : (pc + 4);
    }

    inflight.branchResolved = true;
    inflight.actualTaken = actualTaken;
    inflight.actualTarget = actualTarget;

    // Actualizar ROB con resultado real
    const mispredicted = this.rob.updateBranchResult(
      inflight.robTag!.slot,
      actualTaken,
      actualTarget
    );

    // Actualizar predictor con resultado real
    if (inflight.prediction) {
      this.branchPredictor.update(
        pc,
        actualTaken,
        actualTarget,
        inflight.prediction.ghrSnapshot,
        inflight.prediction.localTaken,
        inflight.prediction.globalTaken
      );
    }

    if (mispredicted) {
      this.stats.branchMispredictions++;

      // Si el camino que realmente tomamos coincide con el correcto, no necesitamos hacer flush - las instrucciones en el pipeline son correctas.
      // El camino real depende de predictedTaken: si true → predictedTarget, si false → PC+4
      const predictedTaken = inflight.prediction?.taken ?? false;
      const predictedTarget = inflight.prediction?.target ?? (pc + 4);
      const actualPathTaken = predictedTaken ? predictedTarget : (pc + 4);
      if (actualPathTaken === actualTarget) {
        this.addLog(`EX: ${op} misprediction, pero camino correcto. Sin flush.`, 'info');
        // Aún así, restaurar GHR al estado correcto
        if (inflight.prediction) {
          this.branchPredictor.rollbackGHR(
            inflight.prediction.ghrSnapshot,
            actualTaken
          );
        }
        // Limpiar checkpoint ya que no hubo flush real
        this.rrfCheckpoints.delete(inflight.robTag!.slot);
        this.speculationDepth = Math.max(0, this.speculationDepth - 1);
      } else {
        this.addLog(`EX: ${op} MISPREDICTION! Pred=${inflight.prediction?.taken}, Real=${actualTaken}, flush pipeline`, 'warning');
        this.flushSpeculativeState(inflight, actualTarget, currentCycle);
      }
    } else {
      // Branch correcto: limpiar checkpoint ya que no se necesita
      this.rrfCheckpoints.delete(inflight.robTag!.slot);
      this.speculationDepth = Math.max(0, this.speculationDepth - 1);
      this.addLog(`EX: ${op} predicción correcta`, 'info');
    }
  }

  /**
   * Flush especulativo: descarta instrucciones tras un branch mal predicho
   */
  private flushSpeculativeState(branchInflight: InFlightInstruction, correctTarget: number, currentCycle: number): void {
    const branchTag = branchInflight.robTag;
    if (!branchTag) return; // No debería pasar, pero por seguridad
    // Restaurar RRF desde checkpoint
    const checkpoint = this.rrfCheckpoints.get(branchTag.slot);
    if (checkpoint) {
      this.rrf.restore(checkpoint);
      this.rrfCheckpoints.delete(branchTag.slot);
    }
    // Limpiar entradas RRF que apunten a ROB tags ya retirados. El checkpoint puede tener referencias a instrucciones que ya hicieron commit antes de que el branch resolviera
    this.clearStaleRRFEntries();
    // Limpiar todos los checkpoints posteriores al branch ya que no son validos
    for (const [tag] of this.rrfCheckpoints) {
      if (this.rob.isTagAfter(tag, branchTag.slot)) {
        this.rrfCheckpoints.delete(tag);
      }
    }
    // Flush ROB: descartar instrucciones DESPUÉS del branch
    const nextSlot = (branchTag.slot + 1) % this.rob.getSize();
    const flushedFromROB = this.rob.flushFrom(nextSlot);
    // Flush RS: descartar entradas con tags descartados
    this.rs.flushFrom(nextSlot, this.rob.getHeadTag(), this.rob.getSize());
    // Liberar UFs que estaban ejecutando instrucciones descartadas
    this.fuPool.flushFrom(nextSlot, this.rob.getHeadTag(), this.rob.getSize());
    // Marcar instrucciones en vuelo como flushed. OJO!! No marcar instrucciones ya retiradas - sus robTags pueden parecer después del branch debido a la aritmética circular del ROB, pero ya se terminaron y son validas
    let flushedInflight = 0;
    let flushedNotInROB = 0; // Instrucciones sin robTag (no decodificadas aún)
    const branchId = branchInflight.id;
    for (const [id, inf] of this.inFlight) {
      // Saltamos instrucciones ya retiradas o la propia instrucción de branch
      if (inf.state === 'RETIRED' || inf.id === branchId) continue;

      // Marcar como flushed si:
      // - Tiene robTag y está después del branch en el ROB
      // - No tiene robTag pero fue fetcheada después del branch (id mayor)
      const hasRobTag = inf.robTag !== null && inf.robTag.slot !== -1;
      const shouldFlush = (hasRobTag && this.rob.isTagAfter(inf.robTag!.slot, branchTag.slot)) || (!hasRobTag && inf.id > branchId);

      if (shouldFlush) {
        inf.flushed = true;
        inf.state = 'FLUSHED' as InstructionState;
        flushedInflight++;
        if (!hasRobTag) flushedNotInROB++;

        // Limpiar vRegisterStatus si la instrucción estaba escribiendo un registro vectorial
        if (inf.instr.isVector && inf.instr.rd !== undefined) {
          const status = this.registerFile.getVectorRegisterStatus(inf.instr.rd);
          if (status && status.instrId === inf.id) {
            this.registerFile.deleteVectorRegisterStatus(inf.instr.rd);
          }
        }
      }
    }
    // Limpiar fetch buffer (instrucciones ya fetched pero no decodificadas)
    this.fetchBuffer.instructions = [];
    this.fetchBuffer.pcs = [];
    // Restaurar GHR al estado correcto usando el snapshot
    if (branchInflight.prediction) {
      this.branchPredictor.rollbackGHR(
        branchInflight.prediction.ghrSnapshot,
        branchInflight.actualTaken ?? false
      );
    }
    // Corregir PC
    this.pc = correctTarget;
    // Recalcular profundidad de especulación. El depth es el número de saltos en vuelo (no flusheados)
    this.speculationDepth = Array.from(this.inFlight.values()).filter(
      inf => inf.isBranch && !inf.flushed && inf.state !== 'RETIRED'
    ).length;
    // Actualizar estadísticas de flush
    // flushedFromROB: instrucciones que estaban en el ROB
    // flushedNotInROB: instrucciones fetcheadas pero no decodificadas aún
    this.stats.flushedInstructions += flushedFromROB + flushedNotInROB;

    this.addLog(`FLUSH: ${flushedFromROB} ROB + ${flushedNotInROB} fetch descartadas, PC→${correctTarget}, speculationDepth=${this.speculationDepth}`, 'warning');
  }

  /**
   * Flush completo del pipeline (para RFE)
   * Descarta todas las instrucciones en vuelo excepto las ya retiradas
   */
  private flushPipeline(): void {
    // Limpiar ROB (todas las entradas no retiradas)
    this.rob.reset();
    // Limpiar estaciones de reserva
    this.rs.reset();
    // Limpiar pool de unidades funcionales
    this.fuPool.reset();
    // Limpiar RRF (reiniciar estado de renombramiento)
    this.rrf.reset();
    // Limpiar tracking de vector chaining
    this.registerFile.clearVectorRegisterStatus();
    // Limpiar instrucciones retiradas (ya no relevantes después de flush)
    this.lastRetiredInFlight = [];
    // Marcar instrucciones en vuelo como flushed
    for (const [id, inf] of this.inFlight) {
      if (inf.state !== 'RETIRED') {
        inf.flushed = true;
        inf.state = 'FLUSHED' as InstructionState;
      }
    }
    // Limpiar fetch buffer
    this.fetchBuffer.instructions = [];
    this.fetchBuffer.pcs = [];
    // Limpiar checkpoints
    this.rrfCheckpoints.clear();
    // Resetear profundidad de especulación
    this.speculationDepth = 0;
    this.addLog('FLUSH: Pipeline vaciado', 'warning');
  }

  /**
   * Limpia entradas RRF que apuntan a ROB tags que ya no son válidos (instrucciones que hicieron commit antes de que un branch resolviera)
   * TODO: refactorizar para eliminar codigo repetido en los bucles
   */
  private clearStaleRRFEntries(): void {
    const rrfState = this.rrf.getState();

    // Verificar registros enteros
    for (let i = 0; i < rrfState.intRegs.length; i++) {
      const entry = rrfState.intRegs[i];
      if (entry.ocupado && entry.indice !== null) {
        const robEntry = this.rob.getEntry(entry.indice.slot);
        // Limpiar si: ROB no ocupado, si el ROB entry no escribe a este registro, o si el flag generation no coincide (slot reutilizado por nueva instrucción)
        const isStale = !robEntry || !robEntry.ocupada || robEntry.tipoReg !== 'R' || robEntry.regDestino !== i || robEntry.generation !== entry.indice.generation;
        if (isStale) {
          this.rrf.clearRename('R', i, entry.indice);
        }
      }
    }

    // Verificar registros flotantes
    for (let i = 0; i < rrfState.floatRegs.length; i++) {
      const entry = rrfState.floatRegs[i];
      if (entry.ocupado && entry.indice !== null) {
        const robEntry = this.rob.getEntry(entry.indice.slot);
        const isStale = !robEntry || !robEntry.ocupada || robEntry.tipoReg !== 'F' || robEntry.regDestino !== i || robEntry.generation !== entry.indice.generation;
        if (isStale) {
          this.rrf.clearRename('F', i, entry.indice);
        }
      }
    }

    // Verificar registros vectoriales
    for (let i = 0; i < rrfState.vectorRegs.length; i++) {
      const entry = rrfState.vectorRegs[i];
      if (entry.ocupado && entry.indice !== null) {
        const robEntry = this.rob.getEntry(entry.indice.slot);
        const isStale = !robEntry || !robEntry.ocupada || robEntry.tipoReg !== 'V' || robEntry.regDestino !== i || robEntry.generation !== entry.indice.generation;
        if (isStale) {
          this.rrf.clearRename('V', i, entry.indice);
        }
      }
    }

    // Verificar FPBC (Floating-Point Bit Condition)
    for (let i = 0; i < rrfState.fpbcRegs.length; i++) {
      const entry = rrfState.fpbcRegs[i];
      if (entry.ocupado && entry.indice !== null) {
        const robEntry = this.rob.getEntry(entry.indice.slot);
        const isStale = !robEntry || !robEntry.ocupada || robEntry.tipoReg !== 'FPBC' || robEntry.regDestino !== i || robEntry.generation !== entry.indice.generation;
        if (isStale) {
          this.rrf.clearRename('FPBC', i, entry.indice);
        }
      }
    }

    // Verificar VLR (Vector Length Register)
    for (let i = 0; i < rrfState.vlrRegs.length; i++) {
      const entry = rrfState.vlrRegs[i];
      if (entry.ocupado && entry.indice !== null) {
        const robEntry = this.rob.getEntry(entry.indice.slot);
        const isStale = !robEntry || !robEntry.ocupada || robEntry.tipoReg !== 'VLR' || robEntry.regDestino !== i || robEntry.generation !== entry.indice.generation;
        if (isStale) {
          this.rrf.clearRename('VLR', i, entry.indice);
        }
      }
    }

    // Verificar VM (Vector Mask)
    for (let i = 0; i < rrfState.vmRegs.length; i++) {
      const entry = rrfState.vmRegs[i];
      if (entry.ocupado && entry.indice !== null) {
        const robEntry = this.rob.getEntry(entry.indice.slot);
        const isStale = !robEntry || !robEntry.ocupada || robEntry.tipoReg !== 'VM' || robEntry.regDestino !== i || robEntry.generation !== entry.indice.generation;
        if (isStale) {
          this.rrf.clearRename('VM', i, entry.indice);
        }
      }
    }
  }

  /**
   * Helper ALU del superescalar con marcado de excepciones en robTag
   * TODO: sacar esta ALU a un servicio independiente del procesador que no dependa del acoplamiento de las excepciones particulares del procesador
   * @param instr
   * @param inflight
   * @private
   */
  private executeInstruction(instr: AsgInstruction, inflight: InFlightInstruction): {
    value: number; vectorResult: Float64Array | null; stall: boolean;
  } {
    const op = instr.opcode ?? '';

    // Usar operandos capturados durante emisión
    const v1 = inflight.execV1;
    const v2 = inflight.execV2;
    const imm = instr.imm ?? 0;

    // Helper para verificar excepciones FP (IEEE 754)
    const checkFPException = (res: number): void => {
      if (isNaN(res)) {
        this.rob.markException(inflight.robTag!.slot, ExceptionCode.FP_INVALID_OPERATION);
      } else if (!isFinite(res)) {
        this.rob.markException(inflight.robTag!.slot, ExceptionCode.FP_OVERFLOW);
      } else if (res !== 0 && Math.abs(res) < Number.MIN_VALUE) {
        this.rob.markException(inflight.robTag!.slot, ExceptionCode.FP_UNDERFLOW);
      }
    };

    let value = 0;

    switch (op) {
      // Aritmetica entera
      case 'ADD': {
        const res = (v1 + v2) | 0;
        // Detección de overflow en suma con signo: Si los operandos tienen el mismo signo y el resultado tiene signo contrario
        if (((v1 ^ res) & (v2 ^ res)) < 0)
          this.rob.markException(inflight.robTag!.slot, ExceptionCode.ARITHMETIC_OVERFLOW);
        value = res;
        break;
      }
      case 'ADDI': {
        const res = (v1 + imm) | 0;
        // Detección de overflow en suma inmediata con signo
        if (((v1 ^ res) & (imm ^ res)) < 0)
          this.rob.markException(inflight.robTag!.slot, ExceptionCode.ARITHMETIC_OVERFLOW);
        value = res;
        break;
      }
      case 'SUB': {
        const res = (v1 - v2) | 0;
        // Detección de overflow en resta con signo: Si los operandos tienen signos distintos y el signo del resultado es distinto al de v1
        if (((v1 ^ v2) & (v1 ^ res)) < 0)
          this.rob.markException(inflight.robTag!.slot, ExceptionCode.ARITHMETIC_OVERFLOW);
        value = res;
        break;
      }
      case 'SUBI': {
        const res = (v1 - imm) | 0;
        if (((v1 ^ imm) & (v1 ^ res)) < 0)
          this.rob.markException(inflight.robTag!.slot, ExceptionCode.ARITHMETIC_OVERFLOW);
        value = res;
        break;
      }
      case 'MULT':  value = (v1 * v2) | 0; break;
      case 'MULTI': value = (v1 * imm) | 0; break;
      case 'DIV':
        if (v2 === 0) {
          this.rob.markException(inflight.robTag!.slot, ExceptionCode.DIVISION_BY_ZERO);
          value = 0;
        } else {
          value = (v1 / v2) | 0;
        }
        break;
      case 'DIVI':
        if (imm === 0) {
          this.rob.markException(inflight.robTag!.slot, ExceptionCode.DIVISION_BY_ZERO);
          value = 0;
        } else {
          value = (v1 / imm) | 0;
        }
        break;
      // Aritmetica entera sin signo
      case 'ADDU':  value = ((v1 >>> 0) + (v2 >>> 0)) >>> 0; break;
      case 'ADDUI': value = ((v1 >>> 0) + (imm >>> 0)) >>> 0; break;
      case 'SUBU':  value = ((v1 >>> 0) - (v2 >>> 0)) >>> 0; break;
      case 'SUBUI': value = ((v1 >>> 0) - (imm >>> 0)) >>> 0; break;
      case 'MULTU': value = (v1 >>> 0) * (v2 >>> 0); break;
      case 'DIVU':
        if (v2 === 0) {
          this.rob.markException(inflight.robTag!.slot, ExceptionCode.DIVISION_BY_ZERO);
          value = 0;
        } else {
          value = Math.floor((v1 >>> 0) / (v2 >>> 0)) >>> 0;
        }
        break;
      // Operaciones Logicas
      case 'AND':   value = (v1 & v2) | 0; break;
      case 'ANDI':  value = (v1 & (imm & 0xFFFF)) | 0; break;
      case 'OR':    value = (v1 | v2) | 0; break;
      case 'ORI':   value = (v1 | (imm & 0xFFFF)) | 0; break;
      case 'XOR':   value = (v1 ^ v2) | 0; break;
      case 'XORI':  value = (v1 ^ (imm & 0xFFFF)) | 0; break;
      case 'LHI':   value = (imm << 16) | 0; break;
      // Desplazamientos
      case 'SLL':   value = (v1 << v2) | 0; break;
      case 'SLLI':  value = (v1 << imm) | 0; break;
      case 'SRL':   value = (v1 >>> v2) | 0; break;
      case 'SRLI':  value = (v1 >>> imm) | 0; break;
      case 'SRA':   value = (v1 >> v2) | 0; break;
      case 'SRAI':  value = (v1 >> imm) | 0; break;
      // Comparaciones enteras
      case 'SEQ':   value = (v1 | 0) === (v2 | 0) ? 1 : 0; break;
      case 'SNE':   value = (v1 | 0) !== (v2 | 0) ? 1 : 0; break;
      case 'SGT':   value = (v1 | 0) > (v2 | 0) ? 1 : 0; break;
      case 'SGE':   value = (v1 | 0) >= (v2 | 0) ? 1 : 0; break;
      case 'SLT':   value = (v1 | 0) < (v2 | 0) ? 1 : 0; break;
      case 'SLE':   value = (v1 | 0) <= (v2 | 0) ? 1 : 0; break;
      // Comparaciones inmediatas
      case 'SEQI':  value = (v1 | 0) === (imm | 0) ? 1 : 0; break;
      case 'SNEI':  value = (v1 | 0) !== (imm | 0) ? 1 : 0; break;
      case 'SGTI':  value = (v1 | 0) > (imm | 0) ? 1 : 0; break;
      case 'SGEI':  value = (v1 | 0) >= (imm | 0) ? 1 : 0; break;
      case 'SLTI':  value = (v1 | 0) < (imm | 0) ? 1 : 0; break;
      case 'SLEI':  value = (v1 | 0) <= (imm | 0) ? 1 : 0; break;
      //Comparaciones sin signo
      case 'SEQU':  value = (v1 >>> 0) === (v2 >>> 0) ? 1 : 0; break;
      case 'SNEU':  value = (v1 >>> 0) !== (v2 >>> 0) ? 1 : 0; break;
      case 'SGTU':  value = (v1 >>> 0) > (v2 >>> 0) ? 1 : 0; break;
      case 'SGEU':  value = (v1 >>> 0) >= (v2 >>> 0) ? 1 : 0; break;
      case 'SLTU':  value = (v1 >>> 0) < (v2 >>> 0) ? 1 : 0; break;
      case 'SLEU':  value = (v1 >>> 0) <= (v2 >>> 0) ? 1 : 0; break;
      // Comparaciones sin signo inmediatas
      case 'SEQUI': value = (v1 >>> 0) === (imm >>> 0) ? 1 : 0; break;
      case 'SNEUI': value = (v1 >>> 0) !== (imm >>> 0) ? 1 : 0; break;
      case 'SGTUI': value = (v1 >>> 0) > (imm >>> 0) ? 1 : 0; break;
      case 'SGEUI': value = (v1 >>> 0) >= (imm >>> 0) ? 1 : 0; break;
      case 'SLTUI': value = (v1 >>> 0) < (imm >>> 0) ? 1 : 0; break;
      case 'SLEUI': value = (v1 >>> 0) <= (imm >>> 0) ? 1 : 0; break;
      // Aritmetica flotante
      // Single precision (SP): aplicar Math.fround para consistencia con Float32Array de JS
      case 'ADDF':
        value = Math.fround(v1 + v2);
        checkFPException(value);
        break;
      case 'SUBF':
        value = Math.fround(v1 - v2);
        checkFPException(value);
        break;
      case 'MULTF':
        value = Math.fround(v1 * v2);
        checkFPException(value);
        break;
      case 'DIVF':
        if (v2 === 0) {
          this.rob.markException(inflight.robTag!.slot, ExceptionCode.FP_DIVISION_BY_ZERO);
          value = 0;
        } else {
          value = Math.fround(v1 / v2);
          checkFPException(value);
        }
        break;
      // Double precision (DP): mantener 64-bit completo, JS utiliza 64bit para el manejo de numeros, por lo que no hay que realizar ninguna conversion
      case 'ADDD':
        value = v1 + v2;
        checkFPException(value);
        break;
      case 'SUBD':
        value = v1 - v2;
        checkFPException(value);
        break;
      case 'MULTD':
        value = v1 * v2;
        checkFPException(value);
        break;
      case 'DIVD':
        if (v2 === 0) {
          this.rob.markException(inflight.robTag!.slot, ExceptionCode.FP_DIVISION_BY_ZERO);
          value = 0;
        } else {
          value = v1 / v2;
          checkFPException(value);
        }
        break;
      // Comparaciones flotante. No se actualiza directamente el FPBC aquí porque se pueden generar errores si las instrucciones son especuladas, arrastramos el valor del resultado hasta la etapa RI como cualquier otro registro
      case 'EQF': case 'EQD':
        value = v1 === v2 ? 1 : 0;
        break;
      case 'NEF': case 'NED':
        value = v1 !== v2 ? 1 : 0;
        break;
      case 'LTF': case 'LTD': case 'SLTF': case 'SLTD':
        value = v1 < v2 ? 1 : 0;
        break;
      case 'GTF': case 'GTD': case 'SGTF': case 'SGTD':
        value = v1 > v2 ? 1 : 0;
        break;
      case 'LEF': case 'LED': case 'SLEF': case 'SLED':
        value = v1 <= v2 ? 1 : 0;
        break;
      case 'GEF': case 'GED': case 'SGEF': case 'SGED':
        value = v1 >= v2 ? 1 : 0;
        break;
      // Conversiones entre registros float
      case 'CVTF2D': value = v1; break; // Float a Double
      case 'CVTI2D': // Integer (en registro float) a Double
      case 'CVTI2F': {
        // El registro float contiene un entero (movido con MOVI2FP). v1 tiene los bits interpretados como float. Recuperamos el entero original.
        const buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, v1, false);
        value = new DataView(buf).getInt32(0, false);
        break;
      }
      case 'CVTD2F': value = Math.fround(v1); break; // Double a Float
      case 'CVTF2I': case 'CVTD2I': value = Math.trunc(v1) | 0; break; // Float/Double a Integer
      // Movimientos entre registros
      case 'MOVF': case 'MOVD':
      case 'MOVI2S':  // val1 = Rs → WB escribe en VLR
      case 'MOVF2S':  // val1 = Fs → WB reinterpreta bits como bitmask de VM
        value = v1;
        break;
      case 'MOVI2FP': { // Rd(float) ← Rs(int) - copia bits sin conversión
        const buf = new ArrayBuffer(4);
        new DataView(buf).setInt32(0, v1 | 0, false);
        value = new DataView(buf).getFloat32(0, false);
        break;
      }
      case 'MOVFP2I': { // Rd(int) ← Rs(float) - copia bits sin conversión
        const buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, v1, false);
        value = new DataView(buf).getInt32(0, false);
        break;
      }
      case 'MOVS2I':  // Rd ← VLR, ya resuelto con renombramiento
        value = v1;
        break;
      case 'MOVS2F': { // Fd ← VM empaquetada como bitmask de 32 bits en float
        let mask = 0;
        const vm = this.registerFile.vectorMask();
        for (let i = 0; i < 32; i++) { if (vm[i] !== 0) mask |= (1 << i); }
        const buf = new ArrayBuffer(4);
        new DataView(buf).setInt32(0, mask, false);
        value = new DataView(buf).getFloat32(0, false);
        break;
      }
      case 'POP': { // Rd ← popcount(VM) - cuenta los 1s en la máscara vectorial
        let count = 0;
        const vm = this.registerFile.vectorMask();
        for (let i = 0; i < vm.length; i++) {
          if (vm[i] !== 0) count++;
        }
        value = count;
        break;
      }
      // Cargas de memoria
      // Para el store-to-load forwarding: verificar si hay un store pendiente a la misma dirección, si hay partial overlap (NEGATIVE_INFINITY), el load debe esperar a que los stores hagan commit
      case 'LW': case 'LB': case 'LH': case 'LBU': case 'LHU': {
        const loadAddr = (v1 + imm) | 0;
        const forwardedValue = this.checkStoreForwarding(loadAddr, op, inflight.robTag!.slot);
        if (forwardedValue === Number.NEGATIVE_INFINITY) {
          // Partial overlap con store pendiente - stall hasta que el store haga commit
          return { value: 0, vectorResult: null, stall: true };
        }
        value = forwardedValue !== null ? forwardedValue : this.readMemory(loadAddr, op, inflight.robTag!);
        break;
      }
      case 'LF': {
        const loadAddr = (v1 + imm) | 0;
        const forwardedValue = this.checkStoreForwarding(loadAddr, op, inflight.robTag!.slot);
        if (forwardedValue === Number.NEGATIVE_INFINITY) {
          return { value: 0, vectorResult: null, stall: true };
        }
        value = forwardedValue !== null ? forwardedValue : this.readMemoryFloat(loadAddr, false, inflight.robTag!);
        break;
      }
      case 'LD': {
        const loadAddr = (v1 + imm) | 0;
        const forwardedValue = this.checkStoreForwarding(loadAddr, op, inflight.robTag!.slot);
        if (forwardedValue === Number.NEGATIVE_INFINITY) {
          return { value: 0, vectorResult: null, stall: true };
        }
        value = forwardedValue !== null ? forwardedValue : this.readMemoryFloat(loadAddr, true, inflight.robTag!);
        //console.log(`[LD] addr=0x${loadAddr.toString(16)} (${loadAddr}), forwarded=${forwardedValue !== null}, value=${value}`);
        break;
      }
      // Store en memoria, guardamos la dirección en rsEntry.effectiveAddress y el valor a escribir. El store real se hace en RI (commit)
      case 'SW': case 'SB': case 'SH': case 'SF': case 'SD': {
        const storeAddr = (v1 + imm) | 0;
        const storeVal = v2; // rs2 contiene el valor a escribir
        // Guardar info de store en ROB
        const robEntry = this.rob.getEntry(inflight.robTag!.slot);
        if (robEntry) {
          robEntry.isStore = true;
          robEntry.storeAddress = storeAddr;
          robEntry.storeValue = storeVal;
        }
        value = storeVal; // Para referencia
        break;
      }
      // Saltos (resultado para JAL/JALR: dirección de retorno)
      case 'JAL': case 'JALR':
        value = inflight.pc + 4;
        break;
      // Trap
      case 'TRAP': {
        // EX: Leer parámetros de R14 y guardarlos en inflight.trapParams
        // El flush y pausa se harán en RI cuando TRAP llegue al head del ROB
        // v1 = valor de R14 (dirección base de parámetros)
        // traps de entrada y salida de informacion
        if (imm === 3 || imm === 4 || imm === 5) {
          // TRAP: leer parámetros respetando store forwarding
          const fdAddr = v1;
          const fdForwarded = this.checkStoreForwarding(fdAddr, 'LW', inflight.robTag!.slot);
          if (fdForwarded === Number.NEGATIVE_INFINITY) {
            //console.log(`[TRAP ${imm} EX] Stall: waiting for store to ${fdAddr}`);
            return { value: 0, vectorResult: null, stall: true };
          }
          const fd = fdForwarded !== null ? fdForwarded : this.readMemory(fdAddr, 'LW', inflight.robTag!);

          const bufAddrAddr = v1 + 4;
          const bufAddrForwarded = this.checkStoreForwarding(bufAddrAddr, 'LW', inflight.robTag!.slot);
          if (bufAddrForwarded === Number.NEGATIVE_INFINITY) {
            //console.log(`[TRAP ${imm} EX] Stall: waiting for store to ${bufAddrAddr}`);
            return { value: 0, vectorResult: null, stall: true };
          }
          const bufAddr = bufAddrForwarded !== null ? bufAddrForwarded : this.readMemory(bufAddrAddr, 'LW', inflight.robTag!);

          const maxBytesAddr = v1 + 8;
          const maxBytesForwarded = this.checkStoreForwarding(maxBytesAddr, 'LW', inflight.robTag!.slot);
          if (maxBytesForwarded === Number.NEGATIVE_INFINITY) {
            //console.log(`[TRAP ${imm} EX] Stall: waiting for store to ${maxBytesAddr}`);
            return { value: 0, vectorResult: null, stall: true };
          }
          const maxBytes = maxBytesForwarded !== null ? maxBytesForwarded : this.readMemory(maxBytesAddr, 'LW', inflight.robTag!);
          // Guardar params leídos de R14 para usar en RI
          inflight.trapParams = { fdAddr, fd, bufAddr, maxBytes };
          //console.log(`[TRAP ${imm} EX] Params saved: fd=${fd}, bufAddr=0x${bufAddr.toString(16)}, maxBytes=${maxBytes}`);
        }
        // Para otros TRAPs, resultado inicial es 0
        value = 0;
        break;
      }
      // RFE (Return From Exception)
      case 'RFE':
        value = 0; // El valor real se recupera en RI
        break;
      // NOP, no hace nada
      case 'NOP':
        value = 0;
        break;
      // Aritmetica vectorial
      case 'ADDV': case 'ADDSV': case 'ADDVS': case 'ADDVI':
      case 'SUBV': case 'SUBSV': case 'SUBVS': case 'SUBVI':
      case 'MULTV': case 'MULTSV': case 'MULTVS': case 'MULTVI':
      case 'DIVV': case 'DIVSV': case 'DIVVS': case 'DIVVI':
      case 'SEQV': case 'SEQSV': case 'SEQVS':
      case 'SNEV': case 'SNESV': case 'SNEVS':
      case 'SGTV': case 'SGTSV': case 'SGTVS':
      case 'SLTV': case 'SLTSV': case 'SLTVS':
      case 'SGEV': case 'SGESV': case 'SGEVS':
      case 'SLEV': case 'SLESV': case 'SLEVS':
      case 'CVI': case 'CVM': {
        const vectorResult = this.executeVectorALU(instr, v1, v2, imm);
        return { value: 0, vectorResult, stall: false };
      }
      // Cargas memoria vectorial
      case 'LV': {
        // LV: v1 es base, imm es offset → dirección = v1 + imm
        const vectorResult = this.executeVectorLoad(instr, (v1 + imm) | 0, 0, inflight.robTag!.slot);
        return { value: 0, vectorResult, stall: false };
      }
      case 'LVWS': case 'LVI': {
        // LVWS/LVI: v1 es base, imm es número de registro stride/índices
        const vectorResult = this.executeVectorLoad(instr, v1 | 0, imm, inflight.robTag!.slot);
        return { value: 0, vectorResult, stall: false };
      }
      // Stores vectoriales
      case 'SV': {
        // SV: v1 es base, imm es offset → dirección = v1 + imm
        //console.log(`[SV EX] v1=${v1}, imm=${imm}, baseAddr=${(v1 + imm) | 0}, robSlot=${inflight.robTag!.slot}`);
        this.executeVectorStore(instr, (v1 + imm) | 0, 0, inflight.robTag!.slot, inflight.execVL);
        return { value: 0, vectorResult: null, stall: false };
      }
      case 'SVWS': case 'SVI': {
        // SVWS/SVI: v1 es base, imm es número de registro stride/índices
        //console.log(`[${op} EX] rd=${instr.rd}, rs1=${instr.rs1}, rs2=${instr.rs2}, imm=${instr.imm}, v1=${v1}, v2=${v2}`);
        this.executeVectorStore(instr, v1 | 0, imm, inflight.robTag!.slot, inflight.execVL);
        return { value: 0, vectorResult: null, stall: false };
      }
      //Por si acaso
      default:
        value = 0;
    }

    return { value, vectorResult: null, stall: false };
  }

  /**
   * @deprecated
   * Ejecuta operación vectorial en ALU (Unidad funcional vectorial correspondiente). Se debe eliminar, asi como sus llamadas desde executeALU, porque las operaciones vectoriales no pasan por ahi
   * @param instr
   * @param v1
   * @param v2
   * @param imm
   * @private
   */
  private executeVectorALU(instr: AsgInstruction, v1: number, v2: number, imm: number): Float64Array {
    const vl = this.registerFile.vl();
    const result = new Float64Array(this.MVL);
    const op = instr.opcode.toUpperCase();

    for (let i = 0; i < vl; i++) {
      if (!this.registerFile.isVectorMaskElementActive(i)) continue;

      let val1: number, val2: number;
      // Determinar operandos según tipo de instrucción
      if (op.includes('SV') && !op.startsWith('S')) {
        // Escalar-Vector: val1 = escalar, val2 = vector[i]
        val1 = v1;
        val2 = this.getVectorElement(instr.rs2!, i);
        //console.log(`[${op}] elem ${i}: val1=${val1} (escalar), val2=${val2} (V${instr.rs2}[${i}])`);
      } else if (op.includes('VS') || op.includes('VI')) {
        // Vector-Escalar o Vector-Inmediato
        val1 = this.getVectorElement(instr.rs1!, i);
        val2 = op.includes('VI') ? imm : v2;
      } else {
        // Vector-Vector
        val1 = this.getVectorElement(instr.rs1!, i);
        val2 = this.getVectorElement(instr.rs2!, i);
      }

      // Ejecutar operación
      if (op.startsWith('ADD')) result[i] = val1 + val2;
      else if (op.startsWith('SUB')) result[i] = val1 - val2;
      else if (op.startsWith('MULT')) result[i] = val1 * val2;
      else if (op.startsWith('DIV')) {
        // TODO: Esta función actualmente no se usa para vector ops (usan processVectorALUElement) pero se mantiene la consistencia por si se usa en el futuro
        if (val2 === 0) {
          // TODO: Esta función no tiene forma de reportar excepciones al ROB
          // Si se usa en el futuro, necesitará soporte para excepciones
          result[i] = 0;
        } else {
          result[i] = val1 / val2;
        }
      }
      else if (op.startsWith('SEQ')) result[i] = val1 === val2 ? 1 : 0;
      else if (op.startsWith('SNE')) result[i] = val1 !== val2 ? 1 : 0;
      else if (op.startsWith('SGT')) result[i] = val1 > val2 ? 1 : 0;
      else if (op.startsWith('SLT')) result[i] = val1 < val2 ? 1 : 0;
      else if (op.startsWith('SGE')) result[i] = val1 >= val2 ? 1 : 0;
      else if (op.startsWith('SLE')) result[i] = val1 <= val2 ? 1 : 0;
      else if (op === 'CVI') result[i] = i * v1; // Vd[i] = i * Rs
      else if (op === 'CVM') result[i] = 1;
    }

    return result;
  }

  /**
   * Ejecuta carga vectorial en ALU (Unidad funcional vectorial correspondiente).
   * @param instr
   * @param baseAddr
   * @param imm
   * @param loadRobTag
   * @private
   */
  private executeVectorLoad(instr: AsgInstruction, baseAddr: number, imm: number, loadRobTag: number): Float64Array {
    const vl = this.registerFile.vl();
    const result = new Float64Array(this.MVL);
    const op = instr.opcode;

    // Para LVWS/LVI, resolver el registro de stride/índices con renaming (una sola vez)
    let strideValue: number | null = null;
    let indicesVector: Float64Array | null = null;

    if (op === 'LVWS') {
      const strideReg = instr.imm ?? 0;
      const robTag = this.rob.getROBTag(loadRobTag);
      const operand = this.getOperandValue('R', strideReg, op, robTag, false);
      strideValue = operand.ready ? (operand.value ?? 8) : 8;
    } else if (op === 'LVI') {
      const indexReg = instr.imm ?? 0;
      // Leer vector de índices completo (ya debe estar disponible en ejecución)
      const rrfResult = this.rrf.lookup('V', indexReg);
      if (!rrfResult.ocupado) {
        indicesVector = this.registerFile.readVectorRegister(indexReg);
      } else {
        // Si está en ROB, buscar el resultado vectorial
        const robResult = this.rob.lookupValue(rrfResult.robTag);
        indicesVector = robResult.found && robResult.vectorValue ? robResult.vectorValue : this.registerFile.readVectorRegister(indexReg);
      }
    }

    for (let i = 0; i < vl; i++) {
      if (!this.registerFile.isVectorMaskElementActive(i)) continue;

      let addr: number;
      if (op === 'LVWS') {
        addr = baseAddr + (strideValue ?? 8) * i;
      } else if (op === 'LVI') {
        const index = indicesVector ? indicesVector[i] : 0;
        addr = baseAddr + index;
      } else {
        // LV: acceso secuencial con stride de 8 bytes
        addr = baseAddr + i * 8;
      }

      // Store-to-load forwarding para loads vectoriales
      const forwardedValue = this.checkStoreForwarding(addr, 'LD', loadRobTag);
      result[i] = forwardedValue !== null ? forwardedValue : this.readMemoryFloat(addr, true, this.rob.getROBTag(loadRobTag));
    }

    return result;
  }

  /**
   * Prepara almacenamiento vectorial (los valores se capturan elemento por elemento)
   * @param instr
   * @param baseAddr
   * @param imm
   * @param robSlot
   * @param vl
   * @private
   */
  private executeVectorStore(instr: AsgInstruction, baseAddr: number, imm: number, robSlot: number, vl: number): void {
    const op = instr.opcode;
    const robEntry = this.rob.getEntry(robSlot);

    //console.log(`[${op} executeVectorStore] baseAddr=${baseAddr}, imm=${imm}, rs2=${instr.rs2}, vl=${vl}, vm[0]=${vm[0]}, robEntry=${!!robEntry}`);

    if (!robEntry) {
      //console.error(`[${op} executeVectorStore] ERROR: robEntry is null for slot ${robSlot}!`);
      return;
    }

    // Determinar stride según el tipo de store (con renaming)
    let stride = 8; // Default para SV
    let indicesVector: Float64Array | null = null;

    if (op === 'SVWS') {
      // Para SVWS, leer stride con renaming
      const strideReg = instr.imm ?? 0;
      const robTag = this.rob.getROBTag(robSlot);
      const operand = this.getOperandValue('R', strideReg, op, robTag, false);
      stride = operand.ready ? (operand.value ?? 8) : 8;
      //console.log(`[SVWS] strideReg=${strideReg}, stride=${stride}, operand.ready=${operand.ready}`);
    } else if (op === 'SVI') {
      // Para SVI, leer vector de índices con renaming
      const indexReg = instr.imm ?? 0;
      const rrfResult = this.rrf.lookup('V', indexReg);
      if (!rrfResult.ocupado) {
        indicesVector = this.registerFile.readVectorRegister(indexReg);
      } else {
        const robResult = this.rob.lookupValue(rrfResult.robTag);
        indicesVector = robResult.found && robResult.vectorValue ? robResult.vectorValue : this.registerFile.readVectorRegister(indexReg);
      }
      //console.log(`[SVI] indexReg=${indexReg}, indicesVector[0]=${indicesVector?.[0]}`);
    }

    // Preparar estructura para commit (los valores se llenarán durante processing)
    if (robEntry) {
      robEntry.isStore = true;
      robEntry.isVectorStore = true;
      robEntry.vectorStoreData = {
        baseAddr: baseAddr,
        stride: stride,
        isScatter: op === 'SVI',
        sourceReg: instr.rs2!,
        vl,
        mask: new Float64Array(this.registerFile.vectorMask()),
        values: new Float64Array(this.MVL),
        // Para SVI, guardar el vector de índices resuelto
        indicesVector: indicesVector,
        valuesReady: false
      };
      //console.log(`[${op} executeVectorStore] vectorStoreData creado: isStore=${robEntry.isStore}, isVectorStore=${robEntry.isVectorStore}`);
    }
  }

  /**
   * Obtiene elemento de un registro vectorial.
   * - Primero busca en el buffer del productor en vuelo (para permitir chaining)
   * - Si no hay productor activo, lee del registro arquitectónico directamente
   */
  private getVectorElement(regIdx: number, elementIdx: number): number {
    //if (regIdx === 0) return 0;

    // Buscar si hay un productor en vuelo para este registro
    const status = this.registerFile.getVectorRegisterStatus(regIdx);
    //console.log(`[getVectorElement] V${regIdx}[${elementIdx}]: status=${status ? `instrId=${status.instrId}, lastReady=${status.lastElementReady}` : 'null'}`);

    if (status && status.lastElementReady >= elementIdx) {
      // Hay un productor activo que ya tiene este elemento listo buscar la instrucción en vuelo y leer de su buffer
      for (const inf of this.inFlight.values()) {
        if (inf.id === status.instrId && inf.vectorResult) {
          const value = inf.vectorResult[elementIdx];
          //console.log(`[Vector Chaining] Leyendo V${regIdx}[${elementIdx}]=${value} del buffer especulativo (instr ${inf.id})`);
          return value;
        }
      }
    }

    // Buscar en el ROB por si el productor terminó pero no hizo commit
    const rrfState = this.rrf.getState();
    if (regIdx < rrfState.vectorRegs.length) {
      const renameEntry = rrfState.vectorRegs[regIdx];
      if (renameEntry.ocupado && renameEntry.indice !== null) {
        const robEntry = this.rob.getEntry(renameEntry.indice.slot);
        if (robEntry && robEntry.vectorResult && elementIdx < robEntry.vectorResult.length) {
          const value = robEntry.vectorResult[elementIdx];
          //console.log(`[Vector ROB] Leyendo V${regIdx}[${elementIdx}]=${value} del ROB (slot ${renameEntry.indice.slot})`);
          return value;
        }
      }
    }

    // Leer del registro arquitectónico como ultima instancia
    return this.registerFile.readVectorElement(regIdx, elementIdx);
  }

  /**
   * Verifica si una instrucción vectorial puede procesar sus siguientes elementos.
   * Implementa la lógica de chaining: verifica disponibilidad elemento por elemento.
   */
  private checkVectorChainingPossibility(inflight: InFlightInstruction): boolean {
    const instr = inflight.instr;
    if (!instr.isVector) return true;

    /**
     * Mismo problema que en el otro procesador, si hay instrucciones que dependen de la mascara, no se está comprobando si debe esperar porque de lo contrario consultaria una mascara antigua
     * y hay que comprobar que el escritor de la mascara sea una instruccion mas antigua que la actual
     */
    const isSelfUnconditionalVMWriter = instr.opcode === 'CVM' || instr.opcode === 'MOVF2S';

    const isVMWriter = (other: InFlightInstruction): boolean =>
      other.id < inflight.id &&
      other.state !== 'COMMITTED' && other.state !== 'RETIRED' && other.state !== 'FLUSHED' &&
      ((other.instr.isVector && other.instr.config.argNum === 2 && other.instr.opcode !== 'CVI')
        || other.instr.opcode === 'CVM' || other.instr.opcode === 'MOVF2S');

    if (!isSelfUnconditionalVMWriter) {
      for (const other of this.inFlight.values()) {
        if (isVMWriter(other)) return false;
      }
    }

    const opcode = instr.opcode.toUpperCase();
    const lanes = ['LV', 'SV', 'LVWS', 'SVWS', 'LVI', 'SVI'].includes(opcode) ? this.memoryLanes() : this.aluLanes();
    // Determinar qué operandos son vectoriales según el tipo de instrucción
    const vectorOperands: number[] = [];
    // Loads/Stores vectoriales: rs1 es el registro base ESCALAR, no vector.
    // Solo SV tiene rs2 como operando vectorial (el vector a almacenar).
    if (opcode.startsWith('LV') || opcode === 'LVWS' || opcode === 'LVI') {
      // LV, LVWS, LVI: cargas vectoriales - no tienen operandos vectoriales de entrada
      // (solo escriben en rd que es vector)
    } else if (opcode.startsWith('SV') || opcode === 'SVWS' || opcode === 'SVI') {
      // SV, SVWS, SVI: rs2 es el vector a almacenar
      if (instr.rs2 !== undefined) vectorOperands.push(instr.rs2);
    } else if (opcode.includes('SV') /*&& !opcode.startsWith('S')*/) {
      // Escalar-Vector (MULTSV, ADDSV, etc.): solo rs2 es vector
      if (instr.rs2 !== undefined) vectorOperands.push(instr.rs2);
    } else if (opcode.includes('VS')) {
      // Vector-Escalar (MULTVS, ADDVS, etc.): solo rs1 es vector
      if (instr.rs1 !== undefined) vectorOperands.push(instr.rs1);
    } else if (opcode.includes('VI') && opcode !== 'CVI') {
      // Vector-Inmediato (ADDVI, SUBVI, etc.): rs1 es vector, rs2 es escalar.
      // CVI Vd, Rs queda excluido aquí: su rs1 es un registro ESCALAR (stride), no vectorial.
      if (instr.rs1 !== undefined) vectorOperands.push(instr.rs1);
    } else if (opcode !== 'CVI') {
      // Vector-Vector: rs1 y rs2 son vectoriales
      if (instr.rs1 !== undefined) vectorOperands.push(instr.rs1);
      if (instr.rs2 !== undefined) vectorOperands.push(instr.rs2);
    }

    for (const regIdx of vectorOperands) {
      const qTag = regIdx === instr.rs1 ? inflight.resolvedOperands?.q1 : regIdx === instr.rs2 ? inflight.resolvedOperands?.q2 : null;
      if (!qTag) continue; // Operando ya resuelto en el dispatch (sin productor pendiente)

      const producer = Array.from(this.inFlight.values()).find(inf =>
        inf.robTag && inf.robTag.slot === qTag.slot && inf.robTag.generation === qTag.generation
      );

      if (!producer || producer.id === inflight.id) continue; // Ya no en vuelo (comprometido) o soy yo mismo

      if (this.isChainingEnabled()) {
        // Chaining ACTIVO: verificar disponibilidad a nivel de elemento. Para procesar elementos [currentElement, currentElement + lanes - 1] necesitamos que el productor haya terminado hasta el elemento (currentElement + lanes - 1)
        const neededElement = Math.min(inflight.currentElement + lanes, inflight.execVL) - 1;
        if (producer.currentElement - 1 < neededElement)
          return false; // Stall: datos no listos
      } else {
        // Chaining DESACTIVADO: esperar a que el productor termine de procesar todos los elementos
        if (producer.currentElement < inflight.execVL)
          return false; // Stall: productor no ha terminado to do el vector
      }
    }

    return true; // Puede procesar
  }

  /**
   * Procesa instrucciones vectoriales por fases (init → processing → end).
   *
   * MODELO DE EJECUCIÓN:
   * - LOADS/ALU: initDelay → procesamiento (lanes/ciclo) → fin
   * - STORES: procesamiento (lanes/ciclo) → endDelay → fin
   *
   * SOLAPAMIENTO: La instrucción dependiente puede emitir cuando el productor termina initDelay (fase 'processing'), permitiendo solapamiento.
   */
  private processVectorElementsIncremental(inflight: InFlightInstruction): void {
    const instr = inflight.instr;
    const vl = inflight.execVL;
    const op = instr.opcode.toUpperCase();
    const isMemoryOp = ['LV', 'SV', 'LVWS', 'SVWS', 'LVI', 'SVI'].includes(op);
    const lanes = isMemoryOp ? this.memoryLanes() : this.aluLanes();

    // FASE INIT: Tiempo de arranque
    if (inflight.vectorPhase === 'init') {
      inflight.executionPhaseLabel = `Init[${inflight.cyclesRemainingInPhase}]`;

      if (inflight.cyclesRemainingInPhase > 0) {
        inflight.cyclesRemainingInPhase--;
        return; // Esperando initDelay
      }

      // initDelay completado → verificar si podemos pasar a processing
      // Si estamos pendientes en la FU, debemos esperar a que la instrucción anterior termine
      if (inflight.isPendingOnFU) {
        // Verificar si seguimos siendo pendientes (la anterior no ha terminado)
        if (inflight.fuId !== null && this.fuPool.hasPendingOp(inflight.fuId)) {
          // Aún somos pendientes, esperar
          inflight.executionPhaseLabel = `WaitFU`;
          this.addLog(`[EX-V] ${op} pendiente de UF libre`, 'info');
          return;
        } else {
          // Ya no somos pendientes (fuimos promovidos), continuar a processing
          inflight.isPendingOnFU = false;
          this.addLog(`[EX-V] ${op} promocionado a ejecutar, UF libre`, 'info');
        }
      }

      // Pasar a processing
      inflight.vectorPhase = 'processing';
      inflight.executionPhaseLabel = `Proc[0]`;
      this.addLog(`[EX-V] ${op} initDelay terminado, empieza a procesar elementos`, 'info');
      // FIX: quito releaseVectorDependencies de aqui y lo muevo al entrar en EXECUTING para permitir solapamiento de inits. Los consumidores ya están emitidos/ejecutando con su propio init.
    }

    //FASE PROCESSING: Procesar elementos
    if (inflight.vectorPhase === 'processing') {
      // Si ya terminamos todos los elementos, pasar a fase end (stores) o terminar
      if (inflight.currentElement >= vl) {
        if (inflight.endDelay > 0) {
          inflight.vectorPhase = 'end';
          inflight.cyclesRemainingInPhase = inflight.endDelay;
          inflight.executionPhaseLabel = `End[${inflight.endDelay}]`;
          this.addLog(`[EX-V] ${op} ejecucion completada, empezando endDelay=${inflight.endDelay}`, 'info');
        } else {
          // Sin endDelay, instrucción terminada
          inflight.vectorPhase = null;
          // Mantener última etiqueta visible
        }
        return;
      }

      // SOLAPAMIENTO DE UF: Si estamos pendientes, esperar a que la UF esté libre. Esto es especialmente importante para stores que van directo a processing sin init
      if (inflight.isPendingOnFU) {
        if (inflight.fuId !== null && this.fuPool.hasPendingOp(inflight.fuId)) {
          // Aún somos pendientes, esperar a que la instrucción anterior libere la FU
          inflight.executionPhaseLabel = `WaitFU`;
          this.addLog(`[EX-V] ${op} pendiente de UF libre`, 'info');
          return;
        } else {
          // Ya no somos pendientes (fuimos promovidos), continuar procesando
          inflight.isPendingOnFU = false;
          this.addLog(`[EX-V] ${op} promocionado a ejecutar, UF libre`, 'info');
        }
      }

      // Verificar si podemos procesar los siguientes elementos (chaining check)
      if (!this.checkVectorChainingPossibility(inflight)) {
        // Stall: no hay datos suficientes para este batch
        inflight.executionPhaseLabel = `Wait[${inflight.currentElement}]`;
        this.addLog(`[EX-V] ${op} esperando elementos [${inflight.currentElement}]`, 'info');
        return;
      }

      // Actualizar label solo cuando realmente vamos a procesar
      inflight.executionPhaseLabel = `Proc[${inflight.currentElement}]`;

      // Inicializar vectorResult si es la primera vez
      if (!inflight.vectorResult)
        inflight.vectorResult = new Float64Array(this.MVL);

      const startIdx = inflight.currentElement;
      // Procesar batch de elementos (hasta lanes elementos por ciclo)
      for (let l = 0; l < lanes; l++) {
        const i = startIdx + l;
        if (i >= vl) break; // Terminamos el vector
        if (!this.registerFile.isVectorMaskElementActive(i)) continue; // Elemento enmascarado

        // Ejecutar operación según tipo
        if (isMemoryOp) {
          this.processVectorMemoryElement(inflight, i);
        } else {
          this.processVectorALUElement(inflight, i);
        }

        // Actualizar tracking de chaining: marcar este elemento como listo
        if (instr.rd !== undefined) {
          this.registerFile.setVectorRegisterStatus(instr.rd, {
            instrId: inflight.id,
            lastElementReady: i
          });
        }
      }

      // Avanzar puntero de elementos
      inflight.currentElement += lanes;

      // Verificar si terminamos DESPUÉS de avanzar el puntero
      if (inflight.currentElement >= vl) {
        // Marcar valores como listos para forwarding (para stores vectoriales)
        if (isMemoryOp && op.startsWith('S')) {
          const robEntry = this.rob.getEntry(inflight.robTag!.slot);
          if (robEntry?.vectorStoreData) {
            robEntry.vectorStoreData.valuesReady = true;
            //console.log(`[Vector Store] ${op} values ready for forwarding`);
          }
        }

        if (inflight.endDelay > 0) {
          // Pasar a fase end (solo stores)
          inflight.vectorPhase = 'end';
          inflight.cyclesRemainingInPhase = inflight.endDelay;
          // NO actualizar executionPhaseLabel aquí - mantener Proc[60] visible este ciclo
          // La fase 'end' actualizará la etiqueta en el SIGUIENTE ciclo
          this.addLog(`[EX-V] ${op} ejecucion completada, empezando endDelay=${inflight.endDelay}`, 'info');
        } else {
          // Sin endDelay, instrucción terminada
          inflight.vectorPhase = null;
          // Mantener la última etiqueta visible (Proc[60]) para el timeline
          this.addLog(`[EX-V] ${op} ejecucion completada`, 'info');
          //console.log(`[Vector Complete] ${op} all elements processed, no endDelay`);
        }
      }
      return;
    }

    //FASE END: Tiempo de finalización (solo stores)
    if (inflight.vectorPhase === 'end') {
      if (inflight.cyclesRemainingInPhase > 0) {
        // Actualizar label ANTES de decrementar (mostrar el contador actual)
        inflight.executionPhaseLabel = `End[${inflight.cyclesRemainingInPhase}]`;
        inflight.cyclesRemainingInPhase--;

        if (inflight.cyclesRemainingInPhase > 0) {
          return; // Aún esperando endDelay
        }
      }
      // endDelay completado → instrucción terminada
      inflight.vectorPhase = null;
      this.addLog(`[EX-V] ${op} ejecucion completada, endDelay finalizado`, 'info');
      return;
    }
  }

  /**
   * Procesa un único elemento de operación vectorial ALU. y marca las excepciones correspondientes. ALU VECTORIAL
   * TODO: sacar esto a un servicio propio independiente del procesador y sus excepciones
   */
  private processVectorALUElement(inflight: InFlightInstruction, elementIdx: number): void {
    const instr = inflight.instr;
    const op = instr.opcode.toUpperCase();
    let val1: number, val2: number;

    // Helper: leer operando vectorial usando ROB tag resuelto (no re-consultar RRF)
    const getResolvedElement = (regNum: number, operandIdx: 1 | 2): number => {
      const qTag = operandIdx === 1 ? inflight.resolvedOperands?.q1 : inflight.resolvedOperands?.q2;
      if (qTag) {
        // Buscar la instrucción en vuelo con ese ROB tag (buffer especulativo)
        for (const producer of this.inFlight.values()) {
          if (producer.robTag && producer.robTag.slot === qTag.slot && producer.robTag.generation === qTag.generation) {
            if (producer.vectorResult && elementIdx < producer.vectorResult.length) {
              return producer.vectorResult[elementIdx];
            }
            break;
          }
        }
        // Si no está en vuelo, intentar leer del ROB (instrucción terminada pero no committed)
        const robEntry = this.rob.getEntry(qTag.slot);
        if (robEntry?.generation === qTag.generation && robEntry?.vectorResult && elementIdx < robEntry.vectorResult.length) {
          return robEntry.vectorResult[elementIdx];
        }
      }
      // Sin productor o buffer vacío, usar getVectorElement como fallback
      return this.getVectorElement(regNum, elementIdx);
    };

    // Obtener operandos según tipo de instrucción
    if (op.includes('SV') /*&& !op.startsWith('S')*/) {
      // Escalar-Vector
      val1 = inflight.execV1;
      val2 = getResolvedElement(instr.rs2!, 2);
    } else if (op.includes('VS') || op.includes('VI')) {
      // Vector-Escalar o Vector-Inmediato
      val1 = getResolvedElement(instr.rs1!, 1);
      val2 = op.includes('VI') ? (instr.imm ?? 0) : inflight.execV2;
    } else {
      // Vector-Vector
      val1 = getResolvedElement(instr.rs1!, 1);
      val2 = getResolvedElement(instr.rs2!, 2);
    }

    // Ejecutar operación
    let resultValue: number;
    let exception: ExceptionCode | null = null;

    if (op.startsWith('ADD')) {
      resultValue = val1 + val2;
    } else if (op.startsWith('SUB')) {
      resultValue = val1 - val2;
    } else if (op.startsWith('MULT')) {
      resultValue = val1 * val2;
    } else if (op.startsWith('DIV')) {
      if (val2 === 0) {
        // Operaciones vectoriales siempre operan con doubles
        exception = ExceptionCode.FP_DIVISION_BY_ZERO;
        resultValue = 0;
      } else {
        resultValue = val1 / val2;
      }
    } else if (op.startsWith('SEQ')) {
      resultValue = val1 === val2 ? 1 : 0;
    } else if (op.startsWith('SNE')) {
      resultValue = val1 !== val2 ? 1 : 0;
    } else if (op.startsWith('SGT')) {
      resultValue = val1 > val2 ? 1 : 0;
    } else if (op.startsWith('SLT')) {
      resultValue = val1 < val2 ? 1 : 0;
    } else if (op.startsWith('SGE')) {
      resultValue = val1 >= val2 ? 1 : 0;
    } else if (op.startsWith('SLE')) {
      resultValue = val1 <= val2 ? 1 : 0;
    } else if (op === 'CVI') {
      const stride = inflight.execV1;
      resultValue = elementIdx * stride;
    } else if (op === 'CVM') {
      resultValue = 1;
    } else {
      resultValue = 0;
    }

    // Verificar excepciones FP (IEEE 754)
    if (!exception && (op.includes('F') || op.includes('D') || op.startsWith('V'))) {
      if (isNaN(resultValue)) {
        exception = ExceptionCode.FP_INVALID_OPERATION;
      } else if (!isFinite(resultValue)) {
        exception = ExceptionCode.FP_OVERFLOW;
      } else if (resultValue !== 0 && Math.abs(resultValue) < Number.MIN_VALUE) {
        exception = ExceptionCode.FP_UNDERFLOW;
      }
    }

    // Si hay excepción en este elemento, marcar la instrucción en el ROB
    if (exception)
      this.rob.markException(inflight.robTag!.slot, exception);

    // NO escribir en registros arquitectónicos durante ejecución especulativa.
    // Solo escribir en el buffer temporal. Los registros se actualizan en COMMIT (RI).
    // El chaining lee del buffer del productor en vuelo (getVectorElement).
    if (!inflight.vectorResult)
      inflight.vectorResult = new Float64Array(this.MVL);
    inflight.vectorResult[elementIdx] = resultValue;
  }

  /**
   * Procesa un elemento de memoria vectorial
   * @param inflight
   * @param elementIdx
   * @private
   */
  private processVectorMemoryElement(inflight: InFlightInstruction, elementIdx: number): void {
    const instr = inflight.instr;
    const op = instr.opcode;
    const baseAddr = inflight.execV1;
    const imm = instr.imm ?? 0;

    // Respetar la máscara vectorial
    if (!this.registerFile.isVectorMaskElementActive(elementIdx)) return;

    // Calcular dirección según tipo de acceso
    let addr: number;
    if (op === 'LVWS') {
      // LVWS: execV2 contiene el valor del stride (capturado en resolveOperands)
      const stride = inflight.execV2 ?? 8;
      addr = baseAddr + stride * elementIdx;
    } else if (op === 'SVWS') {
      // SVWS: stride guardado en ROB entry durante executeVectorStore
      const robEntry = this.rob.getEntry(inflight.robTag!.slot);
      const stride = robEntry?.vectorStoreData?.stride ?? 8;
      addr = baseAddr + stride * elementIdx;
    } else if (op === 'LVI') {
      // LVI: execV2 contiene el vector de índices (capturado en resolveOperands)
      // Accedemos al elemento correspondiente del vector capturado
      if (inflight.execV2 !== null) {
        // Si execV2 es un escalar, algo salió mal - usar imm como fallback
        const index = this.getVectorElement(imm!, elementIdx);
        addr = baseAddr + index;
      } else {
        // TODO: Para LVI, execV2 debería ser el valor renombrado del vector de índices
        // Por ahora usar getVectorElement como fallback
        const index = this.getVectorElement(imm!, elementIdx);
        addr = baseAddr + index;
      }
    } else if (op === 'SVI') {
      // SVI: índices guardados en ROB entry durante executeVectorStore
      const robEntry = this.rob.getEntry(inflight.robTag!.slot);
      const indicesVector = robEntry?.vectorStoreData?.indicesVector;
      const index = indicesVector ? indicesVector[elementIdx] : 0;
      addr = baseAddr + index;
    } else {
      // LV / SV: secuencial
      addr = baseAddr + imm + elementIdx * 8;
    }

    // Ejecutar carga o almacenamiento
    const isLoad = op === 'LV' || op === 'LVWS' || op === 'LVI';
    if (isLoad) {
      // Store-to-load forwarding para loads vectoriales
      const forwardedValue = this.checkStoreForwarding(addr, 'LD', inflight.robTag!.slot);
      const loadedValue = forwardedValue !== null ? forwardedValue : this.safeReadMemory(op, addr, 8, true, inflight.robTag!);

      // NO escribir en registros arquitectónicos durante ejecución especulativa.
      // Solo escribir en el buffer temporal. Los registros se actualizan en COMMIT (RI).
      if (!inflight.vectorResult)
        inflight.vectorResult = new Float64Array(this.MVL);
      inflight.vectorResult[elementIdx] = loadedValue;
    } else {
      // STORE VECTORIAL: Capturar valor para escribir en COMMIT. Leer usando ROB tag resuelto (no re-consultar RRF)
      const sourceReg = instr.rs2 ?? 0;
      let storeValue = 0;
      const q2Tag = inflight.resolvedOperands?.q2;

      if (q2Tag) {
        // Buscar productor en instrucciones inflight primero
        let found = false;
        for (const producer of this.inFlight.values()) {
          if (producer.robTag && producer.robTag.slot === q2Tag.slot && producer.robTag.generation === q2Tag.generation) {
            if (producer.vectorResult && elementIdx < producer.vectorResult.length) {
              storeValue = producer.vectorResult[elementIdx];
              //console.log(`[${op} Store Operand] Inflight ROB[${q2Tag.slot}:${q2Tag.generation}] V${sourceReg}[${elementIdx}]=${storeValue}`);
              found = true;
              break;
            }
          }
        }
        // Si no está en vuelo, intentar ROB
        if (!found) {
          const robEntry = this.rob.getEntry(q2Tag.slot);
          if (robEntry?.generation === q2Tag.generation && robEntry?.vectorResult && elementIdx < robEntry.vectorResult.length) {
            storeValue = robEntry.vectorResult[elementIdx];
            //console.log(`[${op} Store Operand] ROB[${q2Tag.slot}:${q2Tag.generation}] V${sourceReg}[${elementIdx}]=${storeValue}`);
            found = true;
          }
        }
        // Fallback
        if (!found) {
          storeValue = this.getVectorElement(sourceReg, elementIdx);
        }
      } else {
        storeValue = this.getVectorElement(sourceReg, elementIdx);
      }

      //console.log(`[${op} processElement] elem=${elementIdx}, rs2=${instr.rs2}, sourceReg=V${sourceReg}, storeValue=${storeValue}, addr=0x${addr.toString(16)}`);

      // Guardar el valor en el buffer del ROB para escribir en commit
      const robEntry = inflight.robTag ? this.rob.getEntry(inflight.robTag.slot) : null;
      if (robEntry?.vectorStoreData) {
        if (!robEntry.vectorStoreData.values) {
          robEntry.vectorStoreData.values = new Float64Array(this.MVL);
        }
        robEntry.vectorStoreData.values[elementIdx] = storeValue;
      }

      // Validar alineación para store preciso
      if (addr % 8 !== 0)
        this.rob.markException(inflight.robTag!.slot, ExceptionCode.MEMORY_ALIGNMENT_ERROR);

      // console.log(`[Vector Store] V${sourceReg}[${elementIdx}] = ${storeValue} @ 0x${addr.toString(16)} -> buffer para commit`);
    }
  }

  /**
   * Verifica si un load puede emitirse (memory ordering).
   *
   * Los loads deben esperar a que TODOS los stores anteriores hayan calculado su dirección.
   * Esto previene WAR (Write After Read) garantizando que:
   * - Si hay stores anteriores sin dirección conocida, no sabemos si hay conflicto
   * - Una vez conocidas las direcciones, el forwarding maneja RAW correctamente
   *
   * TODO: Podríamos ser más agresivos y permitir ejecución especulativa del load,
   * verificando conflictos cuando los stores calculen sus direcciones. Pero esto
   * requeriría re-ejecución del load si se detecta conflicto.
   *
   * @param loadRobTag ROB tag del load
   * @returns true si puede emitirse, false si debe esperar
   */
  private canIssueLoad(loadRobTag: ROBTag | null): boolean {
    if (!loadRobTag) return true;
    const allEntries = this.rob.getAllEntries();
    const head = this.rob.getHeadTag();
    const size = this.rob.getSize();

    // Recorrer desde head hasta loadRobTag.slot (program order)
    let current = head;
    while (current !== loadRobTag.slot) {
      const entry = allEntries[current];

      // Si hay un store anterior que aún no ha calculado su dirección, bloquear el load
      if (entry && entry.ocupada && entry.isStore && !entry.isVectorStore) {
        // El store debe haber sido emitido (y calculado su dirección)
        // storeAddress será null hasta que el store ejecute en EX
        if (entry.storeAddress === null) {
          return false; // Bloquear: hay un store anterior sin dirección calculada
        }
      }

      current = (current + 1) % size;
    }

    return true; // Puede emitirse: todos los stores anteriores tienen dirección calculada
  }

  /**
   * Calcula initDelay y endDelay para instrucciones vectoriales.
   *
   * Modelo de ejecución vectorial:
   * - LOADS/ALU: initDelay (arranque) → procesamiento (lanes elem/ciclo) → fin
   * - STORES: procesamiento (lanes elem/ciclo) → endDelay (envío a memoria) → fin
   *
   * @returns { initDelay, endDelay } en ciclos
   */
  private getVectorDelays(opcode: string): { initDelay: number; endDelay: number } {
    const op = opcode.toUpperCase();
    const config = this.configService.getCurrentConfig();

    // Stores: sin initDelay, con endDelay al final
    if (['SV', 'SVWS', 'SVI'].includes(op))
      return { initDelay: 0, endDelay: config.latencies.vecMem };

    // Loads: initDelay al principio, sin endDelay
    if (['LV', 'LVWS', 'LVI'].includes(op))
      return { initDelay: config.latencies.vecMem, endDelay: 0 };

    // Multiplicación vectorial
    if (op.includes('MULT'))
      return { initDelay: config.latencies.vecMul, endDelay: 0 };

    // División vectorial
    if (op.includes('DIV'))
      return { initDelay: config.latencies.vecDiv, endDelay: 0 };

    // Comparaciones vectoriales: initDelay propio (independiente del de ADDV/SUBV)
    if ((VECTOR_COMPARISON_OPCODES as readonly string[]).includes(op))
      return { initDelay: config.latencies.vecCmp, endDelay: 0 };

    // ALU vectorial (ADD, SUB, CVI, CVM)
    return { initDelay: config.latencies.vecAdd, endDelay: 0 };
  }

  /**
   * Libera dependencias vectoriales en el RS cuando un productor entra en EXECUTING.
   * Esto permite solapamiento de initDelays:
   * - Productor: [Init]-----[Proc]----
   * - Consumidor:  [Init]-----[Proc]----  (inicia su init mientras productor hace el suyo)
   *
   * El control de disponibilidad de datos se hace en checkVectorChainingPossibility, que verifica lastElementReady antes de procesar cada batch de elementos.
   */
  private releaseVectorDependencies(producerRobTag: ROBTag): void {
    // Simular un resultado "parcial" en el CDB para liberar dependencias
    // Valor 0 como placeholder - el valor real se lee del registro durante ejecución
    const fakeResult: CDBResult = {
      robTag: producerRobTag,
      value: 0,
      vectorValue: null,
      fuType: 'VEC_INT',
      cycle: this.cycle()
    };

    this.rs.updateFromCDB(fakeResult);
    //console.log(`[Convoy] Released vector dependencies for ROB[${producerRobTag.slot}]`);
  }

  /**
   * Verifica si una instrucción vectorial puede emitir como parte de un convoy.
   *
   * CONVOY CON SOLAPAMIENTO DE INIT:
   * - Si la instrucción NO tiene dependencias vectoriales → puede emitir (iniciador de convoy)
   * - Si la instrucción depende de otra instrucción vectorial:
   *    a) Si el productor está en EXECUTING (cualquier fase) → puede emitir
   *    b) Si el productor aún NO está ejecutando → debe esperar
   *
   * SOLAPAMIENTO DE INIT:
   * - Productor: [Init]-----[Proc]----
   * - Consumidor:  [Init]-----[Proc]----  (emite cuando productor entra en EX)
   *
   * El consumidor emite aunque el productor esté en su fase 'init'.
   * Ambos hacen su initDelay en paralelo, reduciendo la latencia total.
   * El control de datos se hace en checkVectorChainingPossibility.
   *
   * @param inflight Instrucción vectorial a verificar
   * @returns true si puede emitir, false si debe esperar
   */
  private canIssueAsConvoy(inflight: InFlightInstruction): boolean {
    const instr = inflight.instr;
    const opcode = instr.opcode.toUpperCase();
    // Determinar qué operandos son vectoriales según el tipo de instrucción
    const vectorOperands: number[] = [];
    // STORES VECTORIALES (SV, SVWS, SVI): solo rs2 (datos) es vectorial
    if (opcode === 'SV' || opcode === 'SVWS' || opcode === 'SVI') {
      if (instr.rs2 !== undefined) vectorOperands.push(instr.rs2);
    }
      // LOADS VECTORIALES (LV, LVWS, LVI): no tienen dependencias RAW de lectura (producen rd, no consumen registros vectoriales)
    else if (opcode === 'LV' || opcode === 'LVWS' || opcode === 'LVI') {
      // No añadir nada - los loads no dependen de registros vectoriales
    }
    // ALU ESCALAR-VECTOR (ADDSV, SUBSV, etc.): solo rs2 es vector
    else if (opcode.includes('SV') /*&& !opcode.startsWith('S')*/) {
      if (instr.rs2 !== undefined) vectorOperands.push(instr.rs2);
    }
    // ALU VECTOR-ESCALAR (ADDVS, SUBVS, etc.): solo rs1 es vector
    else if (opcode.includes('VS')) {
      if (instr.rs1 !== undefined) vectorOperands.push(instr.rs1);
    }
    // ALU VECTOR-INMEDIATO (ADDVI, SUBVI, etc.): solo rs1 es vector. CVI excluido, su rs1 es escalar
    else if (opcode.includes('VI') && opcode !== 'CVI') {
      if (instr.rs1 !== undefined) vectorOperands.push(instr.rs1);
    }
    // ALU VECTOR-VECTOR (ADDV, SUBV, etc.): rs1 y rs2 son vectoriales
    else if (opcode !== 'CVI') {
      if (instr.rs1 !== undefined) vectorOperands.push(instr.rs1);
      if (instr.rs2 !== undefined) vectorOperands.push(instr.rs2);
    }

    // Verificar cada operando vectorial
    for (const regIdx of vectorOperands) {
      const status = this.registerFile.getVectorRegisterStatus(regIdx);
      if (!status) continue; // No hay productor activo para este registro

      // Buscar el productor en las instrucciones en vuelo
      const producer = Array.from(this.inFlight.values()).find(
        inf => inf.id === status.instrId
      );

      if (!producer) continue; // Productor ya finalizó

      if (this.isChainingEnabled()) {
        if (producer.state !== 'EXECUTING')
          return false; // Bloquear: productor aún no empezó a ejecutar
      } else {
        // Chaining DESACTIVADO: no permitir convoy
        // La instrucción dependiente debe esperar a que el productor termine completamente
        return false; // Bloquear: convoy no permitido sin chaining
      }
    }

    return true; // Puede emitir: todos los productores están generando elementos (convoy válido)
  }

  /**
   * Store-to-Load Forwarding con detección de solapamientos parciales
   * @returns número si hay forwarding completo, null si no hay stores relevantes, Number.NEGATIVE_INFINITY si hay solapamiento parcial (debe esperar)
   */
  private checkStoreForwarding(loadAddr: number, loadOp: string, loadRobTag: number): number | null {
    // Buscar stores anteriores en program order que aún no han hecho commit
    const allEntries = this.rob.getAllEntries();
    const head = this.rob.getHeadTag();
    const size = this.rob.getSize();

    // Determinar tamaño del load
    const loadSize = this.getLoadSize(loadOp);
    const loadStart = loadAddr;
    const loadEnd = loadAddr + loadSize - 1;

    // Buscar el store más reciente (en program order) que cubre el rango del load
    let forwardStore: { address: number; value: number; opcode: string } | null = null;
    let hasPartialOverlap = false;
    let current = head;

    // Recorrer desde head hasta loadRobTag (orden de programa)
    while (current !== loadRobTag) {
      const entry = allEntries[current];

      // STORES ESCALARES
      if (entry && entry.ocupada && entry.isStore && !entry.isVectorStore) {
        if (entry.storeAddress !== null && entry.storeValue !== null) {
          const storeSize = this.getStoreSize(entry.opcode);
          const storeStart = entry.storeAddress;
          const storeEnd = storeStart + storeSize - 1;

          // Verificar si hay superposición completa (el store cubre to do el load)
          if (storeStart <= loadStart && storeEnd >= loadEnd) {
            forwardStore = {
              address: entry.storeAddress,
              value: entry.storeValue,
              opcode: entry.opcode
            };
            hasPartialOverlap = false; // Ya no es parcial, es completo
          }
          // Verificar si hay superposición parcial (solapan pero no cubre to do)
          else if (!(storeEnd < loadStart || storeStart > loadEnd)) {
            // Hay solapamiento pero no cobertura completa
            if (forwardStore === null) {
              hasPartialOverlap = true;
            }
          }
        }
      }
      // STORES VECTORIALES
      else if (entry && entry.ocupada && entry.isVectorStore && entry.vectorStoreData) {
        const vsd = entry.vectorStoreData;
        // Solo podemos hacer forwarding si el store vectorial ya PROCESÓ todos los elementos no necesitamos esperar a que finalice completamente (endDelay)
        if (vsd.values && vsd.valuesReady) {
          const vl = vsd.vl;
          // Calcular el rango de direcciones del store vectorial
          for (let i = 0; i < vl; i++) {
            if (vsd.mask[i] === 0) continue; // Elemento enmascarado

            let elemAddr: number;
            if (vsd.isScatter && vsd.indicesVector) {
              // SVI: scatter
              elemAddr = vsd.baseAddr + vsd.indicesVector[i];
            } else {
              // SV, SVWS: strided (stride default = 8 para doubles)
              elemAddr = vsd.baseAddr + vsd.stride * i;
            }

            const elemStart = elemAddr;
            const elemEnd = elemAddr + 7; // Cada elemento es un double (8 bytes)

            // Verificar si el load cae dentro de este elemento
            if (elemStart <= loadStart && elemEnd >= loadEnd) {
              // Forwarding completo desde este elemento del vector
              forwardStore = {
                address: elemAddr,
                value: vsd.values[i],
                opcode: 'SD' // Tratarlo como un store double
              };
              hasPartialOverlap = false;
              break; // Ya encontramos forwarding completo
            }
            // Verificar superposición parcial
            else if (!(elemEnd < loadStart || elemStart > loadEnd)) {
              if (forwardStore === null) {
                hasPartialOverlap = true;
              }
            }
          }
        } else if (vsd.values && !vsd.valuesReady) {
          // Store vectorial existe pero aún no procesó todos los elementos - verificar si hay overlap
          const vl = vsd.vl;
          for (let i = 0; i < vl; i++) {
            if (vsd.mask[i] === 0) continue;

            let elemAddr: number;
            if (vsd.isScatter && vsd.indicesVector) {
              elemAddr = vsd.baseAddr + vsd.indicesVector[i];
            } else {
              elemAddr = vsd.baseAddr + vsd.stride * i;
            }

            const elemStart = elemAddr;
            const elemEnd = elemAddr + 7;

            // Si hay overlap, el load debe esperar a que el store finalice
            if (!(elemEnd < loadStart || elemStart > loadEnd)) {
              this.addLog(`Store-to-Load: load@${loadAddr} debe esperar a que el store vector anterior finalice`, 'warning');
              hasPartialOverlap = true;
              break;
            }
          }
        }
      }

      current = (current + 1) % size;
    }

    // Si hay solapamiento parcial sin forwarding completo, indicar que debe esperar
    if (hasPartialOverlap && forwardStore === null) {
      this.addLog(`Store-to-Load: load@${loadAddr} hay solapamiento parcial con stores pendientes`, 'warning');
      return Number.NEGATIVE_INFINITY; // Señal de conflicto
    }

    if (forwardStore === null)
      return null;

    // Extraer los bytes correctos según el offset dentro del store (big-endian)
    const offset = loadAddr - forwardStore.address;
    const storeSize = this.getStoreSize(forwardStore.opcode);
    const result = this.extractBytesFromStore(forwardStore.value, storeSize, offset, loadSize, loadOp);

    this.addLog(`Store-to-Load forwarding: load@${loadAddr} de store@${forwardStore.address}, offset=${offset}, result=${result}`, 'info');
    return result;
  }

  /**
   * Obtiene el tamaño en bytes de una operación de load
   * TODO: implementar esto en otro sito generico, como en el modelo de la aplicacion
   */
  private getLoadSize(op: string): number {
    switch (op.toUpperCase()) {
      case 'LB': case 'LBU': return 1;
      case 'LH': case 'LHU': return 2;
      case 'LW': case 'LF': return 4;
      case 'LD': return 8;
      default: return 4;
    }
  }

  /**
   * Obtiene el tamaño en bytes de una operación de store
   * TODO: implementar esto en otro sito generico, como en el modelo de la aplicacion
   */
  private getStoreSize(op: string): number {
    switch (op.toUpperCase()) {
      case 'SB': return 1;
      case 'SH': return 2;
      case 'SW': case 'SF': return 4;
      case 'SD': return 8;
      default: return 4;
    }
  }

  /**
   * Extrae bytes de un valor de store según el offset (big-endian)
   * @param storeValue Valor completo del store
   * @param storeSize Tamaño del store en bytes
   * @param offset Offset del load dentro del store
   * @param loadSize Tamaño del load en bytes
   * @param loadOp Operación de load (para extensión de signo)
   */
  private extractBytesFromStore(storeValue: number, storeSize: number, offset: number, loadSize: number, loadOp: string): number {
    const op = loadOp.toUpperCase();
    // Para loads de doubles (8 bytes), si hay coincidencia exacta, devolver directamente
    // No se puede hacer bit shifting en valores flotantes porque rompe los datos
    if (op === 'LD' && storeSize === 8 && offset === 0 && loadSize === 8)
      return storeValue;

    // En big-endian, el byte más significativo está en la dirección más baja
    // storeValue para SW de 0x12345678:
    //   offset 0: byte 0x12 (bits 31-24)
    //   offset 1: byte 0x34 (bits 23-16)
    //   offset 2: byte 0x56 (bits 15-8)
    //   offset 3: byte 0x78 (bits 7-0)

    // Calcular el shift para extraer los bytes correctos
    const bitsToShift = (storeSize - offset - loadSize) * 8;

    let result: number;
    if (loadSize === 4) {
      // Para 32 bits, la máscara es 0xFFFFFFFF
      // Usar >>> 0 para tratarlo como unsigned antes del cast final
      result = (storeValue >>> bitsToShift) | 0;
    } else {
      const mask = (1 << (loadSize * 8)) - 1;
      result = (storeValue >>> bitsToShift) & mask;
    }

    // Aplicar extensión de signo si es necesario
    if (op === 'LB') {
      // Byte con extensión de signo
      if (result > 127) result = result - 256;
    } else if (op === 'LH') {
      // Halfword con extensión de signo
      if (result > 32767) result = result - 65536;
    }

    return result;
  }

  /**
   * @deprecated metodo para leer de memoria
   */
  private readMemory(address: number, op: string, robTag?: ROBTag): number {
    const opUpper = op.toUpperCase();
    let size = 4;
    let signed = true;
    switch (opUpper) {
      case 'LB': size = 1; signed = true; break;
      case 'LBU': size = 1; signed = false; break;
      case 'LH': size = 2; signed = true; break;
      case 'LHU': size = 2; signed = false; break;
      case 'LW': default: size = 4; signed = true; break;
    }
    return this.safeReadMemory(opUpper, address, size, signed, robTag);
  }

  /**
   * @deprecated metodo para leer de memoria un float
   * @param address
   * @param isDouble
   * @param robTag
   * @private
   */
  private readMemoryFloat(address: number, isDouble: boolean, robTag?: ROBTag): number {
    const op = isDouble ? 'LD' : 'LF';
    return this.safeReadMemory(op, address, isDouble ? 8 : 3, true, robTag);
  }

  /**
   * Metodo para acceso a lectura de memoria con control de excepcion propia de este procesador
   * TODO: refactorizar el método para que esté en el base del procesador y no repetido en cada uno solo por el manejo de la excepcion, que es propia del procesador
   * @param opcode
   * @param address
   * @param size
   * @param signed
   * @param robTag
   * @private
   */
  private safeReadMemory(opcode: string, address: number, size: number, signed: boolean, robTag?: ROBTag): number {
    try {
      return this.dataMemory.read(address, size, signed);
    } catch (e: any) {
      if (e instanceof MemoryAlignmentError || e instanceof MemoryOutOfBoundsError) {
        const code = e instanceof MemoryAlignmentError
          ? ExceptionCode.MEMORY_ALIGNMENT_ERROR
          : ExceptionCode.MEMORY_OUT_OF_BOUNDS;
        if (robTag) {
          this.rob.markException(robTag.slot, code);
        } else {
          this.addLog(`EXCEPCIÓN: ${e.message} en operación ${opcode}`, 'error');
          this.pause();
        }
      }
      return 0;
    }
  }

  /**
   * Método para acceso a escritura de memoria con control de excepcion propia de este procesador
   * TODO: refactorizar el método para que esté en el base del procesador y no repetido en cada uno solo por el manejo de la excepcion, que es propia del procesador
   * @param opcode
   * @param address
   * @param value
   * @param size
   * @param robTag
   * @private
   */
  private safeWriteMemory(opcode: string, address: number, value: number, size: number, robTag?: ROBTag): void {
    try {
      this.dataMemory.write(address, value, size);
    } catch (e: any) {
      if (e instanceof MemoryAlignmentError || e instanceof MemoryOutOfBoundsError) {
        const code = e instanceof MemoryAlignmentError
          ? ExceptionCode.MEMORY_ALIGNMENT_ERROR
          : ExceptionCode.MEMORY_OUT_OF_BOUNDS;
        if (robTag) {
          this.rob.markException(robTag.slot, code);
        } else {
          this.addLog(`EXCEPCIÓN: ${e.message} en operación ${opcode}`, 'error');
          this.pause();
        }
      }
    }
  }

  /**
   * Etapa WR (Write Results), publica al CDB los resultados
   * @param currentCycle
   * @private
   */
  private stageWR(currentCycle: number): void {
    // Iniciar nuevo ciclo en CDB
    this.cdb.startCycle();

    // Obtener instrucciones que terminaron EX
    const finished = Array.from(this.inFlight.values()).filter(inf => inf.state === 'FINISHED' && inf.cycleWR === null);

    //console.log(`[WR] ${finished.length} instructions to publish: ${finished.map(f => `${f.instr.opcode}[${f.robTag?.slot}]`).join(', ')}`);

    for (const inflight of finished) {
      const robEntry = this.rob.getEntry(inflight.robTag!.slot);
      if (!robEntry) continue;

      const fuType = getFunctionalUnitType(inflight.instr.opcode ?? 'NOP');
      const result = robEntry.valor ?? 0;

      const isStore = this.isStoreInstruction(inflight.instr);
      const isVector = inflight.instr.isVector ?? false;

      if (isStore || isVector) {
        // Marcar como finalizados sin usar CDB
        inflight.cycleWR = currentCycle;
        this.rob.markFinished(inflight.robTag!.slot, result, inflight.vectorResult, currentCycle);
        // Liberar RS
        if (inflight.rsIndex !== null)
          this.rs.releaseByRobTag(inflight.robTag!);

        const type = isVector ? 'vector' : 'store';
        this.addLog(`WR: ${inflight.instr.opcode} (${type}) finalizado sin CDB`, 'info');
      } else {
        // Instrucciones ESCALARES: publicar en CDB (Tomasulo clásico)
        if (this.cdb.publish(inflight.robTag!, result, null, fuType, currentCycle)) {
          inflight.cycleWR = currentCycle;
          // Marcar en ROB como finalizado
          this.rob.markFinished(inflight.robTag!.slot, result, null, currentCycle);
          // Liberar RS
          if (inflight.rsIndex !== null)
            this.rs.releaseByRobTag(inflight.robTag!);

          this.addLog(`WR: ${inflight.instr.opcode} resultado=${result}`, 'info');
        }
      }
    }

    // Actualizar RS con resultados del CDB
    const cdbResults = this.cdb.getResults();
    //console.log(`[WR] CDB has ${cdbResults.length} results:`, cdbResults.map(r => `ROB[${r.robTag}]=${r.value}`));
    for (const result of cdbResults) {
      this.rs.updateFromCDB(result);
    }

    // DEBUG: mostrar estado de RS después de actualizar
    /*const rsEntries = this.rs.getAllOccupied();
    console.log(`[WR] RS after CDB update:`, rsEntries.map(e => `${e.opcode}: v1=${e.v1},q1=${e.q1},v2=${e.v2},q2=${e.q2},lista=${e.lista}`));*/
  }

  /**
   * Etapa RI, commit a registros
   * @param currentCycle
   * @private
   */
  private stageRI(currentCycle: number): void {
    this.lastRetiredInFlight = [];
    let retired = 0;
    const maxRetire = this.config.issueWidth;

    // DEBUG: Log estado de la cabeza del ROB
    /*const headEntry = this.rob.getHead();
    if (headEntry) {
      const headInf = this.findInflightByRobTag({ slot: headEntry.tag, generation: headEntry.generation });
      console.log(`[RI] ROB head: slot=${headEntry.tag}, opcode=${headEntry.opcode}, ocupada=${headEntry.ocupada}, finalizada=${headEntry.finalizada}, valida=${headEntry.valida}, inflight_state=${headInf?.state ?? 'NOT_FOUND'}`);
    }*/

    while (retired < maxRetire && this.rob.canCommit()) {
      const head = this.rob.getHead();
      if (!head) break;

      // TRATAMIENTO DE EXCEPCIONES PRECISAS (Libro Fig 2.45)
      if (!head.valida) {
        const exCode = head.excepcion ?? ExceptionCode.UNKNOWN;
        this.addLog(`[RI]: EXCEPCIÓN PRECISA en PC=0x${head.pc.toString(16)}: ${exCode}`, 'error');

        //Guardar PC de la instrucción fallida en IAR para posible recuperación (RFE)
        this.iar.set(head.pc);
        //Guardar motivo del error en el registro CAUSE
        this.cause.set(exCode);
        //Flush completo del pipeline (eliminar to-do lo posterior y especulativo)
        this.flushPipeline();
        //Saltar al vector de interrupción correspondiente
        const vectorIndex = EXCEPTION_TO_VECTOR[exCode];
        const vectorAddr = vectorIndex * VECTOR_ENTRY_SIZE;
        this.addLog(`[RI]: Saltando a vector ${vectorIndex} (0x${vectorAddr.toString(16)})`, 'info');
        this.pc = vectorAddr;
        return;
      }

      // Tratar TRAP 3 y su stdin
      if (head && head.opcode === 'TRAP' && head.instrRef?.imm === 3) {
        // Buscar inflight para obtener trapParams (leídos en EX)
        const trapInflight = this.findInflightByRobTag({ slot: head.tag, generation: head.generation });
        const trapParams = trapInflight?.trapParams;
        // Usar fd guardado en EX (no releer de R14)
        const fd = trapParams?.fd ?? 0;
        if (fd === 0) {
          const req = this.trapStdinRequest();
          // Si no hay request, crear una (flush + pausa)
          if (!req) {
            // Usar bufAddr y maxBytes guardados en EX
            const bufAddr = trapParams?.bufAddr ?? 0;
            const maxBytes = trapParams?.maxBytes ?? 0;

            //console.log(`[TRAP 3 RI] At head - saving IAR, flushing, pausing`);
            // Guardar en IAR = dirección SIGUIENTE al TRAP (PC + 4)
            this.iar.set((head.pc + 4) & 0xFFFFFFFF);
            //console.log(`[TRAP 3 RI] IAR saved: 0x${this.iar().toString(16)} (next instr after TRAP at 0x${head.pc.toString(16)})`);
            // Flush instrucciones DESPUÉS del TRAP
            // TODO: usar metodo general para hacer flush
            const nextRobTag = (head.tag + 1) % this.rob.getSize();
            const robHead = this.rob.getHeadTag();
            const robSize = this.rob.getSize();

            this.rob.flushFrom(nextRobTag);
            this.fuPool.flushFrom(nextRobTag, robHead, robSize);
            this.rs.flushFrom(nextRobTag, robHead, robSize);
            this.rrf.flushFrom(nextRobTag, robHead, robSize);
            // Marcar inflight como flushed
            let flushedCount = 0;
            for (const [id, inf] of this.inFlight.entries()) {
              const hasRobTagTrap = inf.robTag !== null && inf.robTag.slot !== -1;
              if (hasRobTagTrap && inf.robTag!.slot !== head.tag) {
                const posInf = (inf.robTag!.slot - robHead + robSize) % robSize;
                const posTrap = (head.tag - robHead + robSize) % robSize;
                if (posInf > posTrap) {
                  inf.flushed = true;
                  inf.state = 'FLUSHED' as InstructionState;
                  flushedCount++;
                }
              }
              if (!hasRobTagTrap && inf.pc > head.pc) {
                inf.flushed = true;
                inf.state = 'FLUSHED' as InstructionState;
                flushedCount++;
              }
            }

            // Limpiar fetch buffer
            this.fetchBuffer.instructions = [];
            this.fetchBuffer.pcs = [];

            this.stats.flushedInstructions += flushedCount;
            //console.log(`[TRAP 3 RI] Flushed ${flushedCount} instructions after TRAP`);
            // Establecer request (esto pausará el procesador)
            this.trapStdinRequest.set({ bufAddr, maxBytes, instrId: trapInflight?.id ?? 0 });
            this.addLog(`[RI]: TRAP 3 IAR=0x${this.iar().toString(16)}, esperando stdin`, 'info');
            break; // No hacer commit todavía
          }

          // Si hay request pero no tiene pendingInput, esperar
          if (!(req as any).pendingInput) {
            this.addLog(`[RI]: TRAP 3 esperando input de usuario antes de hacer commit`, 'info');
            break;
          }
          // Si tiene pendingInput, continuamos y hacemos commit
        }
      }

      const entry = this.rob.commit();
      if (!entry) break;
      // Encontrar instrucción en vuelo
      const inflight = this.findInflightByRobTag({ slot: entry.tag, generation: entry.generation });
      if (inflight) {
        inflight.state = 'RETIRED';
        inflight.cycleRI = currentCycle;
        this.lastRetiredInFlight.push(inflight);
      }
      // Actualizar registro arquitectónico
      if (entry.regDestino !== null && entry.tipoReg !== null) {
        if (entry.tipoReg === 'V') {
          if (inflight?.vectorResult || entry.vectorResult) {
            const vectorResult = inflight?.vectorResult ?? entry.vectorResult;
            if (vectorResult) {
              this.registerFile.writeVectorRegister(entry.regDestino!, vectorResult);
              /*this.vectorRegisters.update(vregs => {
                const newVregs = [...vregs];
                newVregs[entry.regDestino!] = vectorResult.slice() as Float64Array;
                return newVregs;
              });*/
              this.addLog(`[RI] V${entry.regDestino} commit - escribiendo ${inflight?.execVL ?? this.registerFile.vl()} elementos a registro arquitectónico`, 'info');
            }
          }
          // Limpiar tracking de chaining para este registro
          const status = this.registerFile.getVectorRegisterStatus(entry.regDestino);
          if (status && inflight && status.instrId === inflight.id)
            this.registerFile.deleteVectorRegisterStatus(entry.regDestino);
        } else {
          // Instrucciones ESCALARES: escribir en registros arquitectónicos
          const isDouble = entry.instrRef?.isDouble ?? false;
          this.updateArchitecturalRegister(entry.tipoReg, entry.regDestino, entry.valor ?? 0, isDouble, entry.opcode, { slot: entry.tag, generation: entry.generation });
          this.addLog(`[RI] ${entry.opcode} commit: regDestino=${entry.tipoReg}${entry.regDestino}, valor=${entry.valor}, isDouble=${isDouble}`, 'info');
        }

        // Limpiar renombramiento en RRF si aún apunta a este tag (Figura 2.40: Ocupado=0)
        this.rrf.clearRename(entry.tipoReg, entry.regDestino, { slot: entry.tag, generation: entry.generation });
      }

      // Manejar instrucciones especiales vectoriales
      if (entry.opcode === 'MOVI2S') {
        // Escribir VLR (Vector Length Register)
        const newVL = Math.max(0, Math.min(this.MVL, (entry.valor ?? 0) | 0));
        this.registerFile.vl.set(newVL);
        this.addLog(`WB: VLR ← ${newVL} (máx: ${this.MVL})`, 'success');
        // Limpiar renombramiento de VLR en RRF
        this.registerFile.clearVLRRename({ slot: entry.tag, generation: entry.generation });
      }

      if (entry.opcode === 'MOVF2S') {
        // Escribir VM (Vector Mask) desde bits del float
        const bits = this.registerFile.setVectorMask(entry.valor ?? 0);
        this.addLog(`WB: VM ← 0x${(bits >>> 0).toString(16).padStart(8, '0')}`, 'success');
        // Limpiar renombramiento de VM en RRF
        this.registerFile.clearVMRename({ slot: entry.tag, generation: entry.generation });
      }

      // Comparaciones vectoriales: resultado → vectorMask
      const isVectorComparison = entry.opcode.startsWith('SEQ') || entry.opcode.startsWith('SNE') ||
        entry.opcode.startsWith('SGT') || entry.opcode.startsWith('SLT') ||
        entry.opcode.startsWith('SGE') || entry.opcode.startsWith('SLE');
      if (entry.instrRef?.isVector && isVectorComparison && entry.vectorResult) {
        this.registerFile.writeVectorMask(entry.vectorResult!.slice() as Float64Array);
        this.addLog(`WB: VM actualizada desde comparación vectorial`, 'info');
        // Limpiar renombramiento de VM en RRF
        this.registerFile.clearVMRename({ slot: entry.tag, generation: entry.generation });
      }

      // CVM: resetear máscara a todos 1s
      if (entry.opcode === 'CVM') {
        this.registerFile.resetVectorMask();
        this.addLog(`WB: VM reseteada a todos 1s`, 'info');
        // Limpiar renombramiento de VM en RRF
        this.registerFile.clearVMRename({ slot: entry.tag, generation: entry.generation });
      }

      // Si es store escalar, escribir a memoria
      if (entry.isStore && !entry.isVectorStore && entry.storeAddress !== null && entry.storeValue !== null)
        this.writeMemory(entry.storeAddress, entry.storeValue, entry.opcode, { slot: entry.tag, generation: entry.generation });

      // Si es store vectorial, escribir a memoria
      //console.log(`[RI Commit] ${entry.opcode}: isStore=${entry.isStore}, isVectorStore=${entry.isVectorStore}, hasVectorStoreData=${!!entry.vectorStoreData}`);
      if (entry.isVectorStore && entry.vectorStoreData) {
        this.commitVectorStore(entry.vectorStoreData, { slot: entry.tag, generation: entry.generation });
      } else if (entry.opcode === 'SV' || entry.opcode === 'SVWS' || entry.opcode === 'SVI') {
        this.addLog(`[RI]: ERROR ${entry.opcode} no tiene vectorStoreData configurado!`, 'error');
      }

      this.stats.instructionsCommitted++;
      retired++;

      this.addLog(`[RI]: ${entry.opcode} committed`, 'info');

      // Ejecutar TRAP en commit
      if (entry.opcode === 'TRAP') {
        const trapResult = this.executeTrap(entry, inflight);
        //consolida en R1 el resultado de TRAP: detectado en test unitario, no se estaba guardando en este procesador
        if (trapResult !== null) {
          this.registerFile.writeIntRegister(1, trapResult);
        }
        if (this.finished()) return;
      }

      // RFE: Return From Exception - restaura PC desde IAR
      if (entry.opcode === 'RFE') {
        this.pc = this.iar() + 4;
        this.cause.set(''); // Limpiar causa de excepción: error detectado en test unitario, los otros procesadores limpian la causa pero aquí se olvidó esta linea
        this.flushPipeline();
        this.addLog(`[RI]: RFE retornando a 0x${this.pc.toString(16)} (IAR)`, 'info');
      }
    }
  }

  private updateArchitecturalRegister(type: RegisterType, num: number, value: number, isDouble: boolean = false, opcode: string, robTag?: ROBTag): void {
    if (type === 'R' && num !== 0) {
      this.registerFile.writeIntRegister(num, value);
    } else if (type === 'F') {
      this.setFloatValue(num, value, isDouble, opcode, robTag);
    } else if (type === 'FPBC') {
      this.registerFile.fpConditionBit.set(value);
    } else if (type === 'VLR') {
      // Vector Length Register
      const newVL = Math.max(0, Math.min(this.MVL, value | 0));
      this.registerFile.vl.set(newVL);
      this.addLog(`VLR actualizado: ${newVL}`, 'info');
    } else if (type === 'VM') {
      // Vector Mask - se maneja en casos especiales arriba
      this.addLog(`VM actualizado`, 'info');
    }
  }

  /**
   * Helper para realizar commit de stores vectoriales
   */
  private commitVectorStore(data: {
    baseAddr: number;
    stride: number;
    isScatter: boolean;
    sourceReg: number;
    vl: number;
    mask: Float64Array;
    values: Float64Array;
    indicesVector?: Float64Array | null;  // Para SVI: índices resueltos con renaming
  }, robTag?: ROBTag): void {
    // Usar los valores capturados durante ejecución
    const sourceValues = data.values;
    //console.log(`[commitVectorStore] baseAddr=${data.baseAddr}, stride=${data.stride}, isScatter=${data.isScatter}, vl=${data.vl}`);
    //console.log(`[commitVectorStore] values[0]=${sourceValues?.[0]}, mask[0]=${data.mask[0]}`);

    for (let i = 0; i < data.vl; i++) {
      //comprobar la mascara real y no el snapshot porque RI es en orden y en este punto la mascara real esta actualizada, si usamos el que arrastramos aqui puede llevar una mascara desactualizada
      if (!this.registerFile.isVectorMaskElementActive(i)) {
        //console.log(`[commitVectorStore] elem ${i} skipped (mask=0)`);
        continue;
      }

      let addr: number;
      if (data.isScatter) {
        // SVI: scatter con índices vectoriales (resueltos con renaming en EX)
        const index = data.indicesVector ? data.indicesVector[i] : 0;
        addr = data.baseAddr + index;
      } else {
        // SV, SVWS: usar stride
        addr = data.baseAddr + data.stride * i;
      }
      //console.log(`[commitVectorStore] elem ${i}: addr=0x${addr.toString(16)}, value=${sourceValues[i]}`);
      // Escribir double (64 bits)
      this.safeWriteMemory('SD', addr, sourceValues[i], 8, robTag);
    }

    this.addLog(`MEM: Store vectorial committed (${data.vl} elementos)`, 'info');
  }

  /**
   * Helper para RI, escritura en memoria
   * @param address
   * @param value
   * @param opcode
   * @param robTag
   * @private
   */
  private writeMemory(address: number, value: number, opcode: string, robTag?: ROBTag): void {
    const op = opcode.toUpperCase();
    switch (op) {
      case 'SB':
        this.safeWriteMemory(op, address, value, 1, robTag);
        break;
      case 'SH':
        this.safeWriteMemory(op, address, value, 2, robTag);
        break;
      case 'SF':
        this.safeWriteMemory(op, address, value, 3, robTag);
        break;
      case 'SD':
        this.safeWriteMemory(op, address, value, 8, robTag);
        break;
      case 'SW':
      default:
        this.safeWriteMemory(op, address, value, 4, robTag);
        break;
    }
  }

  /**
   * Helper para obtener una instruccion en vuelo por su PC
   * @param pc
   * @private
   */
  private findInflightByPC(pc: number): InFlightInstruction | undefined {
    for (const inf of this.inFlight.values()) {
      if (inf.pc === pc && inf.state === 'FETCHED') {
        return inf;
      }
    }
    return undefined;
  }

  /**
   * Helper para obtener una instruccion en vuelo por su robTag
   * @param robTag
   * @private
   */
  private findInflightByRobTag(robTag: ROBTag): InFlightInstruction | undefined {
    for (const inf of this.inFlight.values()) {
      // Ignorar instrucciones retiradas o flushed - el robTag puede haber sido reutilizado
      if (robTagEquals(inf.robTag, robTag) && inf.state !== 'RETIRED' && inf.state !== 'FLUSHED') {
        return inf;
      }
    }
    return undefined;
  }

  /**
   * Helper para obtener una instruccion en vuelo por opcode
   * @param opcode
   * @private
   */
  private findInflightByOpCode(opcode: string): InFlightInstruction | undefined {
    for (const inf of this.inFlight.values()) {
      // Ignorar instrucciones retiradas o flushed
      if (inf.instr.opcode === opcode && inf.state !== 'RETIRED' && inf.state !== 'FLUSHED') {
        return inf;
      }
    }
    return undefined;
  }

  /**
   * Elimina instrucciones retiradas o flushed del mapa inFlight para evitar que crezca indefinidamente y que conflictos con tags reutilizados
   */
  private cleanupInflight(): void {
    const toDelete: number[] = [];
    for (const [id, inf] of this.inFlight) {
      if (inf.state === 'RETIRED' || inf.state === 'FLUSHED') {
        toDelete.push(id);
      }
    }
    for (const id of toDelete) {
      this.inFlight.delete(id);
    }
  }

  /**
   * Verifica si no hay mas instrucciones por procesar y marca el flach finished a true
   * @private
   */
  private checkFinished(): void {
    // Verificar si no hay más instrucciones por procesar
    if (
      this.fetchBuffer.instructions.length === 0 &&
      this.rob.isEmpty() &&
      this.pc >= this.instructionsMemory.get().length
    ) {
      this.finished.set(true);
    }
  }

  /**
   *
   * Actualiza las estadisticas de ejecucion del procesador
   * @param currentCycle
   * @private
   */
  private updateStats(currentCycle: number): void {
    this.stats.cyclesTotal = currentCycle;
    this.stats.ipc = currentCycle > 0 ?
      this.stats.instructionsCommitted / currentCycle : 0;
    this.stats.robUtilization = this.rob.getUtilization();
    this.stats.rsUtilization = this.rs.getUtilization();
    // Calcular precisión de predicción
    if (this.stats.branchPredictions > 0) {
      this.stats.branchAccuracy =
        (this.stats.branchPredictions - this.stats.branchMispredictions) /
        this.stats.branchPredictions;
    }
  }

  /**
   * Actualiza el timeline propio
   * @private
   */
  private updateTimeline(): void {
    const currentCycle = this.cycle();

    for (const inf of this.inFlight.values()) {
      // Obtener o crear entrada en el índice
      let entry = this.timelineIndex.get(inf.id);
      if (!entry) {
        entry = {
          id: inf.id,
          pc: inf.pc,
          raw: inf.instr.toString(),
          stages: {},
          completed: false,
          isVector: inf.instr.isVector,
          flushed: false
        };
        this.timelineIndex.set(inf.id, entry);
      }

      // Si fue flushed, marcarla y no actualizar más ciclos
      if (inf.state === 'FLUSHED') {
        entry.flushed = true;
        continue; // No seguir actualizando ciclos después del flush
      }

      // Actualizar solo el ciclo actual si corresponde
      // Determinar qué etapa mostrar en este ciclo
      let label = '';

      if (inf.cycleRI && currentCycle === inf.cycleRI) {
        label = STAGE_LABELS.RI;
      } else if (inf.cycleWR && currentCycle >= inf.cycleWR && (!inf.cycleRI || currentCycle < inf.cycleRI)) {
        label = STAGE_LABELS.WR;
      } else if (inf.cycleEX && currentCycle >= inf.cycleEX && (!inf.cycleWR || currentCycle < inf.cycleWR)) {
        // Si tiene WR, calcular latencia
        if (inf.cycleWR) {
          const totalCycles = inf.cycleWR - inf.cycleEX;
          if (totalCycles > 1) {
            const cyclesLeft = inf.cycleWR - currentCycle;
            label = cyclesLeft > 0 ? `${STAGE_LABELS.EX}(${cyclesLeft})` : STAGE_LABELS.EX;
          } else {
            label = STAGE_LABELS.EX;
          }
        } else {
          // En ejecución, sin WR todavía
          if (inf.executionPhaseLabel !== null) {
            label = inf.executionPhaseLabel;
          } else {
            const remaining = inf.cyclesRemainingEX;
            label = remaining > 1 ? `${STAGE_LABELS.EX}(${remaining})` : STAGE_LABELS.EX;
          }
        }
      } else if (inf.cycleII_E && currentCycle >= inf.cycleII_E && (!inf.cycleEX || currentCycle < inf.cycleEX)) {
        label = STAGE_LABELS.II_E;
      } else if (inf.cycleII_D && currentCycle >= inf.cycleII_D && (!inf.cycleII_E || currentCycle < inf.cycleII_E)) {
        // Entre II-D y II-E es supervisión
        if (inf.cycleII_E && currentCycle < inf.cycleII_E) {
          label = STAGE_LABELS.II_S;
        } else {
          label = STAGE_LABELS.II_D;
        }
      } else if (inf.cycleID && currentCycle >= inf.cycleID && (!inf.cycleII_D || currentCycle < inf.cycleII_D)) {
        label = STAGE_LABELS.ID;
      } else if (inf.cycleIF && currentCycle >= inf.cycleIF && (!inf.cycleID || currentCycle < inf.cycleID)) {
        label = STAGE_LABELS.IF;
      }

      // Solo escribir si hay etiqueta y el ciclo no está ya escrito
      if (label && !entry.stages[currentCycle]) {
        entry.stages[currentCycle] = label;
      }

      // Marcar como completada si retirada
      if (inf.state === 'RETIRED') {
        entry.completed = true;
      }
    }

    // Convertir el índice a array para el signal
    this.timeline.set(Array.from(this.timelineIndex.values()));
  }

  /**
   * Obtiene las estadisticas actuales (para visualizacion en el componente de estadisticas)
   */
  getStats(): SuperscalarStats {
    return { ...this.stats };
  }

  /**
   * Obtiene las entries del rob (para visualizacion en su componente)
   */
  getROBEntries(): ROBEntry[] {
    return this.rob.getAllEntries();
  }

  /**
   * Obtiene las entries de las RS (para visualizacion en su componente)
   */
  getRSEntries(): RSEntry[] {
    return this.rs.getAllOccupied();
  }

  /**
   * Obtiene información de ocupación de RS por tipo de FU
   * Retorna un Map con el número de ocupadas y totales para cada fuType
   */
  getRSUtilizationByType(): Map<string, {occupied: number, total: number}> {
    const result = new Map<string, {occupied: number, total: number}>();
    const allEntries = this.rs.getAllOccupied();

    // Agrupar por fuType
    const byType = new Map<string, RSEntry[]>();
    for (const entry of allEntries) {
      if (!byType.has(entry.fuType)) {
        byType.set(entry.fuType, []);
      }
      byType.get(entry.fuType)!.push(entry);
    }

    // Para RS distribuidas, tenemos el size por unidad
    if (this.rs.type === 'distributed') {
      const distributed = this.rs as DistributedRS;
      // Iterar todos los tipos de FU conocidos. TODO: sacar estos codigos a mano a una lista generica
      const fuTypes: FunctionalUnitType[] = [
        'INT_ALU', 'INT_MUL', 'INT_DIV',
        'FP_ADD', 'FP_MUL', 'FP_DIV',
        'MEM', 'BRANCH',
        'VEC_MEM', 'VEC_INT', 'VEC_MUL', 'VEC_DIV'
      ];

      for (const fuType of fuTypes) {
        const entries = byType.get(fuType) || [];
        const total = this.config.rsPerUnitSize; // Size configurado por unidad
        result.set(fuType, { occupied: entries.length, total });
      }
    } else {
      // Para centralized y clustered, usar lo que tenemos
      for (const [fuType, entries] of byType.entries()) {
        result.set(fuType, { occupied: entries.length, total: entries.length });
      }
    }

    return result;
  }

  /**
   * Obtiene los resultados publicados del CDB (para visualizacion en su componente)
   */
  getCDBResults(): CDBResult[] {
    return this.cdb.getResults();
  }

  /**
   * Obtiene el estado completo del RRF según Figura 2.40: Datos | Ocupado | Índice
   * - Datos: viene de RegisterFile
   * - Ocupado/Índice: viene del RRF
   */
  getRRFState(): {
    intRegs: { datos: number; ocupado: boolean; indice: ROBTag | null }[];
    floatRegs: { datos: number; ocupado: boolean; indice: ROBTag | null }[];
    vectorRegs: { ocupado: boolean; indice: ROBTag | null }[];
    fpbcRegs: { datos: number; ocupado: boolean; indice: ROBTag | null }[];
    vlrRegs: { datos: number; ocupado: boolean; indice: ROBTag | null }[];
    vmRegs: { ocupado: boolean; indice: ROBTag | null }[];
  } {
    const renameState = this.rrf.getState();
    const intValues = this.registerFile.registers();
    const floatValues = this.registerFile.floatRegisters();
    const fpbcValue = this.registerFile.fpConditionBit();
    const vlrValue = this.registerFile.vl();
    //const vmValue = this.registerFile.vectorMask();

    return {
      intRegs: renameState.intRegs.map((e, i) => ({
        datos: intValues[i],
        ocupado: e.ocupado,
        indice: e.indice
      })),
      floatRegs: renameState.floatRegs.map((e, i) => ({
        datos: floatValues[i],
        ocupado: e.ocupado,
        indice: e.indice
      })),
      vectorRegs: renameState.vectorRegs.map(e => ({
        ocupado: e.ocupado,
        indice: e.indice
      })),
      fpbcRegs: renameState.fpbcRegs.map((e) => ({
        datos: fpbcValue,
        ocupado: e.ocupado,
        indice: e.indice
      })),
      vlrRegs: renameState.vlrRegs.map((e) => ({
        datos: vlrValue,
        ocupado: e.ocupado,
        indice: e.indice
      })),
      vmRegs: renameState.vmRegs.map(e => ({
        ocupado: e.ocupado,
        indice: e.indice
      }))
    };
  }

  /** Solicitud de entrada stdin pendiente (TRAP 3) */
  override trapStdinRequest = signal<{ bufAddr: number; maxBytes: number; instrId: number; pendingInput?: string; flushed?: boolean } | null>(null);
  /**
   * Helper para resolver la lectura de stdin (TRAP 3, fd=0) cuando el usuario confirma desde consola
   * Escribe la cadena introducida en el buffer de memoria y reanuda la ejecución.
   */
  override resolveTrapStdin(input: string): void {
    const req = this.trapStdinRequest();
    if (!req) return;
    //console.log(`[resolveTrapStdin] Received input: "${input}"`);
    // Calcular bytes
    const bytes = Math.min(input.length, req.maxBytes - 1);
    // Guardar el input en la request
    // La escritura a memoria ocurrirá en commit cuando el procesador reanude
    this.trapStdinRequest.set({ ...req, pendingInput: input });

    this.addLog(`TRAP 3: entrada recibida "${input}" (${bytes} bytes) - procesador reanudará`, 'success');
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
   * @param robTag
   * @private
   */
  private trapReadString(addr: number, maxLen: number = 256, robTag?: ROBTag): string {
    let result = '';
    for (let i = 0; i < maxLen; i++) {
      const byte = this.safeReadMemory('TRAP', addr + i, 1, false, robTag);
      if (!byte) break;  // detiene en 0 (null terminator) o undefined (fuera de rango)
      result += String.fromCharCode(byte);
    }
    return result;
  }

  /**
   * Escribe una cadena en memoria de datos y añade el terminador nulo.
   * Devuelve el número de bytes escritos (sin contar el null).
   */
  private trapWriteString(addr: number, text: string, maxBytes: number, robTag?: ROBTag): number {
    const limit = Math.min(text.length, maxBytes - 1);
    for (let i = 0; i < limit; i++) {
      this.safeWriteMemory('TRAP', addr + i, text.charCodeAt(i), 1, robTag);
    }
    this.safeWriteMemory('TRAP', addr + limit, 0, 1, robTag); // null terminator
    return limit;
  }

  /** Implementación de printf para TRAP 5 */
  private trapFormatPrintf(fmtPtrAddr: number, argsAddr: number, robTag?: ROBTag): string {
    const fmtAddr = this.safeReadMemory('TRAP', fmtPtrAddr, 4, true, robTag);
    const fmt = this.trapReadString(fmtAddr, 256, robTag);
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
          case 'd': case 'i':
            result += this.safeReadMemory('TRAP', argsAddr + argOffset, 4, true, robTag).toString();
            argOffset += 4;
            break;
          case 'u':
            result += (this.safeReadMemory('TRAP', argsAddr + argOffset, 4, false, robTag) >>> 0).toString();
            argOffset += 4;
            break;
          case 'f':
            result += this.safeReadMemory('TRAP', argsAddr + argOffset, 9, false, robTag).toFixed(6);
            argOffset += 8;
            break;
          case 'g': case 'e':
            const val = this.safeReadMemory('TRAP', argsAddr + argOffset, 9, false, robTag);
            result += spec === 'g' ? val.toPrecision(6) : val.toExponential(6);
            argOffset += 8;
            break;
          case 's':
            const strPtr = this.safeReadMemory('TRAP', argsAddr + argOffset, 4, true, robTag);
            result += this.trapReadString(strPtr, 256, robTag);
            argOffset += 4;
            break;
          case 'c':
            result += String.fromCharCode(this.safeReadMemory('TRAP', argsAddr + argOffset, 4, true, robTag) & 0xFF);
            argOffset += 4;
            break;
          case 'x': case 'X':
            const hex = (this.safeReadMemory('TRAP', argsAddr + argOffset, 4, false, robTag) >>> 0).toString(16);
            result += spec === 'X' ? hex.toUpperCase() : hex;
            argOffset += 4;
            break;
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

  /** Ejecuta un TRAP durante commit */
  /**
   * devuelve el resultado del trap que debe guardarse en R1
   * @param entry
   * @param inflight
   * @private
   */
  private executeTrap(entry: ROBEntry, inflight: InFlightInstruction | undefined): number | null {
    const trapCode = entry.instrRef?.imm ?? 0;

    // IAR ya fue guardado en RI para TRAP 3 (antes de pausar), actualizamos para otros TRAPs
    if (inflight && trapCode !== 3) {
      this.iar.set((inflight.pc + 4) & 0xFFFFFFFF);
    }

    switch (trapCode) {
      case 0: // salida del programa de manera ordenada
        this.addLog(`[RI]: TRAP ${trapCode} retirado, finalizando ejecución ordenada`, 'success');
        this.flushPipeline(); // Limpiar restos especulativos (si los hubiera)
        // Establecer PC fuera del rango válido para que no se carguen más instrucciones
        this.pc = this.instructionsMemory.get().length;
        this.finished.set(true);
        return 0;
      case 6:
        //parada unilateral, devuelvo null para no sobreescribir R1
        this.addLog(`[RI]: TRAP ${trapCode} retirado, finalizando ejecución ordenada`, 'success');
        this.flushPipeline(); // Limpiar restos especulativos (si los hubiera)
        // Establecer PC fuera del rango válido para que no se carguen más instrucciones
        this.pc = this.instructionsMemory.get().length;
        this.finished.set(true);
        return null;
      case 1: // open (no soportado)
        this.addLog('TRAP 1: open() no soportado en el simulador', 'warning');
        return -1;
      case 2: // close (NOP)
        this.addLog('TRAP 2: close() no soportado en el simulador', 'warning');
        return -1;
      case 3: { // read (stdin)
        const trapParams = inflight?.trapParams;
        const fd = trapParams?.fd ?? 0;
        if (fd !== 0) {
          this.addLog(`TRAP 3: fd=${fd} no soportado (solo fd=0/stdin)`, 'warning');
          return -1;
        }
        // Si llegamos aquí, ya tenemos pendingInput (verificado antes de commit)
        const req = this.trapStdinRequest();
        if (req && (req as any).pendingInput) {
          // Usar bufAddr/maxBytes de la request (params leídos en EX, guardados en RI)
          const { bufAddr, maxBytes, pendingInput } = req as any;
          //console.log(`[TRAP 3 COMMIT] Writing stdin to memory at 0x${bufAddr.toString(16)}`);
          const bytesWritten = this.trapWriteString(bufAddr, pendingInput, maxBytes, inflight?.robTag!);
          // Restaurar PC desde IAR (guardado en RI antes de pausar = PC + 4)
          const returnAddr = this.iar();
          //console.log(`[TRAP 3 COMMIT] Restaurando PC desde IAR: 0x${returnAddr.toString(16)}`);
          this.pc = returnAddr;
          // Limpiar fetch buffer
          this.fetchBuffer.instructions = [];
          this.fetchBuffer.pcs = [];
          // IMPORTANTE: Limpiar TO DO el RRF porque estamos reiniciando desde IAR
          // Los robTags antiguos serán reutilizados por nuevas instrucciones
          this.rrf.reset();
          //console.log(`[TRAP 3 COMMIT] RRF reset for fresh start`);
          // Limpiar request
          this.trapStdinRequest.set(null);
          this.addLog(`TRAP 3: escribió ${bytesWritten} bytes, retornando a 0x${returnAddr.toString(16)}`, 'info');

          return bytesWritten;
        }

        return null;
      }
      case 4: { // write
        const trapParams = inflight?.trapParams;

        if (trapParams) {
          // Usar fd guardado en EX (no releer de R14)
          const fd = trapParams.fd;
          const bufAddr = trapParams.bufAddr;
          const maxBytes = trapParams.maxBytes;

          if (fd === 1 || fd === 2) {
            let text = '';
            for (let i = 0; i < maxBytes; i++) {
              const byte = this.safeReadMemory('TRAP', bufAddr + i, 1, false, inflight?.robTag!);
              text += String.fromCharCode(byte);
            }
            this.trapPrint(text);

            return maxBytes;
          } else {
            this.addLog(`TRAP 4: fd=${fd} no soportado (solo fd=1/stdout, fd=2/stderr)`, 'warning');

            return -1;
          }
        } else {
          this.addLog(`TRAP 4: sin parametros de entrada no soportado`, 'warning');

          return -1;
        }
      }
      case 5: { // printf
        const trapParams = inflight?.trapParams;

        if (trapParams) {
          const fdAddr = trapParams.fdAddr;
          const output = this.trapFormatPrintf(fdAddr, fdAddr + 4, inflight?.robTag!);
          this.trapPrint(output);

          return output.length;
        } else {
          this.addLog(`TRAP 5: sin parametros de entrada no soportado`, 'warning');

          return -1;
        }
      }
      default:
        this.addLog(`TRAP ${trapCode}: código desconocido`, 'error');

        return -1;
    }
  }
}
