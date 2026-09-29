/**
 * Reorder Buffer (ROB) - Buffer circular para realizar commit de instrucciones en orden
 * Basado en el modelo del libro de la asignatura
 *
 * El ROB mantiene las instrucciones en vuelo en orden de programa.
 * Permite ejecución fuera de orden pero el commit de resultados y los stores a memoria realizados en orden.
 *
 * Campos base de cada entrada según el libro:
 * - O (ocupada): entrada asignada a una instrucción
 * - E (emitida): instrucción enviada a UF
 * - F (finalizada): resultado disponible
 * - V (válida): puede terminarse (sin excepción)
 * - Campos extras necesarios para los calculos internos
 */

import { AsgInstruction } from '../instructions/asg.instruction';
import { ExceptionCode } from '../asg.exceptions';
import { RegisterType } from '../asg.models';

/**
 * Tag del ROB con generación para detectar reutilización de slots
 * Cuando un slot del ROB se reutiliza, la generación se incrementa
 */
export interface ROBTag {
  /** Índice del slot en el ROB (0 a robSize-1) */
  slot: number;
  /** Generación del slot (se incrementa cada vez que se reutiliza) */
  generation: number;
}

/**
 * Compara dos ROBTags para ver si son iguales
 */
export function robTagEquals(a: ROBTag | null, b: ROBTag | null): boolean {
  if (a === null || b === null) return a === b;
  return a.slot === b.slot && a.generation === b.generation;
}

/**
 * Compara si un ROBTag coincide con un slot y generación dados
 */
export function robTagMatches(tag: ROBTag | null, slot: number, generation: number): boolean {
  if (tag === null) return false;
  return tag.slot === slot && tag.generation === generation;
}

/**
 * Entrada del Reorder Buffer
 * Campos según el modelo del libro "Ingeniería de Computadores II"
 */
export interface ROBEntry {
  // --- Campos de estado (bits) ---
  /** O - Entrada ocupada/asignada a una instrucción */
  ocupada: boolean;
  /** E - Instrucción emitida a UF */
  emitida: boolean;
  /** F - Instrucción finalizada (resultado disponible) */
  finalizada: boolean;

  // --- Identificación ---
  /** Índice/slot en el ROB (0 a robSize-1) */
  tag: number;
  /** Generación del slot (se incrementa cada vez que se reutiliza) */
  generation: number;
  /** PC de la instrucción */
  pc: number;
  /** Código de operación */
  opcode: string;

  // --- Registro destino arquitectónico ---
  /** Número de registro destino (null si no escribe) */
  regDestino: number | null;
  /** Tipo de registro: R (entero), F (flotante), V (vector) */
  tipoReg: RegisterType | null;

  // --- Resultado ---
  /** Valor resultado (null hasta WR) */
  valor: number | null;
  /** Resultado vectorial (para instrucciones vectoriales) */
  vectorResult: Float64Array | null;

  // --- Control de especulación ---
  /** Instrucción bajo predicción de salto */
  especulativa: boolean;
  /** Información de predicción (solo para branches) */
  branchInfo: {
    predictedTaken: boolean;
    predictedTarget: number;
    actualTaken?: boolean;
    actualTarget?: number;
    mispredicted?: boolean;
  } | null;

  // --- Control de excepciones ---
  /** Puede terminarse (sin excepciones) */
  valida: boolean;
  /** Tipo de excepción si ocurrió */
  excepcion: ExceptionCode | null;

  // --- Metadata ---
  /** Referencia a la instrucción original */
  instrRef: AsgInstruction;
  /** Ciclo en que se asignó */
  cycleAllocated: number;
  /** Ciclo en que finalizó */
  cycleFinished: number | null;

  // --- Para stores ---
  /** Es operación de almacenamiento */
  isStore: boolean;
  /** Dirección de store */
  storeAddress: number | null;
  /** Valor a almacenar */
  storeValue: number | null;

  // --- Para stores vectoriales ---
  /** Es store vectorial */
  isVectorStore?: boolean;
  /** Datos para store vectorial */
  vectorStoreData?: {
    baseAddr: number;
    stride: number;
    isScatter: boolean;
    sourceReg: number;
    vl: number;
    mask: Float64Array;
    /** Valores capturados durante ejecución (para correctitud especulativa) */
    values: Float64Array;
    /** Vector de índices para SVI (scatter) - resuelto con renaming en EX */
    indicesVector?: Float64Array | null;
    /** Indica si los valores ya están capturados (procesamiento completo) */
    valuesReady?: boolean;
  } | null;
}

