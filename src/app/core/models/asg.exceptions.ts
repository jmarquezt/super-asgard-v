/** Error producido durante la compilación, con la línea fuente que lo originó. */
export class AssemblerError extends Error {
  constructor(message: string, public readonly line: number) {
    super(message);
    this.name = 'AssemblerError';
  }
}

/**
 * Códigos de excepción del procesador
 */
export enum ExceptionCode {
  // --- Excepciones aritméticas ---
  ARITHMETIC_OVERFLOW = 'ARITHMETIC_OVERFLOW',
  DIVISION_BY_ZERO = 'DIVISION_BY_ZERO',

  // --- Excepciones de punto flotante (IEEE 754) ---
  FP_DIVISION_BY_ZERO = 'FP_DIVISION_BY_ZERO',
  FP_OVERFLOW = 'FP_OVERFLOW',
  FP_UNDERFLOW = 'FP_UNDERFLOW',
  FP_INVALID_OPERATION = 'FP_INVALID_OPERATION',

  // --- Excepciones de memoria ---
  MEMORY_ALIGNMENT_ERROR = 'MEMORY_ALIGNMENT_ERROR',
  MEMORY_OUT_OF_BOUNDS = 'MEMORY_OUT_OF_BOUNDS',

  // --- Otras excepciones ---
  ILLEGAL_INSTRUCTION = 'ILLEGAL_INSTRUCTION',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Índices de la tabla de vectores de interrupción/excepción.
 * Cada entrada ocupa 4 bytes (una instrucción J).
 * Estructura de memoria:
 *   0x00-0x5F (0-95):  24 vectores (instrucciones J)
 *   0x60-0x63 (96-99): __default_handler (TRAP 6)
 *   0x64+ (100+):      Código del usuario
 */
export enum InterruptVector {
  RESET = 0,                  // 0x00 - Vector de reset
  ARITHMETIC_OVERFLOW = 1,    // 0x04
  DIVISION_BY_ZERO = 2,       // 0x08
  FP_DIVISION_BY_ZERO = 3,    // 0x0C
  FP_OVERFLOW = 4,            // 0x10
  FP_UNDERFLOW = 5,           // 0x14
  FP_INVALID_OPERATION = 6,   // 0x18
  MEMORY_ALIGNMENT_ERROR = 7, // 0x1C
  MEMORY_OUT_OF_BOUNDS = 8,   // 0x20
  ILLEGAL_INSTRUCTION = 9,    // 0x24
  TRAP_EXIT = 10,             // 0x28 - TRAP 0
  TRAP_OPEN = 11,             // 0x2C - TRAP 1
  TRAP_CLOSE = 12,            // 0x30 - TRAP 2
  TRAP_READ = 13,             // 0x34 - TRAP 3
  TRAP_WRITE = 14,            // 0x38 - TRAP 4
  TRAP_PRINTF = 15,           // 0x3C - TRAP 5
  // Reservados 16-23 (0x40-0x5C) por si es necesaria expansion
}

/** Tamaño de cada entrada de la tabla de vectores en bytes */
export const VECTOR_ENTRY_SIZE = 4;

/** Número de entradas en la tabla de vectores (24 vectores) */
export const VECTOR_TABLE_ENTRIES = 24;

/** Dirección del manejador por defecto (TRAP 6) */
export const DEFAULT_HANDLER_ADDR = VECTOR_TABLE_ENTRIES * VECTOR_ENTRY_SIZE; // 96

/** Dirección donde empieza el código de usuario */
export const CODE_BASE = DEFAULT_HANDLER_ADDR + VECTOR_ENTRY_SIZE; // 100

/** Nombres de las etiquetas de los manejadores de excepción */
export const HANDLER_LABELS: Record<InterruptVector, string> = {
  [InterruptVector.RESET]: '__reset_handler',
  [InterruptVector.ARITHMETIC_OVERFLOW]: '__overflow_handler',
  [InterruptVector.DIVISION_BY_ZERO]: '__divzero_handler',
  [InterruptVector.FP_DIVISION_BY_ZERO]: '__fp_divzero_handler',
  [InterruptVector.FP_OVERFLOW]: '__fp_overflow_handler',
  [InterruptVector.FP_UNDERFLOW]: '__fp_underflow_handler',
  [InterruptVector.FP_INVALID_OPERATION]: '__fp_invalid_handler',
  [InterruptVector.MEMORY_ALIGNMENT_ERROR]: '__mem_align_handler',
  [InterruptVector.MEMORY_OUT_OF_BOUNDS]: '__mem_bounds_handler',
  [InterruptVector.ILLEGAL_INSTRUCTION]: '__illegal_instr_handler',
  [InterruptVector.TRAP_EXIT]: '__trap_exit_handler',
  [InterruptVector.TRAP_OPEN]: '__trap_open_handler',
  [InterruptVector.TRAP_CLOSE]: '__trap_close_handler',
  [InterruptVector.TRAP_READ]: '__trap_read_handler',
  [InterruptVector.TRAP_WRITE]: '__trap_write_handler',
  [InterruptVector.TRAP_PRINTF]: '__trap_printf_handler',
};

/** Etiqueta del manejador por defecto */
export const DEFAULT_HANDLER_LABEL = '__default_handler';

/** Mapeo de ExceptionCode a InterruptVector */
export const EXCEPTION_TO_VECTOR: Record<ExceptionCode, InterruptVector> = {
  [ExceptionCode.ARITHMETIC_OVERFLOW]: InterruptVector.ARITHMETIC_OVERFLOW,
  [ExceptionCode.DIVISION_BY_ZERO]: InterruptVector.DIVISION_BY_ZERO,
  [ExceptionCode.FP_DIVISION_BY_ZERO]: InterruptVector.FP_DIVISION_BY_ZERO,
  [ExceptionCode.FP_OVERFLOW]: InterruptVector.FP_OVERFLOW,
  [ExceptionCode.FP_UNDERFLOW]: InterruptVector.FP_UNDERFLOW,
  [ExceptionCode.FP_INVALID_OPERATION]: InterruptVector.FP_INVALID_OPERATION,
  [ExceptionCode.MEMORY_ALIGNMENT_ERROR]: InterruptVector.MEMORY_ALIGNMENT_ERROR,
  [ExceptionCode.MEMORY_OUT_OF_BOUNDS]: InterruptVector.MEMORY_OUT_OF_BOUNDS,
  [ExceptionCode.ILLEGAL_INSTRUCTION]: InterruptVector.ILLEGAL_INSTRUCTION,
  [ExceptionCode.UNKNOWN]: InterruptVector.RESET, // fallback
};

