import {AsgInstruction} from './instructions/asg.instruction';
import {Injectable, signal} from '@angular/core';

export type BranchPredictionStrategy = 'none' | 'always-taken' | 'btfn' | '1-bit' | '2-bit' | 'gshare' | 'hybrid' | 'ras';

/**
 * Latencias (en ciclos) de cada unidad funcional del procesador.
 * Todos los valores son ≥ 1.
 */
export interface LatencyConfig {
  intMul:  number;  // MULT, MULTU, MULTI       — por defecto 7
  intDiv:  number;  // DIV,  DIVU,  DIVI        — por defecto 24
  fpAdd:   number;  // ADDF, SUBF               — por defecto 2
  fpMul:   number;  // MULTF                    — por defecto 7
  fpDiv:   number;  // DIVF                     — por defecto 24
  fpAddD:  number;  // ADDD, SUBD               — por defecto 4
  fpMulD:  number;  // MULTD                    — por defecto 14
  fpDivD:  number;  // DIVD                     — por defecto 48
  vecMem:  number;  // LV, SV, LVWS, SVWS, LVI, SVI — por defecto 12
  vecAdd:  number;  // ADDV, SUBV, ADDSV, SUBSV, ADDVS, SUBVS — por defecto 6
  vecMul:  number;  // MULTV, MULTSV, MULTVS    — por defecto 7
  vecDiv:  number;  // DIVV, DIVSV, DIVVS       — por defecto 20
  vecCmp:  number;  // SEQV/SNEV/.../SLEVS (comparaciones vectoriales) — por defecto 1
}

export const DEFAULT_LATENCIES: LatencyConfig = {
  intMul:  7,
  intDiv:  24,
  fpAdd:   2,
  fpMul:   7,
  fpDiv:   24,
  fpAddD:  4,
  fpMulD:  14,
  fpDivD:  48,
  vecMem:  12,
  vecAdd:  6,
  vecMul:  7,
  vecDiv:  20,
  vecCmp:  1,
};

/** Las 18 variantes de comparación vectorial (vector-vector, escalar-vector, vector-escalar). */
export const VECTOR_COMPARISON_OPCODES = [
  'SEQV', 'SNEV', 'SGTV', 'SLTV', 'SGEV', 'SLEV',
  'SEQSV', 'SNESV', 'SGTSV', 'SLTSV', 'SGESV', 'SLESV',
  'SEQVS', 'SNEVS', 'SGTVS', 'SLTVS', 'SGEVS', 'SLEVS',
] as const;

/**
 * Devuelve la latencia configurada para un opcode dado,
 * o `undefined` si no hay override (usa la del mapa por defecto).
 */
export function getConfiguredLatency(opcode: string, cfg: LatencyConfig): number | undefined {
  switch (opcode) {
    case 'MULT':  case 'MULTU': case 'MULTI':  return cfg.intMul;
    case 'DIV':   case 'DIVU':  case 'DIVI':   return cfg.intDiv;
    case 'ADDF':  case 'SUBF':                 return cfg.fpAdd;
    case 'MULTF':                              return cfg.fpMul;
    case 'DIVF':                               return cfg.fpDiv;
    case 'ADDD':  case 'SUBD':                 return cfg.fpAddD;
    case 'MULTD':                              return cfg.fpMulD;
    case 'DIVD':                               return cfg.fpDivD;
    case 'LV':    case 'SV':    case 'LVWS':
    case 'SVWS':  case 'LVI':   case 'SVI':    return cfg.vecMem;
    case 'ADDV':  case 'SUBV':  case 'ADDSV':
    case 'SUBSV': case 'ADDVS': case 'SUBVS':  return cfg.vecAdd;
    case 'MULTV': case 'MULTSV': case 'MULTVS': return cfg.vecMul;
    case 'DIVV':  case 'DIVSV': case 'DIVVS':  return cfg.vecDiv;
    default:
      if ((VECTOR_COMPARISON_OPCODES as readonly string[]).includes(opcode)) return cfg.vecCmp;
      return undefined;
  }
}

/**
 * Interfaz para definir la estructura de configuración de la máquina.
 */
export interface AsgConfig {
  processorType: ProcessorType;
  memorySize: number;
  enableForwarding: boolean;
  enableVectorChaining: boolean;
  enableBranchDelaySlot: boolean;
  aluLanes: number;
  memLanes: number;
  mvl: number; // Maximum Vector Length (tamaño de los vectores)
  branchPredictionStrategy: BranchPredictionStrategy;
  ghrBits: number;
  loggingEnabled: boolean;
  logLevel: LogLevel;
  timelineMode: 'live' | 'on-finish' | 'disabled';
  latencies: LatencyConfig;

  // --- Configuración del procesador superescalar ---
  superscalar: SuperscalarConfig;
}

