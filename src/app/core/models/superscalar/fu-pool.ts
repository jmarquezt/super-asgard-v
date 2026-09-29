/**
 * Pool de Unidades Funcionales
 * Basado en el modelo del libro de la asignatura
 *
 * Gestiona todas las UFs del procesador superescalar:
 * - Verifica disponibilidad para emisión
 * - Actualiza ciclos restantes
 * - Genera resultados cuando terminan la operación
 */

import { FunctionalUnitType, FunctionalUnitState } from './fu';
import { SuperscalarConfig } from '../asg.config';
import { RSEntry } from './rs';
import { ROBTag, robTagEquals } from './rob';
import { getConfiguredLatency, LatencyConfig, VECTOR_COMPARISON_OPCODES } from '../asg.config';

/**
 * Información de una operación en ejecución en una UF
 */
interface ExecutingOp {
  robTag: ROBTag;
  rsIndex: number;
  entry: RSEntry;
  cyclesRemaining: number;
  result: number | null;
  vectorResult: Float64Array | null;
}

/** Configuración vectorial para cálculo de latencias */
export interface VectorConfig {
  vl: number;       // Vector Length actual
  aluLanes: number; // Lanes para ALU vectorial
  memLanes: number; // Lanes para memoria vectorial
}

export class FunctionalUnitPool {
  private units: Map<FunctionalUnitType, FunctionalUnitState[]>;
  private executing: Map<number, ExecutingOp>;  // unitId -> operación principal
  private pendingVectorOp: Map<number, ExecutingOp>;  // unitId -> operación en init pendiente
  private latencyConfig: LatencyConfig | null;
  private vectorConfig: VectorConfig;
  private nextUnitId: number;

  constructor(config: SuperscalarConfig, latencyConfig?: LatencyConfig, vectorConfig?: VectorConfig) {
    this.units = new Map();
    this.executing = new Map();
    this.pendingVectorOp = new Map();
    this.nextUnitId = 0;
    this.latencyConfig = latencyConfig ?? null;
    this.vectorConfig = vectorConfig ?? { vl: 64, aluLanes: 4, memLanes: 4 };

    // Crear UFs ESCALARES según configuración
    this.createUnits('INT_ALU', config.intALUs);
    this.createUnits('INT_MUL', config.intMulUnits);
    this.createUnits('INT_DIV', config.intDivUnits);
    this.createUnits('FP_ADD', config.fpAddUnits);
    this.createUnits('FP_MUL', config.fpMulUnits);
    this.createUnits('FP_DIV', config.fpDivUnits);
    this.createUnits('MEM', config.memUnits);
    this.createUnits('BRANCH', config.branchUnits);

    // Crear UFs VECTORIALES según configuración
    this.createUnits('VEC_MEM', config.vecMemUnits);
    this.createUnits('VEC_INT', config.vecIntUnits);
    this.createUnits('VEC_MUL', config.vecMulUnits);
    this.createUnits('VEC_DIV', config.vecDivUnits);
  }

  private createUnits(type: FunctionalUnitType, count: number): void {
    const units: FunctionalUnitState[] = [];
    for (let i = 0; i < count; i++) {
      units.push({
        id: this.nextUnitId++,
        type,
        busy: false,
        cyclesRemaining: 0,
        robTag: null,
        rsIndex: null
      });
    }
    this.units.set(type, units);
  }

  /**
   * Resetea todas las UFs a estado libre
   */
  reset(): void {
    for (const units of this.units.values()) {
      for (const unit of units) {
        unit.busy = false;
        unit.cyclesRemaining = 0;
        unit.robTag = null;
        unit.rsIndex = null;
      }
    }
    this.executing.clear();
    this.pendingVectorOp.clear();
  }

  /**
   * Verifica si hay una UF libre del tipo especificado
   */
  hasAvailable(type: FunctionalUnitType): boolean {
    const units = this.units.get(type) ?? [];
    return units.some(u => !u.busy);
  }

  /**
   * Cuenta UFs libres del tipo especificado
   */
  countAvailable(type: FunctionalUnitType): number {
    const units = this.units.get(type) ?? [];
    return units.filter(u => !u.busy).length;
  }

  /**
   * Verifica si hay una FU disponible para solapamiento vectorial.
   * Retorna true si:
   * - Hay una FU completamente libre, O
   * - Hay una FU ocupada que NO tiene operación pendiente (permite solapar init)
   */
  hasAvailableForVectorOverlap(type: FunctionalUnitType): boolean {
    const units = this.units.get(type) ?? [];
    // Primero buscar FU libre
    if (units.some(u => !u.busy)) return true;
    // Si no hay libre, buscar FU ocupada sin pendiente
    return units.some(u => u.busy && !this.pendingVectorOp.has(u.id));
  }

