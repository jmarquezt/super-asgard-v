/**
 * Reservation Stations (RS) - 3 modelos de organización
 * Basado en el modelo del libro de la asignatura
 *
 * Modelos disponibles:
 * 1. CENTRALIZADO: Una única RS compartida por todas las UF
 * 2. DISTRIBUIDO: Una RS por cada tipo de UF
 * 3. CLUSTERED: RS agrupadas por clusters (INT, FP, MEM, VEC)
 *
 * La etapa II tiene 3 sub-fases:
 * - Distribución: instrucción entra a RS
 * - Supervisión: espera operandos (escucha datos publicados desde el CDB)
 * - Emisión: operandos listos → envía a UF
 */

import { FunctionalUnitType, ClusterType, FU_TO_CLUSTER } from './fu';
import { ROBTag, robTagEquals } from './rob';
import { CDBResult } from './cdb';
import { SuperscalarConfig, RSType } from '../asg.config';
import { AsgInstruction } from '../instructions/asg.instruction';

/**
 * Entrada de Estación de Reserva
 * Campos base según el modelo del libro de la asignatura
 * Extension de campos extras para facilitar funcionalidad y calculos
 */
export interface RSEntry {
  // --- Campos de estado ---
  /** O - Entrada ocupada/en uso */
  ocupada: boolean;
  /** L - Lista para emitir (todos los operandos disponibles) */
  lista: boolean;

  // --- Campos de operación ---
  /** Código de operación */
  opcode: string;
  /** Tipo de UF requerida */
  fuType: FunctionalUnitType;

  // --- Operando 1 ---
  /** V1 - Valor del operando 1 (null si esperando) */
  v1: number | null;
  /** Q1 - Tag ROB del productor con generación (null si v1 ya disponible) */
  q1: ROBTag | null;

  // --- Operando 2 ---
  /** V2 - Valor del operando 2 (null si esperando) */
  v2: number | null;
  /** Q2 - Tag ROB del productor con generación (null si v2 ya disponible) */
  q2: ROBTag | null;

  // --- VLR ---
  /** VVL - Valor de VLR resuelto vía renombrado (null si esperando) */
  vVL: number | null;
  /** QVL - Tag ROB del MOVI2S productor de VLR (null si ya disponible) */
  qVL: ROBTag | null;

  // --- Destino ---
  /** Tag ROB donde se escribirá el resultado */
  destino: ROBTag;

  // --- Metadata ---
  /** Referencia a la instrucción original */
  instrRef: AsgInstruction;
  /** Ciclo en que entró a la RS (para política FIFO/antigüedad) */
  cycleDispatched: number;

  // --- Para operaciones de memoria ---
  /** Dirección base (para loads/stores) */
  addressBase: number | null;
  /** Offset/inmediato */
  addressOffset: number;
  /** Dirección efectiva calculada */
  effectiveAddress: number | null;
}

/**
 * Crea una entrada RS vacía
 */
export function createEmptyRSEntry(): RSEntry {
  return {
    ocupada: false,
    lista: false,
    opcode: '',
    fuType: 'INT_ALU',
    v1: null,
    q1: null,
    v2: null,
    q2: null,
    vVL: null,
    qVL: null,
    destino: { slot: -1, generation: 0 },
    instrRef: null as unknown as AsgInstruction,
    cycleDispatched: 0,
    addressBase: null,
    addressOffset: 0,
    effectiveAddress: null
  };
}

/**
 * Interfaz común para todos los modelos de RS
 */
export interface IReservationStations {
  /** Tipo de organización */
  readonly type: RSType;

  /** Resetea todas las RS */
  reset(): void;

  /** Verifica si hay espacio para una instrucción del tipo dado */
  hasSpace(fuType: FunctionalUnitType): boolean;

  /** Cuenta entradas libres para un tipo de UF */
  freeEntries(fuType: FunctionalUnitType): number;

  /** Distribuye una instrucción a una RS (sub-fase Distribución) */
  dispatch(entry: RSEntry, fuType: FunctionalUnitType): number;

  /** Actualiza operandos con resultado del CDB (sub-fase Supervisión) */
  updateFromCDB(result: CDBResult): void;

  /** Obtiene instrucciones listas para emitir (sub-fase Emisión) */
  getReadyToIssue(fuType: FunctionalUnitType, limit: number): RSEntry[];

