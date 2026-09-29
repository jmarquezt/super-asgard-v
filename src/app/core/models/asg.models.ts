import { AsgInstruction } from './instructions/asg.instruction';
import { FunctionalUnitType } from './asg.map';
import {ROBTag} from './superscalar/rob';
import {PredictResult} from '../services/asg.bp';

/**
 * Modelo de Tokens para manejar la compilacion en el analizador léxico
 */
export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export enum TokenType {
  DIRECTIVE = 'DIRECTIVE',     // .data, .text, .word, .space
  INSTRUCTION = 'INSTRUCTION', // ADD, SUB, LW, ADDSV...
  REGISTER = 'REGISTER',       // R0-R31, V0-V31, F0-F31
  LABEL_DEF = 'LABEL_DEF',     // LOOP:
  SYMBOL = 'SYMBOL',           // LOOP, MI_VARIABLE
  INT = 'INT',                 // #10, -5, 0xFF
  FLOAT = 'FLOAT',             // 5.5, 3.1421...
  COMMA = 'COMMA',             // ,
  PAREN_L = 'PAREN_L',         // (
  PAREN_R = 'PAREN_R',         // )
  STRING = 'STRING',           // "Hola Mundo" (para .ascii)
  EOF = 'EOF'                  // Fin de archivo
}

/** Tipos de registro arquitectónico disponibles */
export type RegisterType = 'R' | 'F' | 'V' | 'FPBC' | 'VLR' | 'VM';

/** Pipeline procesador segmentado / no segmentado */
export interface Pipeline {
  IF: AsgInstruction | null;  // Instruction Fetch
  ID: AsgInstruction | null;  // Instruction Decode
  EX: AsgInstruction | null;  // Execute
  MEM: AsgInstruction | null; // Memory Access
  WB: AsgInstruction | null;  // Write Back
  [key: string]: any; // <--- Esta línea permite el acceso por string como pipeline[stage]
}

/**
 * Interfaces para el logger de la aplicación
 */
export type LogEntryType = 'info' | 'warning' | 'error' | 'success';

export interface LogEntry {
  cycle: number;
  message: string;
  type: LogEntryType;
  timestamp: number;
}

/** Interfaz de solicitud de lectura de stdin — emitida por TRAP 3 con fd=0. */
export interface TrapStdinRequest {
  /** Dirección del buffer en memoria de datos donde se escribirá la entrada */
  bufAddr: number;
  /** Número máximo de bytes a leer */
  maxBytes: number;
  /** ID de la instrucción que generó la solicitud */
  instrId: number;
}

/**
 * Entrada del timeline (común para los tres procesadores)
 */
export interface TimelineEntry {
  /** ID único de la instrucción */
  id: number;
  /** PC de la instrucción */
  pc: number;
  /** Instrucción como texto */
  raw: string;
  /** Etapa en cada ciclo */
  stages: Record<number, string>;
  /** Instrucción completada */
  completed: boolean;
  /** Flag para saber si la instruccion es vectorial */
  isVector?: boolean;
  /** Instrucción descartada por misprediction */
  flushed?: boolean;
}

/**
 * Modelos y estructuras de datos del procesador superescalar
 * Basado en el modelo del libro de la asignatura
 *
 * Pipeline de 6 etapas: IF → ID → II → EX → WR → RI
 */


/**
 * Estado de una instrucción en el pipeline superescalar. Estados segun los descritos en el libro de la asignatura
 */
export type InstructionState =
  | 'FETCHED'     // Leída en IF
  | 'DECODED'     // Decodificada en ID, pendiente de distribución
  | 'DISPATCHED'  // Distribuida: en RS, esperando operandos
  | 'ISSUED'      // Emitida: enviada a UF
  | 'EXECUTING'   // En ejecución en UF
  | 'FINISHED'    // Finalizada: resultado en ROB, esperando commit
  | 'COMMITTED'   // Terminada: registros arquitectónicos actualizados
  | 'RETIRED'     // Retirada: (solo stores) memoria actualizada
  | 'FLUSHED';    // Descartada por misprediction de branch


/** Interfaz para guardar los operandos resueltos durante ID (antes de actualizar RRF) */
export interface ResolvedOperands {
  v1: number | null;
  q1: ROBTag | null;
  v1Ready: boolean;
  v2: number | null;
  q2: ROBTag | null;
  v2Ready: boolean;
  vl: number | null;
  qVL: ROBTag | null;
  vlReady: boolean;
}