  /**
   * Obtiene el ID de una FU ocupada que puede aceptar una operación pendiente.
   * @returns ID de la FU, o -1 si no hay ninguna disponible para solapamiento
   */
  getOverlappableFU(type: FunctionalUnitType): number {
    const units = this.units.get(type) ?? [];
    const unit = units.find(u => u.busy && !this.pendingVectorOp.has(u.id));
    return unit?.id ?? -1;
  }

  /**
   * Reserva una operación vectorial como pendiente en una FU ocupada.
   * La operación hará su 'init' mientras la actual termina.
   * @returns ID de la FU donde se reservó, o -1 si no hay disponible
   */
  reservePending(type: FunctionalUnitType, robTag: ROBTag, rsIndex: number, entry: RSEntry): number {
    const unitId = this.getOverlappableFU(type);
    if (unitId === -1) return -1;

    const latency = this.getLatency(type, entry);
    // Registrar como operación pendiente (no marcar FU como ocupada de nuevo)
    this.pendingVectorOp.set(unitId, {
      robTag,
      rsIndex,
      entry,
      cyclesRemaining: latency,
      result: null,
      vectorResult: null
    });

    //console.log(`[FU Overlap] Reserved pending op ROB[${robTag.slot}] on FU[${unitId}]`);
    return unitId;
  }

  /**
   * Verifica si una FU tiene una operación pendiente
   */
  hasPendingOp(unitId: number): boolean {
    return this.pendingVectorOp.has(unitId);
  }

  /**
   * Obtiene la operación pendiente de una FU
   */
  getPendingOp(unitId: number): ExecutingOp | undefined {
    return this.pendingVectorOp.get(unitId);
  }

  /**
   * Promueve la operación pendiente a principal cuando la actual termina.
   * @returns La operación promovida, o null si no había pendiente
   */
  promotePending(unitId: number): ExecutingOp | null {
    const pending = this.pendingVectorOp.get(unitId);
    if (!pending) return null;

    // Buscar la unidad y actualizar sus datos
    for (const units of this.units.values()) {
      const unit = units.find(u => u.id === unitId);
      if (unit) {
        unit.robTag = pending.robTag;
        unit.rsIndex = pending.rsIndex;
        unit.cyclesRemaining = pending.cyclesRemaining;
        // unit.busy ya es true
      }
    }

    // Mover de pendiente a ejecutando
    this.pendingVectorOp.delete(unitId);
    this.executing.set(unitId, pending);

    //console.log(`[FU Overlap] Promoted pending op ROB[${pending.robTag.slot}] to main on FU[${unitId}]`);
    return pending;
  }

  /**
   * Reserva una UF para ejecutar una instrucción
   * @returns ID de la UF reservada, o -1 si no hay disponible
   */
  reserve(type: FunctionalUnitType, robTag: ROBTag, rsIndex: number, entry: RSEntry): number {
    const units = this.units.get(type) ?? [];
    const unit = units.find(u => !u.busy);

    if (!unit) return -1;

    const latency = this.getLatency(type, entry);

    unit.busy = true;
    unit.cyclesRemaining = latency;
    unit.robTag = robTag;
    unit.rsIndex = rsIndex;

    // Registrar operación en ejecución
    this.executing.set(unit.id, {
      robTag,
      rsIndex,
      entry,
      cyclesRemaining: latency,
      result: null,
      vectorResult: null
    });

    return unit.id;
  }

  /**
   * Actualiza la configuración vectorial (llamar antes de cada ciclo por si VL ha sido cambiada por alguna instruccion, las lanes no se pueden cambiar sin resetear el procesador)
   */
  updateVectorConfig(config: VectorConfig): void {
    this.vectorConfig = config;
  }

  /**
   * Obtiene la latencia para una operación.
   *
   * Para instrucciones escalares:
   *   Prioridad: 1) configuración del usuario, 2) cyclesRemaining de la instrucción
   *
   * Para instrucciones vectoriales:
   *   - ALU vectorial: initDelay + ceil(vl / aluLanes)
   *   - Cargas (LV, LVWS, LVI): initDelay + ceil(vl / memLanes)
   *   - Stores (SV, SVWS, SVI): ceil(vl / memLanes) + endDelay
   */
  private getLatency(type: FunctionalUnitType, entry: RSEntry): number {
    const instr = entry.instrRef;
    if (!instr) return 1;

    // Instrucciones vectoriales tienen cálculo especial
    if (instr.isVector)
      return this.getVectorLatency(instr);

    // Obtengo latencia de la configuración del usuario
    if (this.latencyConfig) {
      const cfgLatency = getConfiguredLatency(instr.opcode, this.latencyConfig);
      if (cfgLatency !== undefined) {
        return cfgLatency;
      }
    }

    // Latencia por defecto del ASG_MAP
    return instr.cyclesRemaining ?? 1;
  }