  /** Libera una entrada de RS (después de emitir) */
  release(index: number): void;

  /** Libera todas las entradas con un tag ROB específico */
  releaseByRobTag(robTag: ROBTag): void;

  /** Flush especulativo: libera entradas DESPUÉS de fromSlot en orden circular */
  flushFrom(fromSlot: number, robHead: number, robSize: number): number;

  /** Obtiene todas las entradas ocupadas (para visualización) */
  getAllOccupied(): RSEntry[];

  /** Calcula utilización media */
  getUtilization(): number;
}


/**
 * RS Centralizada: una única cola compartida para todas las UF
 * + Mejor utilización del espacio
 * - Más complejo el hardware de selección
 */
export class CentralizedRS implements IReservationStations {
  readonly type: RSType = 'centralized';
  private entries: RSEntry[];
  private readonly size: number;

  constructor(size: number) {
    this.size = size;
    this.entries = Array(size).fill(null).map(() => createEmptyRSEntry());
  }

  reset(): void {
    this.entries = Array(this.size).fill(null).map(() => createEmptyRSEntry());
  }

  hasSpace(_fuType: FunctionalUnitType): boolean {
    return this.entries.some(e => !e.ocupada);
  }

  freeEntries(_fuType: FunctionalUnitType): number {
    return this.entries.filter(e => !e.ocupada).length;
  }

  dispatch(entry: RSEntry, _fuType: FunctionalUnitType): number {
    const idx = this.entries.findIndex(e => !e.ocupada);
    if (idx === -1) return -1;

    this.entries[idx] = { ...entry, ocupada: true };
    this.updateReady(idx);
    return idx;
  }

  private updateReady(idx: number): void {
    const entry = this.entries[idx];
    entry.lista = (entry.q1 === null) && (entry.q2 === null)  && (entry.qVL === null);
  }

  updateFromCDB(result: CDBResult): void {
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (!entry.ocupada) continue;

      let updated = false;

      if (robTagEquals(entry.q1, result.robTag)) {
        entry.v1 = result.value;
        entry.q1 = null;
        updated = true;
      }

      if (robTagEquals(entry.q2, result.robTag)) {
        entry.v2 = result.value;
        entry.q2 = null;
        updated = true;
      }

      if (robTagEquals(entry.qVL, result.robTag)) {
        entry.vVL = result.value;
        entry.qVL = null;
        updated = true;
      }

      if (updated)
        this.updateReady(i);
    }
  }

  getReadyToIssue(fuType: FunctionalUnitType, limit: number): RSEntry[] {
    const ready: RSEntry[] = [];

    // Ordenar por antigüedad (cycleDispatched)
    const candidates = this.entries
      .filter(e => e.ocupada && e.lista && e.fuType === fuType)
      .sort((a, b) => a.cycleDispatched - b.cycleDispatched);

    for (const entry of candidates) {
      if (ready.length >= limit) break;
      ready.push(entry);
    }

    return ready;
  }

  release(index: number): void {
    if (index >= 0 && index < this.entries.length)
      this.entries[index] = createEmptyRSEntry();
  }

  releaseByRobTag(robTag: ROBTag): void {
    for (let i = 0; i < this.entries.length; i++) {
      if (this.entries[i].ocupada && robTagEquals(this.entries[i].destino, robTag))
        this.entries[i] = createEmptyRSEntry();
    }
  }

  flushFrom(fromSlot: number, robHead: number, robSize: number): number {
    let flushed = 0;
    const posFrom = (fromSlot - robHead + robSize) % robSize;

    for (let i = 0; i < this.entries.length; i++) {
      if (this.entries[i].ocupada) {
        const posEntry = (this.entries[i].destino.slot - robHead + robSize) % robSize;
        if (posEntry >= posFrom) {
          this.entries[i] = createEmptyRSEntry();
          flushed++;
        }
      }
    }
    return flushed;
  }

  getAllOccupied(): RSEntry[] {
    return this.entries.filter(e => e.ocupada);
  }

  getUtilization(): number {
    return this.entries.filter(e => e.ocupada).length / this.size;
  }
}

/**
 * RS Distribuida: una RS por cada tipo de UF
 * + Hardware de selección más simple
 * + Menor latencia de emisión
 * - Puede tener desbalance de utilización
 */