/** Interfaz para la instrucción en vuelo con su estado y datos tanto para operaciones como para UI */
export interface InFlightInstruction {
  id: number;
  instr: AsgInstruction;
  pc: number;
  state: InstructionState;
  robTag: ROBTag | null;
  rsIndex: number | null;
  fuId: number | null;
  cycleIF: number;
  cycleID: number | null;
  cycleII: number | null;  // Ciclo en que entra a II
  cycleII_D: number | null;  // Dispatch - distribución a RS
  cycleII_S: number | null;  // Supervision - esperando operandos
  cycleII_E: number | null;  // Emision - emisión a UF
  cycleEX: number | null;
  cycleWR: number | null;
  cycleRI: number | null;
  speculative: boolean; //flag para saber si es especulativa
  flushed: boolean;
  // Información de predicción de branch
  isBranch: boolean;
  prediction: PredictResult | null;
  branchResolved: boolean;
  actualTaken: boolean | null;
  actualTarget: number | null;
  // Operandos resueltos en ID (antes de actualizar RRF)
  resolvedOperands: ResolvedOperands | null;
  // Operandos finales capturados cuando se emite a UF
  execV1: number;
  execV2: number;
  // VLR capturado cuando se emite a UF
  execVL: number;
  // Ciclos restantes de ejecución (para mostrar en timeline)
  cyclesRemainingEX: number;
  // Vector chaining: elemento actual y resultado parcial
  currentElement: number;
  vectorResult: Float64Array | null;
  // Fases de ejecución vectorial
  vectorPhase: 'init' | 'processing' | 'end' | null;
  cyclesRemainingInPhase: number;
  // Delay inicial y/o final de instrucciones vectoriales, realmente es el tiempo de arranque / finalizacion de la unidad vectorial correspondiente
  initDelay: number;
  endDelay: number;
  // Label de fase para visualización en timeline
  executionPhaseLabel: string | null;
  // Solapamiento de init: una instrucción está pendiente (y consume sus ciclos de inicio) en UF mientras otra termina
  isPendingOnFU: boolean;
  // Parámetros TRAP 3-4-5 leídos en EX (para usar en etapa RI)
  trapParams: { fdAddr: number, fd: number; bufAddr: number; maxBytes: number } | null;
}

/** Interfaz para el buffer de fetch de instrucciones */
export interface FetchBuffer {
  instructions: AsgInstruction[];
  pcs: number[];
}

/**
 * Interfaz para las estadísticas del procesador superescalar
 */
export interface SuperscalarStats {
  /** Ciclos totales */
  cyclesTotal: number;
  /** Instrucciones capturadas en etapa IF */
  instructionsFetched: number;
  /** Instrucciones confirmadas en etapa RI */
  instructionsCommitted: number;
  /** IPC - Instructions Per Cycle */
  ipc: number;
  // Stalls por tipo
  /** IF bloqueado (buffer lleno) */
  fetchStalls: number;
  /** ID bloqueado (ROB lleno) */
  robFullStalls: number;
  /** II bloqueado (RS llenas) */
  rsFullStalls: number;
  /** UFs ocupadas */
  structuralStalls: number;
  // Branch y predicciones
  /** Predicciones de salto realizadas */
  branchPredictions: number;
  /** Predicciones incorrectas */
  branchMispredictions: number;
  /** Precisión de predicción */
  branchAccuracy: number;
  /** Instrucciones descartadas por misprediction */
  flushedInstructions: number;
  // Utilización
  /** Utilización media de RS */
  rsUtilization: number;
  /** Utilización media de ROB */
  robUtilization: number;
  /** Utilización media de UFs */
  fuUtilization: Record<FunctionalUnitType, number>;
}

/**
 * Crea estadísticas iniciales (vacías)
 */
export function createEmptyStats(): SuperscalarStats {
  return {
    cyclesTotal: 0,
    instructionsFetched: 0,
    instructionsCommitted: 0,
    ipc: 0,
    fetchStalls: 0,
    robFullStalls: 0,
    rsFullStalls: 0,
    structuralStalls: 0,
    branchPredictions: 0,
    branchMispredictions: 0,
    branchAccuracy: 0,
    flushedInstructions: 0,
    rsUtilization: 0,
    robUtilization: 0,
    fuUtilization: {
      'INT_ALU': 0,
      'INT_MUL': 0,
      'INT_DIV': 0,
      'FP_ADD': 0,
      'FP_MUL': 0,
      'FP_DIV': 0,
      'MEM': 0,
      'BRANCH': 0,
      'VEC_MEM': 0,
      'VEC_INT': 0,
      'VEC_MUL': 0,
      'VEC_DIV': 0
    }
  };
}

/**
 * Etiquetas de etapas para el timeline
 */
export const STAGE_LABELS = {
  IF: 'IF',
  ID: 'ID',
  II_D: 'II-D',  // Distribución
  II_S: 'II-S',  // Supervisión (esperando)
  II_E: 'II-E',  // Emisión
  EX: 'EX',
  WR: 'WR',
  RI: 'RI',
  STALL: 'ST',
  FLUSH: 'FL'
} as const;