  /**
   * Calcula la latencia total para operaciones vectoriales.
   *
   * MODELO DE EJECUCIÓN VECTORIAL:
   * - LOADS/ALU: initDelay + ceil(vl / lanes)
   *   - initDelay: tiempo de arranque antes de procesar primer elemento
   *   - ceil(vl/lanes): ciclos de procesamiento (lanes elementos por ciclo)
   *
   * - STORES: ceil(vl / lanes) + endDelay
   *   - ceil(vl/lanes): ciclos de procesamiento
   *   - endDelay: tiempo de envío a memoria después de procesar
   *
   *   TODO: eliminar referencias a mano a codigos de operaciones
   *
   * @param instr Instrucción vectorial
   * @returns Latencia total en ciclos
   */
  private getVectorLatency(instr: any): number {
    const op = instr.opcode?.toUpperCase() ?? '';
    const vl = this.vectorConfig.vl;
    const aluLanes = this.vectorConfig.aluLanes;
    const memLanes = this.vectorConfig.memLanes;

    // Sin configuración, usar valores por defecto
    if (!this.latencyConfig)
      return Math.ceil(vl / aluLanes) + 1; // 1 ciclo de init por defecto

    const processingCycles = (op: string) => {
      if (['LV', 'LVWS', 'LVI', 'SV', 'SVWS', 'SVI'].includes(op)) {
        return Math.ceil(vl / memLanes);
      }
      return Math.ceil(vl / aluLanes);
    };

    // STORES: procesamiento + endDelay
    if (['SV', 'SVWS', 'SVI'].includes(op)) {
      return processingCycles(op) + this.latencyConfig.vecMem;
    }

    // LOADS: initDelay + procesamiento
    if (['LV', 'LVWS', 'LVI'].includes(op)) {
      return this.latencyConfig.vecMem + processingCycles(op);
    }

    // Multiplicación vectorial: initDelay + procesamiento
    if (op.includes('MULT')) {
      return this.latencyConfig.vecMul + processingCycles(op);
    }

    // División vectorial: initDelay + procesamiento
    if (op.includes('DIV')) {
      return this.latencyConfig.vecDiv + processingCycles(op);
    }

    // Comparaciones vectoriales: initDelay + procesamiento
    if ((VECTOR_COMPARISON_OPCODES as readonly string[]).includes(op)) {
      return this.latencyConfig.vecCmp + processingCycles(op);
    }

    // ALU vectorial (ADD, SUB, CVI, CVM): initDelay + procesamiento
    return this.latencyConfig.vecAdd + processingCycles(op);
  }

  /**
   * Avanza un ciclo de ejecución para instrucciones ESCALARES.
   * Las instrucciones VECTORIALES usan lógica manual de fases (no decrementan aquí).
   * @returns Lista de operaciones ESCALARES que terminaron este ciclo
   */
  tick(currentCycle: number): { unitId: number; robTag: ROBTag; result: number; vectorResult: Float64Array | null }[] {
    const finished: { unitId: number; robTag: ROBTag; result: number; vectorResult: Float64Array | null }[] = [];

    for (const units of this.units.values()) {
      for (const unit of units) {
        if (!unit.busy) continue;

        // INSTRUCCIONES VECTORIALES: No decrementar automáticamente
        // Se manejan manualmente en processVectorElementsIncremental() para manejar el chaining
        const op = this.executing.get(unit.id);
        const isVector = op?.entry?.instrRef?.isVector ?? false;

        // No tocar cyclesRemaining - se maneja manualmente
        if (isVector)
          continue;

        // INSTRUCCIONES ESCALARES: Decrementar normalmente
        unit.cyclesRemaining--;

        if (unit.cyclesRemaining <= 0) {
          if (op) {
            // Calcular resultado (simplificado - el resultado real lo calcula el procesador)
            finished.push({
              unitId: unit.id,
              robTag: op.robTag,
              result: op.result ?? 0,
              vectorResult: op.vectorResult
            });

            this.executing.delete(unit.id);
          }

          // Liberar UF
          unit.busy = false;
          unit.robTag = null;
          unit.rsIndex = null;
        }
      }
    }

    return finished;
  }