export class DistributedRS implements IReservationStations {
  readonly type: RSType = 'distributed';
  private stations: Map<FunctionalUnitType, RSEntry[]>;
  private readonly sizePerUnit: number;

  private static readonly FU_TYPES: FunctionalUnitType[] = [
    'INT_ALU', 'INT_MUL', 'INT_DIV',
    'FP_ADD', 'FP_MUL', 'FP_DIV',
    'MEM', 'BRANCH',
    'VEC_MEM', 'VEC_INT',
    'VEC_MUL', 'VEC_DIV'
  ];

  constructor(sizePerUnit: number) {
    this.sizePerUnit = sizePerUnit;
    this.stations = new Map();

    for (const fuType of DistributedRS.FU_TYPES) {
      this.stations.set(fuType, Array(sizePerUnit).fill(null).map(() => createEmptyRSEntry()));
    }
  }

  reset(): void {
    for (const fuType of DistributedRS.FU_TYPES) {
      this.stations.set(fuType, Array(this.sizePerUnit).fill(null).map(() => createEmptyRSEntry()));
    }
  }

  private getStation(fuType: FunctionalUnitType): RSEntry[] {
    return this.stations.get(fuType) ?? [];
  }

  hasSpace(fuType: FunctionalUnitType): boolean {
    return this.getStation(fuType).some(e => !e.ocupada);
  }

  freeEntries(fuType: FunctionalUnitType): number {
    return this.getStation(fuType).filter(e => !e.ocupada).length;
  }

  dispatch(entry: RSEntry, fuType: FunctionalUnitType): number {
    const station = this.getStation(fuType);
    const localIdx = station.findIndex(e => !e.ocupada);
    if (localIdx === -1) return -1;

    station[localIdx] = { ...entry, ocupada: true };
    this.updateReady(station, localIdx);

    // Retornar índice global (fuType * sizePerUnit + localIdx)
    const fuIndex = DistributedRS.FU_TYPES.indexOf(fuType);
    return fuIndex * this.sizePerUnit + localIdx;
  }

  private updateReady(station: RSEntry[], idx: number): void {
    const entry = station[idx];
    entry.lista = (entry.q1 === null) && (entry.q2 === null) && (entry.qVL === null);
  }

  updateFromCDB(result: CDBResult): void {
    //console.log(`[RS.updateFromCDB] Processing CDB result: robTag=${result.robTag.slot}:${result.robTag.generation}, value=${result.value}`);
    for (const [fuType, station] of this.stations.entries()) {
      for (let i = 0; i < station.length; i++) {
        const entry = station[i];
        if (!entry.ocupada) continue;

        let updated = false;

        if (robTagEquals(entry.q1, result.robTag)) {
          //console.log(`[RS.updateFromCDB] Updating ${entry.opcode} (destino=${entry.destino.slot}:${entry.destino.generation}): v1=${result.value}, q1=null`);
          entry.v1 = result.value;
          entry.q1 = null;
          updated = true;
        }

        if (robTagEquals(entry.q2, result.robTag)) {
          //console.log(`[RS.updateFromCDB] Updating ${entry.opcode} (destino=${entry.destino.slot}:${entry.destino.generation}): v2=${result.value}, q2=null`);
          entry.v2 = result.value;
          entry.q2 = null;
          updated = true;
        }

        if (robTagEquals(entry.qVL, result.robTag)) {
          //console.log(`[RS.updateFromCDB] Updating ${entry.opcode} (destino=${entry.destino.slot}:${entry.destino.generation}): vVL=${result.value}, qVL=null`);
          entry.vVL = result.value;
          entry.qVL = null;
          updated = true;
        }

        if (updated) {
          this.updateReady(station, i);
          //console.log(`[RS.updateFromCDB] After updateReady: ${entry.opcode} lista=${entry.lista} (q1=${entry.q1}, q2=${entry.q2})`);
        }
      }
    }
  }

  getReadyToIssue(fuType: FunctionalUnitType, limit: number): RSEntry[] {
    const station = this.getStation(fuType);
    return station
      .filter(e => e.ocupada && e.lista)
      .sort((a, b) => a.cycleDispatched - b.cycleDispatched)
      .slice(0, limit);
  }

