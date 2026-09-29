/**
 * Tipos y estructuras para Unidades Funcionales del procesador superescalar
 * Basado en el modelo del libro de la asignatura
 */

import { ASG_MAP, FunctionalUnitType } from '../asg.map';
import { ROBTag } from './rob';

// Re-exportar FunctionalUnitType para mantener compatibilidad con imports existentes
export type { FunctionalUnitType };

/** Clusters de unidades funcionales (para modelo RS clustered) */
export type ClusterType = 'int' | 'fp' | 'mem' | 'vec';

/** Mapeo de tipo de UF a cluster */
export const FU_TO_CLUSTER: Record<FunctionalUnitType, ClusterType> = {
  'INT_ALU': 'int',
  'INT_MUL': 'int',
  'INT_DIV': 'int',
  'BRANCH': 'int',
  'FP_ADD': 'fp',
  'FP_MUL': 'fp',
  'FP_DIV': 'fp',
  'MEM': 'mem',
  'VEC_MEM': 'vec',
  'VEC_INT': 'vec',
  'VEC_MUL': 'vec',
  'VEC_DIV': 'vec'
};

/** Estado de una Unidad Funcional */
export interface FunctionalUnitState {
  id: number;
  type: FunctionalUnitType;
  busy: boolean;
  cyclesRemaining: number;
  robTag: ROBTag | null;
  rsIndex: number | null;
}

/** Latencias por defecto de cada tipo de operación */
export const DEFAULT_FU_LATENCIES: Record<FunctionalUnitType, number> = {
  'INT_ALU': 1,
  'INT_MUL': 3,
  'INT_DIV': 20,
  'FP_ADD': 2,
  'FP_MUL': 4,
  'FP_DIV': 12,
  'MEM': 2,       // Load/Store
  'BRANCH': 1,
  // Vectoriales (latencia por elemento, se usa vecMem/vecAdd/vecMul/vecDiv del config)
  'VEC_MEM': 6,   // Load/Store
  'VEC_INT': 6,
  'VEC_MUL': 7,
  'VEC_DIV': 20
};

/**
 * Obtiene el tipo de unidad funcional para un opcode dado.
 * Para operaciones vectoriales, mapea a FUs especializadas.
 */
export function getFunctionalUnitType(opcode: string): FunctionalUnitType {
  const entry = ASG_MAP[opcode.toUpperCase()];
  return entry?.fuType ?? 'INT_ALU';
}