  /**
   * Marca una instrucción vectorial como terminada.
   * Si hay una operación pendiente en la misma FU, la promueve (no libera la FU).
   * Si no hay pendiente, libera la FU.
   * Llamar desde processVectorElementsIncremental cuando vectorPhase = null.
   */
  finishVectorInstruction(unitId: number): { unitId: number; robTag: ROBTag; result: number; vectorResult: Float64Array | null } | null {
    const op = this.executing.get(unitId);
    if (!op) return null;

    const result = {
      unitId,
      robTag: op.robTag,
      result: op.result ?? 0,
      vectorResult: op.vectorResult
    };

    this.executing.delete(unitId);

    // Verificar si hay operación pendiente para promover
    if (this.pendingVectorOp.has(unitId)) {
      this.promotePending(unitId);
      // La FU sigue ocupada con la operación promovida
      return result;
    }

    // No hay pendiente, liberar la FU
    for (const units of this.units.values()) {
      const unit = units.find(u => u.id === unitId);
      if (unit && unit.busy) {
        unit.busy = false;
        unit.cyclesRemaining = 0;
        unit.robTag = null;
        unit.rsIndex = null;
      }
    }

    return result;
  }

  /**
   * Establece el resultado de una operación
   */
  setResult(unitId: number, result: number, vectorResult: Float64Array | null = null): void {
    const op = this.executing.get(unitId);
    if (op) {
      op.result = result;
      op.vectorResult = vectorResult;
    }
  }

  /**
   * Cancela una operación (ej: por un flush)
   */
  cancel(robTag: ROBTag): void {
    // Cancelar operación principal
    for (const units of this.units.values()) {
      for (const unit of units) {
        if (robTagEquals(unit.robTag, robTag)) {
          // Verificar si hay pendiente que pueda tomar el lugar
          if (this.pendingVectorOp.has(unit.id)) {
            this.promotePending(unit.id);
          } else {
            unit.busy = false;
            unit.cyclesRemaining = 0;
            unit.robTag = null;
            unit.rsIndex = null;
          }
          this.executing.delete(unit.id);
        }
      }
    }
    // Cancelar operación pendiente
    for (const [unitId, op] of this.pendingVectorOp.entries()) {
      if (robTagEquals(op.robTag, robTag)) {
        this.pendingVectorOp.delete(unitId);
      }
    }
  }

  /**
   * Cancela todas las operaciones DESPUÉS de fromSlot en orden circular del ROB
   * @param fromSlot Slot desde donde empezar a limpiar
   * @param robHead Cabeza actual del ROB (para comparación circular)
   * @param robSize Tamaño del ROB
   */
  flushFrom(fromSlot: number, robHead: number, robSize: number): number {
    let flushed = 0;
    const posFrom = (fromSlot - robHead + robSize) % robSize;

    // Flushear operaciones pendientes primero
    for (const [unitId, op] of this.pendingVectorOp.entries()) {
      const posOp = (op.robTag.slot - robHead + robSize) % robSize;
      if (posOp >= posFrom) {
        this.pendingVectorOp.delete(unitId);
        flushed++;
      }
    }

    // Limpiar operaciones principales
    for (const units of this.units.values()) {
      for (const unit of units) {
        if (unit.robTag !== null) {
          const posUnit = (unit.robTag.slot - robHead + robSize) % robSize;

          if (posUnit >= posFrom) {
            // Verificar si hay pendiente que pueda tomar el lugar
            if (this.pendingVectorOp.has(unit.id)) {
              this.promotePending(unit.id);
            } else {
              unit.busy = false;
              unit.cyclesRemaining = 0;
              unit.robTag = null;
              unit.rsIndex = null;
            }
            this.executing.delete(unit.id);
            flushed++;
          }
        }
      }
    }

    return flushed;
  }

  /**
   * Obtiene el estado de todas las UFs de un tipo
   */
  getUnits(type: FunctionalUnitType): FunctionalUnitState[] {
    return this.units.get(type) ?? [];
  }

  /**
   * Obtiene todas las UFs
   */
  getAllUnits(): FunctionalUnitState[] {
    const all: FunctionalUnitState[] = [];
    for (const units of this.units.values()) {
      all.push(...units);
    }
    return all;
  }

  /**
   * Obtiene UFs ocupadas
   */
  getBusyUnits(): FunctionalUnitState[] {
    return this.getAllUnits().filter(u => u.busy);
  }

  /**
   * Calcula utilización por tipo de UF
   */
  getUtilizationByType(): Map<FunctionalUnitType, number> {
    const result = new Map<FunctionalUnitType, number>();

    for (const [type, units] of this.units.entries()) {
      const busy = units.filter(u => u.busy).length;
      result.set(type, units.length > 0 ? busy / units.length : 0);
    }

    return result;
  }

  /**
   * Calcula utilización total
   */
  getTotalUtilization(): number {
    const all = this.getAllUnits();
    const busy = all.filter(u => u.busy).length;
    return all.length > 0 ? busy / all.length : 0;
  }
}