  release(globalIndex: number): void {
    const fuIndex = Math.floor(globalIndex / this.sizePerUnit);
    const localIdx = globalIndex % this.sizePerUnit;

    const fuType = DistributedRS.FU_TYPES[fuIndex];
    const station = this.getStation(fuType);

    if (localIdx >= 0 && localIdx < station.length)
      station[localIdx] = createEmptyRSEntry();
  }

  releaseByRobTag(robTag: ROBTag): void {
    for (const station of this.stations.values()) {
      for (let i = 0; i < station.length; i++) {
        if (station[i].ocupada && robTagEquals(station[i].destino, robTag))
          station[i] = createEmptyRSEntry();
      }
    }
  }

  flushFrom(fromSlot: number, robHead: number, robSize: number): number {
    let flushed = 0;
    const posFrom = (fromSlot - robHead + robSize) % robSize;

    for (const station of this.stations.values()) {
      for (let i = 0; i < station.length; i++) {
        if (station[i].ocupada) {
          const posEntry = (station[i].destino.slot - robHead + robSize) % robSize;
          if (posEntry >= posFrom) {
            station[i] = createEmptyRSEntry();
            flushed++;
          }
        }
      }
    }
    return flushed;
  }

  getAllOccupied(): RSEntry[] {
    const result: RSEntry[] = [];
    for (const station of this.stations.values()) {
      result.push(...station.filter(e => e.ocupada));
    }
    return result;
  }

  getUtilization(): number {
    let total = 0;
    let occupied = 0;

    for (const station of this.stations.values()) {
      total += station.length;
      occupied += station.filter(e => e.ocupada).length;
    }

    return total > 0 ? occupied / total : 0;
  }

  /**
   * Obtiene estadísticas por tipo de UF
   */
  getUtilizationByType(): Map<FunctionalUnitType, number> {
    const result = new Map<FunctionalUnitType, number>();

    for (const [fuType, station] of this.stations.entries()) {
      const util = station.filter(e => e.ocupada).length / station.length;
      result.set(fuType, util);
    }

    return result;
  }
}

/**
 * RS Clustered: RS agrupadas por cluster de UF relacionadas
 * Clusters: INT (ALU+MUL+DIV+BRANCH), FP (ADD+MUL+DIV), MEM (LOAD+STORE), VEC
 * + Balance entre centralizado y distribuido
 * + Agrupa UFs que comparten operandos
 */
export class ClusteredRS implements IReservationStations {
  readonly type: RSType = 'clustered';
  private clusters: Map<ClusterType, RSEntry[]>;
  private readonly clusterSizes: Record<ClusterType, number>;

  private static readonly CLUSTER_TYPES: ClusterType[] = ['int', 'fp', 'mem', 'vec'];

  constructor(sizes: { intCluster: number; fpCluster: number; memCluster: number; vecCluster: number }) {
    this.clusterSizes = {
      int: sizes.intCluster,
      fp: sizes.fpCluster,
      mem: sizes.memCluster,
      vec: sizes.vecCluster
    };
    this.clusters = new Map();
    this.initClusters();
  }

  private initClusters(): void {
    for (const cluster of ClusteredRS.CLUSTER_TYPES) {
      const size = this.clusterSizes[cluster];
      this.clusters.set(cluster, Array(size).fill(null).map(() => createEmptyRSEntry()));
    }
  }

  reset(): void {
    this.initClusters();
  }

  private getCluster(fuType: FunctionalUnitType): RSEntry[] {
    const clusterType = FU_TO_CLUSTER[fuType];
    return this.clusters.get(clusterType) ?? [];
  }

  private getClusterType(fuType: FunctionalUnitType): ClusterType {
    return FU_TO_CLUSTER[fuType];
  }

  hasSpace(fuType: FunctionalUnitType): boolean {
    return this.getCluster(fuType).some(e => !e.ocupada);
  }

  freeEntries(fuType: FunctionalUnitType): number {
    return this.getCluster(fuType).filter(e => !e.ocupada).length;
  }

  dispatch(entry: RSEntry, fuType: FunctionalUnitType): number {
    const cluster = this.getCluster(fuType);
    const localIdx = cluster.findIndex(e => !e.ocupada);
    if (localIdx === -1) return -1;

    cluster[localIdx] = { ...entry, ocupada: true };
    this.updateReady(cluster, localIdx);

    // Índice global: clusterIndex * maxClusterSize + localIdx
    const clusterType = this.getClusterType(fuType);
    const clusterIndex = ClusteredRS.CLUSTER_TYPES.indexOf(clusterType);
    const maxSize = Math.max(...Object.values(this.clusterSizes));
    return clusterIndex * maxSize + localIdx;
  }