/**
 * Crea una entrada ROB vacía
 */
export function createEmptyROBEntry(tag: number, generation: number = 0): ROBEntry {
  return {
    ocupada: false,
    emitida: false,
    finalizada: false,
    tag,
    generation,
    pc: 0,
    opcode: '',
    regDestino: null,
    tipoReg: null,
    valor: null,
    vectorResult: null,
    especulativa: false,
    branchInfo: null,
    valida: true,
    excepcion: null,
    instrRef: null as unknown as AsgInstruction,
    cycleAllocated: 0,
    cycleFinished: null,
    isStore: false,
    storeAddress: null,
    storeValue: null
  };
}

export class ROB {
  private entries: ROBEntry[];
  private generations: number[];  // Generación actual de cada slot
  private head: number;  // Próxima instrucción a retirar (commit)
  private tail: number;  // Próxima posición libre para asignar
  private count: number; // Número de entradas ocupadas
  private readonly size: number;

  constructor(size: number) {
    this.size = size;
    this.entries = Array(size).fill(null).map((_, i) => createEmptyROBEntry(i, 0));
    this.generations = Array(size).fill(0);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  /**
   * Resetea el ROB a estado inicial
   */
  reset(): void {
    for (let i = 0; i < this.size; i++) {
      this.generations[i] = 0;
      this.entries[i] = createEmptyROBEntry(i, 0);
    }
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  /**
   * Verifica si el ROB está lleno
   */
  isFull(): boolean {
    return this.count >= this.size;
  }

  /**
   * Verifica si el ROB está vacío
   */
  isEmpty(): boolean {
    return this.count === 0;
  }

  /**
   * Obtiene el número de entradas libres
   */
  freeEntries(): number {
    return this.size - this.count;
  }

  /**
   * Obtiene el número de entradas ocupadas
   */
  occupiedEntries(): number {
    return this.count;
  }

  /**
   * Verifica si una entrada específica está ocupada
   */
  isOccupied(tag: number): boolean {
    if (tag < 0 || tag >= this.size) return false;
    return this.entries[tag].ocupada;
  }

  /**
   * Asigna una nueva entrada en el ROB (en etapa ID)
   * @returns ROBTag de la entrada asignada, o null si está lleno
   */
  allocate(instr: AsgInstruction, pc: number, regDestino: number | null, tipoReg: RegisterType | null, currentCycle: number, isStore: boolean = false, isSpeculative: boolean = false): ROBTag | null {
    if (this.isFull()) return null;

    const slot = this.tail;
    const generation = this.generations[slot];
    const entry = this.entries[slot];

    entry.ocupada = true;
    entry.emitida = false;
    entry.finalizada = false;
    entry.tag = slot;
    entry.generation = generation;
    entry.pc = pc;
    entry.opcode = instr.opcode;
    entry.regDestino = regDestino;
    entry.tipoReg = tipoReg;
    entry.valor = null;
    entry.vectorResult = null;
    entry.especulativa = isSpeculative;
    entry.branchInfo = null;
    entry.valida = true;
    entry.excepcion = null;
    entry.instrRef = instr;
    entry.cycleAllocated = currentCycle;
    entry.cycleFinished = null;
    entry.isStore = isStore;
    entry.storeAddress = null;
    entry.storeValue = null;

    this.tail = (this.tail + 1) % this.size;
    this.count++;

    return { slot, generation };
  }

  /**
   * Obtiene una entrada del ROB por su tag
   */
  getEntry(tag: number): ROBEntry | null {
    if (tag < 0 || tag >= this.size) return null;
    return this.entries[tag];
  }

  /**
   * Marca una entrada como emitida (enviada a UF)
   */
  markIssued(tag: number): void {
    const entry = this.entries[tag];
    if (entry && entry.ocupada) {
      entry.emitida = true;
    }
  }

  /**
   * Marca una entrada como finalizada con su resultado (en WR)
   */
  markFinished(tag: number, value: number | null, vectorResult: Float64Array | null, currentCycle: number): void {
    const entry = this.entries[tag];
    if (entry && entry.ocupada) {
      entry.finalizada = true;
      entry.valor = value;
      entry.vectorResult = vectorResult;
      entry.cycleFinished = currentCycle;
    }
  }

  /**
   * Marca una entrada como inválida (excepción)
   */
  markException(tag: number, exception: ExceptionCode): void {
    const entry = this.entries[tag];
    if (entry && entry.ocupada) {
      entry.valida = false;
      entry.excepcion = exception;
    }
  }

  /**
   * Actualiza información de store (dirección y valor)
   */
  setStoreInfo(tag: number, address: number, value: number): void {
    const entry = this.entries[tag];
    if (entry && entry.ocupada && entry.isStore) {
      entry.storeAddress = address;
      entry.storeValue = value;
    }
  }

  /**
   * Establece información de branch para predicción
   */
  setBranchInfo(tag: number, predictedTaken: boolean, predictedTarget: number): void {
    const entry = this.entries[tag];
    if (entry && entry.ocupada) {
      entry.branchInfo = {
        predictedTaken,
        predictedTarget
      };
    }
  }

  /**
   * Actualiza el resultado real del branch (para detectar misprediction)
   */
  updateBranchResult(tag: number, actualTaken: boolean, actualTarget: number): boolean {
    const entry = this.entries[tag];
    if (!entry || !entry.ocupada || !entry.branchInfo) return false;

    entry.branchInfo.actualTaken = actualTaken;
    entry.branchInfo.actualTarget = actualTarget;

    // Detectar misprediction
    const mispredicted =
      entry.branchInfo.predictedTaken !== actualTaken ||
      (actualTaken && entry.branchInfo.predictedTarget !== actualTarget);

    entry.branchInfo.mispredicted = mispredicted;
    return mispredicted;
  }

  /**
   * Verifica si la cabeza del ROB puede hacer commit
   * Condiciones: ocupada, finalizada
   * NOTA: No requiere válida - las excepciones (válida=false) deben llegar a RI para ser manejadas
   */
  canCommit(): boolean {
    if (this.isEmpty()) return false;
    const entry = this.entries[this.head];
    return entry.ocupada && entry.finalizada;
  }

  /**
   * Obtiene la entrada en la cabeza del ROB (próxima a retirar)
   */
  getHead(): ROBEntry | null {
    if (this.isEmpty()) return null;
    return this.entries[this.head];
  }

  /**
   * Obtiene el tag de la cabeza
   */
  getHeadTag(): number {
    return this.head;
  }

  /**
   * Obtiene el tag de la cola (próximo a asignar)
   */
  getTailTag(): number {
    return this.tail;
  }

  /**
   * Retira la instrucción en la cabeza del ROB (commit)
   * @returns La entrada retirada, o null si no puede
   */
  commit(): ROBEntry | null {
    if (!this.canCommit()) return null;

    const entry = this.entries[this.head];
    const result = { ...entry }; // Copia para retornar

    // Incrementar generación para este slot (detectar reutilización)
    this.generations[this.head]++;

    // Limpiar la entrada con la nueva generación
    this.entries[this.head] = createEmptyROBEntry(this.head, this.generations[this.head]);

    // Avanzar cabeza
    this.head = (this.head + 1) % this.size;
    this.count--;

    return result;
  }

  /**
   * Flush especulativo: descarta todas las instrucciones desde un slot
   * Se usa cuando hay misprediction de branch
   * @returns Número de instrucciones descartadas
   */
  flushFrom(fromSlot: number): number {
    let flushed = 0;

    // Recorrer desde fromSlot hasta tail (las más recientes que el branch)
    let current = fromSlot;
    while (current !== this.tail && this.entries[current].ocupada) {
      // Incrementar generación para invalidar referencias antiguas
      this.generations[current]++;
      this.entries[current] = createEmptyROBEntry(current, this.generations[current]);
      flushed++;
      current = (current + 1) % this.size;
    }

    // Actualizar tail y count
    this.tail = fromSlot;
    this.count -= flushed;

    return flushed;
  }

  /**
   * Obtiene el ROBTag actual de un slot (para crear nuevas referencias)
   */
  getROBTag(slot: number): ROBTag {
    return { slot, generation: this.generations[slot] };
  }

  /**
   * Obtiene la generación actual de un slot
   */
  getGeneration(slot: number): number {
    return this.generations[slot];
  }

  /**
   * Busca el valor de un operando en el ROB
   * @param robTag Tag con generación para verificar que no se reutilizó el slot
   * @returns { found: true, value } si está disponible, { found: false } si no
   */
  lookupValue(robTag: ROBTag): { found: boolean; value?: number; vectorValue?: Float64Array | null; stale?: boolean } {
    const entry = this.entries[robTag.slot];
    if (!entry || !entry.ocupada) {
      //console.log(`[ROB.lookupValue] tag=${robTag.slot}:${robTag.generation} NOT FOUND (entry=${!!entry}, ocupada=${entry?.ocupada})`);
      // Verificar si el slot fue reutilizado (generación diferente)
      if (entry && this.generations[robTag.slot] > robTag.generation) {
        //console.log(`[ROB.lookupValue] tag=${robTag.slot}:${robTag.generation} STALE - slot reused with gen=${this.generations[robTag.slot]}`);
        return { found: false, stale: true };
      }
      return { found: false };
    }
    // Verificar que la generación coincide
    if (entry.generation !== robTag.generation) {
      //console.log(`[ROB.lookupValue] tag=${robTag.slot}:${robTag.generation} STALE - current gen=${entry.generation}`);
      return { found: false, stale: true };
    }
    if (entry.finalizada) {
      //console.log(`[ROB.lookupValue] tag=${robTag.slot}:${robTag.generation} FOUND, value=${entry.valor}`);
      return {
        found: true,
        value: entry.valor ?? 0,
        vectorValue: entry.vectorResult
      };
    }
    //console.log(`[ROB.lookupValue] tag=${robTag.slot}:${robTag.generation} not ready (finalizada=${entry.finalizada})`);
    return { found: false };
  }

  /**
   * Busca el valor de un operando en el ROB usando solo el slot (legacy)
   * DEPRECATED: usar lookupValue con ROBTag
   */
  lookupValueBySlot(slot: number): { found: boolean; value?: number; vectorValue?: Float64Array | null } {
    const entry = this.entries[slot];
    if (!entry || !entry.ocupada) {
      return { found: false };
    }
    if (entry.finalizada) {
      return {
        found: true,
        value: entry.valor ?? 0,
        vectorValue: entry.vectorResult
      };
    }
    return { found: false };
  }

  /**
   * Obtiene todas las entradas ocupadas
   */
  getOccupiedEntries(): ROBEntry[] {
    const result: ROBEntry[] = [];
    let idx = this.head;
    for (let i = 0; i < this.count; i++) {
      if (this.entries[idx].ocupada) {
        result.push(this.entries[idx]);
      }
      idx = (idx + 1) % this.size;
    }
    return result;
  }

  /**
   * Obtiene todas las entradas
   */
  getAllEntries(): ROBEntry[] {
    return [...this.entries];
  }

  /**
   * Calcula la utilización del ROB
   */
  getUtilization(): number {
    return this.count / this.size;
  }

  /**
   * Obtiene el tamaño del ROB
   */
  getSize(): number {
    return this.size;
  }

  /**
   * Encuentra todas las entradas de stores pendientes antes de un tag dado
   * (para verificar dependencias de memoria)
   */
  getPendingStoresBefore(tag: number): ROBEntry[] {
    const stores: ROBEntry[] = [];
    let idx = this.head;

    while (idx !== tag) {
      const entry = this.entries[idx];
      if (entry.ocupada && entry.isStore && !entry.finalizada) {
        stores.push(entry);
      }
      idx = (idx + 1) % this.size;
    }

    return stores;
  }

  /**
   * Verifica si hay un store pendiente a la misma dirección
   * (para store-to-load forwarding)
   */
  hasStoreToAddress(address: number, beforeTag: number): ROBEntry | null {
    let idx = beforeTag;

    // Buscar hacia atrás hasta head
    while (idx !== this.head) {
      idx = (idx - 1 + this.size) % this.size;
      const entry = this.entries[idx];

      if (entry.ocupada && entry.isStore) {
        if (entry.storeAddress === address && entry.storeValue !== null) {
          return entry;  // Store con datos disponibles
        }
        if (entry.storeAddress === null) {
          return null;  // Store con dirección desconocida, hay que esperar
        }
      }
    }

    return null;  // No hay stores conflictivos
  }

  /**
   * Verifica si tagA viene después de tagB en el orden circular del ROB
   */
  isAfter(tagA: number, tagB: number): boolean {
    if (this.head <= this.tail) {
      // No wrapped: head...tail
      return tagA > tagB && tagA <= this.tail;
    } else {
      // Wrapped: head...size, 0...tail
      if (tagB >= this.head) {
        return tagA > tagB || tagA <= this.tail;
      } else {
        return tagA > tagB && tagA <= this.tail;
      }
    }
  }

  /**
   * Verifica si tagA está después de tagB en el orden del ROB
   */
  isTagAfter(tagA: number, tagB: number): boolean {
    // Maneja el buffer circular del ROB
    const head = this.head;
    const size = this.size;

    // Normalizar posiciones relativas a head
    const posA = (tagA - head + size) % size;
    const posB = (tagB - head + size) % size;

    return posA > posB;
  }
}