/** Nivel de log: define qué tipos se registran.
 *  error     → solo 'error'
 *  warning   → 'error' + 'warning'
 *  relevant  → 'error' + 'success'
 *  debug      → todo (incluye 'info' y 'success')
 */
export type LogLevel = 'error' | 'warning' | 'relevant' | 'debug';

/**
 * Tipos de procesadores disponibles
 */
export type ProcessorType = 'pipelined' | 'non-pipelined' | 'superscalar';


/**
 * Configuración del procesador superescalar
 * Basado en el modelo del libro "Ingeniería de Computadores II" - UNED
 */

/** Tipo de organización de Estaciones de Reserva */
export type RSType = 'centralized' | 'distributed' | 'clustered';

/** Ancho de emisión (instrucciones por ciclo) */
export type IssueWidth = 1 | 2 | 4 | 8;

/** Configuración completa del procesador superescalar */
export interface SuperscalarConfig {
  // --- Tipo de Estaciones de Reserva ---
  rsType: RSType;

  // --- Ancho de emisión ---
  issueWidth: IssueWidth;

  // --- Reorder Buffer ---
  robSize: number;

  // --- Registros físicos (para renombramiento) ---
  physicalRegsInt: number;
  physicalRegsFloat: number;
  physicalRegsVector: number;

  // --- Tamaños de RS según modelo ---
  rsCentralizedSize: number;
  rsPerUnitSize: number;
  rsClusterSizes: {
    intCluster: number;
    fpCluster: number;
    memCluster: number;
    vecCluster: number;
  };

  // --- Número de Unidades Funcionales ESCALARES ---
  intALUs: number;
  intMulUnits: number;
  intDivUnits: number;
  fpAddUnits: number;
  fpMulUnits: number;
  fpDivUnits: number;
  memUnits: number;          // Load/Store unificado
  branchUnits: number;

  // --- Número de Unidades Funcionales VECTORIALES ---
  vecMemUnits: number;       // Load/Store vectorial (LV, SV, LVWS, SVWS, LVI, SVI)
  vecIntUnits: number;       // ALU vectorial: ADD, SUB, CMP, CVI, CVM
  vecMulUnits: number;       // Multiplicación vectorial
  vecDivUnits: number;       // División vectorial

  // --- Common Data Bus ---
  cdbWidth: number;

  // --- Optimizaciones vectoriales ---
  /** Permite solapar el init de una instrucción vectorial con el processing de la anterior en la misma FU */
  enableVectorInitOverlap: boolean;
}

/** Configuración por defecto del procesador superescalar */
export const DEFAULT_SUPERSCALAR_CONFIG: SuperscalarConfig = {
  // Estaciones de reserva distribuidas por defecto
  rsType: 'distributed',

  // Ancho de emisión: 4 instrucciones por ciclo
  issueWidth: 4,

  // ROB de 64 entradas
  robSize: 64,

  // Registros físicos
  physicalRegsInt: 64,
  physicalRegsFloat: 64,
  physicalRegsVector: 16,

  // Tamaños de RS
  rsCentralizedSize: 32,
  rsPerUnitSize: 4,
  rsClusterSizes: {
    intCluster: 8,
    fpCluster: 8,
    memCluster: 8,
    vecCluster: 4
  },

  // Unidades funcionales escalares
  intALUs: 2,
  intMulUnits: 1,
  intDivUnits: 1,
  fpAddUnits: 1,
  fpMulUnits: 1,
  fpDivUnits: 1,
  memUnits: 2,        // Load/Store unificado
  branchUnits: 1,

  // Unidades funcionales vectoriales
  vecMemUnits: 1,     // Load/Store vectorial unificado
  vecIntUnits: 1,
  vecMulUnits: 1,
  vecDivUnits: 1,

  // CDB con 4 buses
  cdbWidth: 4,

  // Optimizaciones vectoriales habilitadas por defecto
  enableVectorInitOverlap: true
};

/** Presets de configuración para diferentes escenarios */
export const SUPERSCALAR_PRESETS: Record<string, Partial<SuperscalarConfig>> = {
  minimal: {
    issueWidth: 2,
    robSize: 32,
    rsType: 'centralized',
    rsCentralizedSize: 16,
    intALUs: 1,
    memUnits: 1,
    cdbWidth: 2
  },
  balanced: {
    issueWidth: 4,
    robSize: 64,
    rsType: 'distributed',
    rsPerUnitSize: 4,
    intALUs: 2,
    memUnits: 2,
    cdbWidth: 4
  },
  aggressive: {
    issueWidth: 8,
    robSize: 128,
    rsType: 'clustered',
    rsClusterSizes: {
      intCluster: 16,
      fpCluster: 12,
      memCluster: 16,
      vecCluster: 8
    },
    intALUs: 4,
    memUnits: 3,
    cdbWidth: 8
  }
};