  private updateReady(cluster: RSEntry[], idx: number): void {
    const entry = cluster[idx];
    entry.lista = (entry.q1 === null) && (entry.q2 === null) && (entry.qVL === null);
  }

  updateFromCDB(result: CDBResult): void {
    for (const cluster of this.clusters.values()) {
      for (let i = 0; i < cluster.length; i++) {
        const entry = cluster[i];
        if (!entry.ocupada) continue;

        let updated = false;

        if (robTagEquals(entry.q1, result.robTag)) {
          entry.v1 = result.value;
          entry.q1 = null;
          updated = true;
        }

        if (robTagEquals(entry.q2, result.robTag)) {
          entry.v2 = result.value;
          entry.q2 = null;
          updated = true;
        }

        if (robTagEquals(entry.qVL, result.robTag)) {
          entry.vVL = result.value;
          entry.qVL = null;
          updated = true;
        }

        if (updated)
          this.updateReady(cluster, i);
      }
    }
  }

  getReadyToIssue(fuType: FunctionalUnitType, limit: number): RSEntry[] {
    const cluster = this.getCluster(fuType);
    return cluster
      .filter(e => e.ocupada && e.lista && e.fuType === fuType)
      .sort((a, b) => a.cycleDispatched - b.cycleDispatched)
      .slice(0, limit);
  }

  release(globalIndex: number): void {
    const maxSize = Math.max(...Object.values(this.clusterSizes));
    const clusterIndex = Math.floor(globalIndex / maxSize);
    const localIdx = globalIndex % maxSize;

    const clusterType = ClusteredRS.CLUSTER_TYPES[clusterIndex];
    const cluster = this.clusters.get(clusterType);

    if (cluster && localIdx >= 0 && localIdx < cluster.length)
      cluster[localIdx] = createEmptyRSEntry();
  }

  releaseByRobTag(robTag: ROBTag): void {
    for (const cluster of this.clusters.values()) {
      for (let i = 0; i < cluster.length; i++) {
        if (cluster[i].ocupada && robTagEquals(cluster[i].destino, robTag))
          cluster[i] = createEmptyRSEntry();
      }
    }
  }

  flushFrom(fromSlot: number, robHead: number, robSize: number): number {
    let flushed = 0;
    const posFrom = (fromSlot - robHead + robSize) % robSize;

    for (const cluster of this.clusters.values()) {
      for (let i = 0; i < cluster.length; i++) {
        if (cluster[i].ocupada) {
          const posEntry = (cluster[i].destino.slot - robHead + robSize) % robSize;
          if (posEntry >= posFrom) {
            cluster[i] = createEmptyRSEntry();
            flushed++;
          }
        }
      }
    }
    return flushed;
  }

  getAllOccupied(): RSEntry[] {
    const result: RSEntry[] = [];
    for (const cluster of this.clusters.values()) {
      result.push(...cluster.filter(e => e.ocupada));
    }
    return result;
  }

  getUtilization(): number {
    let total = 0;
    let occupied = 0;

    for (const cluster of this.clusters.values()) {
      total += cluster.length;
      occupied += cluster.filter(e => e.ocupada).length;
    }

    return total > 0 ? occupied / total : 0;
  }

  /**
   * Obtiene estadísticas por cluster
   */
  getUtilizationByCluster(): Map<ClusterType, number> {
    const result = new Map<ClusterType, number>();

    for (const [clusterType, cluster] of this.clusters.entries()) {
      const util = cluster.filter(e => e.ocupada).length / cluster.length;
      result.set(clusterType, util);
    }

    return result;
  }
}

/**
 * Crea el modelo de RS según la configuración
 */
export function createReservationStations(config: SuperscalarConfig): IReservationStations {
  switch (config.rsType) {
    case 'centralized':
      return new CentralizedRS(config.rsCentralizedSize);

    case 'distributed':
      return new DistributedRS(config.rsPerUnitSize);

    case 'clustered':
      return new ClusteredRS(config.rsClusterSizes);

    default:
      // Por defecto: distribuido
      return new DistributedRS(config.rsPerUnitSize);
  }
}
