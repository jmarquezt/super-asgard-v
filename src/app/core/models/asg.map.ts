/** Tipos de unidades funcionales disponibles (para procesador superescalar) */
export type FunctionalUnitType =
// Unidades ESCALARES
  | 'INT_ALU'    // Operaciones enteras simples (ADD, SUB, AND, OR, shifts...)
  | 'INT_MUL'    // Multiplicación entera
  | 'INT_DIV'    // División entera
  | 'FP_ADD'     // Suma/resta punto flotante
  | 'FP_MUL'     // Multiplicación punto flotante
  | 'FP_DIV'     // División punto flotante
  | 'MEM'        // Load/Store escalar (unificado)
  | 'BRANCH'     // Saltos y bifurcaciones
  // Unidades VECTORIALES
  | 'VEC_MEM'    // Load/Store vectorial (LV, SV, LVWS, SVWS, LVI, SVI)
  | 'VEC_INT'    // ALU vectorial: ADD, SUB, CMP, CVI, CVM
  | 'VEC_MUL'    // Multiplicación vectorial
  | 'VEC_DIV';   // División vectorial

export interface AsgOpcode {
  opcode: number;
  func?: number;   // Solo para Tipo-R
  type: 'R' | 'I' | 'J' | 'M' | 'B' | 'V' | 'C'; // REGISTER - IMMEDIATE - JUMP - MEMORY - BRANCH - VECTOR - CONVERSION
  target: 'R' | 'F' | 'D' | 'V'; // INT - FLOAT - DOUBLE - VECTOR,
  origin: 'R' | 'F' | 'D' | 'V'; // INT - FLOAT - DOUBLE - VECTOR --> JUMP, BRANCHES no tienen registro origin
  argNum: number;
  cycles: number;
  fuType: FunctionalUnitType;  // Tipo de unidad funcional para procesador superescalar
}
// https://www.csd.uoc.gr/~hy425/2002s/dlxmap.html
export const ASG_MAP: { [key: string]: AsgOpcode } = {
  // --- CONTROL Y SISTEMA ---
  'NOP':    { opcode: 0x00, func: 0x00, type: 'R', origin: 'R', target: 'R', argNum: 0, cycles: 1, fuType: 'INT_ALU' }, // SLL R0, R0, R0
  'RFE':    { opcode: 0x10, type: 'J', origin: 'R', target: 'R', argNum: 0, cycles: 1, fuType: 'BRANCH' },

  // --- ARITMÉTICA Y LÓGICA (R-TYPE) (Opcode 0x00, diferenciadas por campo Func) ---
  'ADD':    { opcode: 0x00, func: 0x20, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'ADDU':   { opcode: 0x00, func: 0x21, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SUB':    { opcode: 0x00, func: 0x22, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SUBU':   { opcode: 0x00, func: 0x23, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'AND':    { opcode: 0x00, func: 0x24, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'OR':     { opcode: 0x00, func: 0x25, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'XOR':    { opcode: 0x00, func: 0x26, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'MULT':   { opcode: 0x00, func: 0x0E, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 7, fuType: 'INT_MUL' }, // Extensión común
  'MULTU':  { opcode: 0x00, func: 0x16, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 7, fuType: 'INT_MUL' },
  'DIV':    { opcode: 0x00, func: 0x0F, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 24, fuType: 'INT_DIV' },
  'DIVU':   { opcode: 0x00, func: 0x17, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 24, fuType: 'INT_DIV' },
  'SLL':    { opcode: 0x00, func: 0x04, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' }, // Shift Left Logical
  'SRL':    { opcode: 0x00, func: 0x06, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' }, // Shift Right Logical
  'SRA':    { opcode: 0x00, func: 0x07, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' }, // Shift Right Arithmetic

  // --- ARITMÉTICA y LÓGICA CON INMEDIATOS TIPO-I (Inmediatos, Opcode único) ---
  'ADDI':   { opcode: 0x08, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'ADDUI':  { opcode: 0x09, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SUBI':   { opcode: 0x0A, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SUBUI':  { opcode: 0x1E, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'MULTI':  { opcode: 0x22, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 7, fuType: 'INT_MUL' }, // Opcodes de extensión
  'DIVI':   { opcode: 0x2A, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 24, fuType: 'INT_DIV' },
  'ANDI':   { opcode: 0x0C, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'ORI':    { opcode: 0x0D, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'XORI':   { opcode: 0x0E, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SLLI':   { opcode: 0x0B, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SRLI':   { opcode: 0x16, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SRAI':   { opcode: 0x17, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'LHI':    { opcode: 0x0F, type: 'I', origin: 'R', target: 'R', argNum: 2, cycles: 1, fuType: 'INT_ALU' }, // Load High Immediate

  // --- CARGA Y ALMACENAMIENTO (MEMORIA) ---
  // argNum: 0 → validación delegada a AsgMemoryInstruction.fromText (acepta 2 ó 3 args)
  'LB':     { opcode: 0x20, type: 'M', origin: 'R', target: 'R', argNum: 0, cycles: 1, fuType: 'MEM' }, // Load Byte
  'LH':     { opcode: 0x21, type: 'M', origin: 'R', target: 'R', argNum: 0, cycles: 1, fuType: 'MEM' }, // Load Halfword
  'LW':     { opcode: 0x23, type: 'M', origin: 'R', target: 'R', argNum: 0, cycles: 1, fuType: 'MEM' }, // Load Word
  'LBU':    { opcode: 0x24, type: 'M', origin: 'R', target: 'R', argNum: 0, cycles: 1, fuType: 'MEM' }, // Load Byte Unsigned
  'LHU':    { opcode: 0x25, type: 'M', origin: 'R', target: 'R', argNum: 0, cycles: 1, fuType: 'MEM' }, // Load Halfword Unsigned
  'LF':     { opcode: 0x26, type: 'M', origin: 'R', target: 'F', argNum: 0, cycles: 1, fuType: 'MEM' }, // Load Float
  'LD':     { opcode: 0x27, type: 'M', origin: 'R', target: 'D', argNum: 0, cycles: 1, fuType: 'MEM' }, // Load Double (64-bit)
  'SB':     { opcode: 0x28, type: 'M', origin: 'R', target: 'R', argNum: 0, cycles: 1, fuType: 'MEM' }, // Store Byte
  'SH':     { opcode: 0x29, type: 'M', origin: 'R', target: 'R', argNum: 0, cycles: 1, fuType: 'MEM' }, // Store Halfword
  'SW':     { opcode: 0x2B, type: 'M', origin: 'R', target: 'R', argNum: 0, cycles: 1, fuType: 'MEM' }, // Store Word
  'SF':     { opcode: 0x2E, type: 'M', origin: 'R', target: 'F', argNum: 0, cycles: 1, fuType: 'MEM' }, // Store Float
  'SD':     { opcode: 0x2F, type: 'M', origin: 'R', target: 'D', argNum: 0, cycles: 1, fuType: 'MEM' }, // Store Double (64-bit)

  // --- SALTOS CONDICIONALES (BRANCHES) ---
  'BEQZ':   { opcode: 0x04, type: 'B', origin: 'R', target: 'R', argNum: 2, cycles: 1, fuType: 'BRANCH' },
  'BNEZ':   { opcode: 0x05, type: 'B', origin: 'R', target: 'R', argNum: 2, cycles: 1, fuType: 'BRANCH' },
  'BGTZ':   { opcode: 0x14, type: 'B', origin: 'R', target: 'R', argNum: 2, cycles: 1, fuType: 'BRANCH' },
  'BLTZ':   { opcode: 0x15, type: 'B', origin: 'R', target: 'R', argNum: 2, cycles: 1, fuType: 'BRANCH' },
  // --- INSTRUCCIONES TIPO-J (Jump) ---
  'J':      { opcode: 0x02, type: 'J', origin: 'R', target: 'R', argNum: 1, cycles: 1, fuType: 'BRANCH' },
  'JAL':    { opcode: 0x03, type: 'J', origin: 'R', target: 'R', argNum: 1, cycles: 1, fuType: 'BRANCH' }, // Salto, enlace en R31
  // --- SALTOS POR REGISTRO ---
  'JR':     { opcode: 0x12, type: 'J', origin: 'R', target: 'R', argNum: 1, cycles: 1, fuType: 'BRANCH' }, // Salto a RS1
  'JALR':   { opcode: 0x13, type: 'J', origin: 'R', target: 'R', argNum: 1, cycles: 1, fuType: 'BRANCH' }, // Salto a RS1, enlace en R31
  // --- SISTEMA ---
  'TRAP':   { opcode: 0x11, type: 'J', origin: 'R', target: 'R', argNum: 1, cycles: 1, fuType: 'BRANCH' }, // trap <código>: 0=exit, 3=read, 4=write, 5=printf

  // --- COMPARACIONES (SET INSTRUCTIONS - R-TYPE) ---
  'SEQ':    { opcode: 0x00, func: 0x28, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' }, // Set if Equal
  'SNE':    { opcode: 0x00, func: 0x29, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' }, // Set if Not Equal
  'SLT':    { opcode: 0x00, func: 0x2A, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' }, // Set if Less Than
  'SGT':    { opcode: 0x00, func: 0x2B, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' }, // Set if Greater Than
  'SLE':    { opcode: 0x00, func: 0x2C, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' }, // Set if Less or Equal
  'SGE':    { opcode: 0x00, func: 0x2D, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' }, // Set if Greater or Equal

  // --- COMPARACIONES UNSIGNED (R-TYPE) ---
  'SEQU':   { opcode: 0x00, func: 0x10, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' }, // Set Equal Unsigned
  'SNEU':   { opcode: 0x00, func: 0x11, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' }, // Set Not Equal Unsigned
  'SLTU':   { opcode: 0x00, func: 0x12, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' }, // Set Less Than Unsigned
  'SGTU':   { opcode: 0x00, func: 0x13, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' }, // Set Greater Than Unsigned
  'SLEU':   { opcode: 0x00, func: 0x14, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' }, // Set Less or Equal Unsigned
  'SGEU':   { opcode: 0x00, func: 0x15, type: 'R', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' }, // Set Greater or Equal Unsigned

  // --- COMPARACIONES CON INMEDIATO (I-TYPE) ---
  'SEQI':   { opcode: 0x18, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SNEI':   { opcode: 0x19, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SLTI':   { opcode: 0x1A, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SGTI':   { opcode: 0x1B, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SLEI':   { opcode: 0x1C, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SGEI':   { opcode: 0x1D, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },

  // --- COMPARACIONES UNSIGNED CON INMEDIATO (I-TYPE) ---
  'SEQUI':  { opcode: 0x1F, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SNEUI':  { opcode: 0x3B, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SLTUI':  { opcode: 0x3C, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SGTUI':  { opcode: 0x3D, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SLEUI':  { opcode: 0x3E, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },
  'SGEUI':  { opcode: 0x3F, type: 'I', origin: 'R', target: 'R', argNum: 3, cycles: 1, fuType: 'INT_ALU' },


  // --- PUNTO FLOTANTE (Doble Precisión) ---
  'ADDD':  { opcode: 0x01, func: 0x00, type: 'R', origin: 'F', target: 'D', argNum: 3, cycles: 4, fuType: 'FP_ADD' },
  'SUBD':  { opcode: 0x01, func: 0x01, type: 'R', origin: 'F', target: 'D', argNum: 3, cycles: 4, fuType: 'FP_ADD' },
  'MULTD':  { opcode: 0x01, func: 0x02, type: 'R', origin: 'F', target: 'D', argNum: 3, cycles: 14, fuType: 'FP_MUL' },
  'DIVD':  { opcode: 0x01, func: 0x03, type: 'R', origin: 'F', target: 'D', argNum: 3, cycles: 48, fuType: 'FP_DIV' },

  // --- PUNTO FLOTANTE (Simple Precisión) ---
  'ADDF':   { opcode: 0x01, func: 0x10, type: 'R', origin: 'F', target: 'F', argNum: 3, cycles: 2, fuType: 'FP_ADD' },
  'SUBF':   { opcode: 0x01, func: 0x11, type: 'R', origin: 'F', target: 'F', argNum: 3, cycles: 2, fuType: 'FP_ADD' },
  'MULTF':  { opcode: 0x01, func: 0x12, type: 'R', origin: 'F', target: 'F', argNum: 3, cycles: 7, fuType: 'FP_MUL' },
  'DIVF':   { opcode: 0x01, func: 0x13, type: 'R', origin: 'F', target: 'F', argNum: 3, cycles: 24, fuType: 'FP_DIV' },

  // --- COMPARACIONES DOUBLE (Opcode 0x01) ---
  'EQD':   { opcode: 0x01, func: 0x18, type: 'R', origin: 'F', target: 'D', argNum: 2, cycles: 4, fuType: 'FP_ADD' },
  'NED':   { opcode: 0x01, func: 0x19, type: 'R', origin: 'F', target: 'D', argNum: 2, cycles: 4, fuType: 'FP_ADD' },
  'LTD':   { opcode: 0x01, func: 0x1A, type: 'R', origin: 'F', target: 'D', argNum: 2, cycles: 4, fuType: 'FP_ADD' },
  'GTD':   { opcode: 0x01, func: 0x1B, type: 'R', origin: 'F', target: 'D', argNum: 2, cycles: 4, fuType: 'FP_ADD' },
  'LED':   { opcode: 0x01, func: 0x1C, type: 'R', origin: 'F', target: 'D', argNum: 2, cycles: 4, fuType: 'FP_ADD' },
  'GED':   { opcode: 0x01, func: 0x1D, type: 'R', origin: 'F', target: 'D', argNum: 2, cycles: 4, fuType: 'FP_ADD' },
  'SLTD':  { opcode: 0x01, func: 0x0C, type: 'R', origin: 'F', target: 'D', argNum: 2, cycles: 4, fuType: 'FP_ADD' },
  'SGTD':  { opcode: 0x01, func: 0x0D, type: 'R', origin: 'F', target: 'D', argNum: 2, cycles: 4, fuType: 'FP_ADD' },
  'SLED':  { opcode: 0x01, func: 0x0E, type: 'R', origin: 'F', target: 'D', argNum: 2, cycles: 4, fuType: 'FP_ADD' },
  'SGED':  { opcode: 0x01, func: 0x0F, type: 'R', origin: 'F', target: 'D', argNum: 2, cycles: 4, fuType: 'FP_ADD' },

  // --- COMPARACIONES FLOAT (Simple Precisión - Opcode 0x01) ---
  'EQF':    { opcode: 0x01, func: 0x50, type: 'R', origin: 'F', target: 'F', argNum: 2, cycles: 2, fuType: 'FP_ADD' },
  'NEF':    { opcode: 0x01, func: 0x51, type: 'R', origin: 'F', target: 'F', argNum: 2, cycles: 2, fuType: 'FP_ADD' },
  'LTF':    { opcode: 0x01, func: 0x52, type: 'R', origin: 'F', target: 'F', argNum: 2, cycles: 2, fuType: 'FP_ADD' },
  'GTF':    { opcode: 0x01, func: 0x53, type: 'R', origin: 'F', target: 'F', argNum: 2, cycles: 2, fuType: 'FP_ADD' },
  'LEF':    { opcode: 0x01, func: 0x54, type: 'R', origin: 'F', target: 'F', argNum: 2, cycles: 2, fuType: 'FP_ADD' },
  'GEF':    { opcode: 0x01, func: 0x55, type: 'R', origin: 'F', target: 'F', argNum: 2, cycles: 2, fuType: 'FP_ADD' },
  // Versiones "Set" (SLTF, SGTF, etc.)
  'SLTF':   { opcode: 0x01, func: 0x56, type: 'R', origin: 'F', target: 'F', argNum: 2, cycles: 2, fuType: 'FP_ADD' },
  'SGTF':   { opcode: 0x01, func: 0x57, type: 'R', origin: 'F', target: 'F', argNum: 2, cycles: 2, fuType: 'FP_ADD' },
  'SLEF':   { opcode: 0x01, func: 0x58, type: 'R', origin: 'F', target: 'F', argNum: 2, cycles: 2, fuType: 'FP_ADD' },
  'SGEF':   { opcode: 0x01, func: 0x59, type: 'R', origin: 'F', target: 'F', argNum: 2, cycles: 2, fuType: 'FP_ADD' },

  //En ASG, las comparaciones de punto flotante escriben el resultado en un registro especial de condición (FPSR - Floating Point Status Register) en lugar de un registro de propósito general.
// --- SALTOS DE PUNTO FLOTANTE (Basados en el FP Status Bit) ---
  'BFPT':   { opcode: 0x06, type: 'B', origin: 'R', target: 'F', argNum: 1, cycles: 1, fuType: 'BRANCH' }, // Branch if Float Point True
  'BFPF':   { opcode: 0x07, type: 'B', origin: 'R', target: 'F', argNum: 1, cycles: 1, fuType: 'BRANCH' }, // Branch if Float Point False

  // --- CONVERSIONES DE PUNTO FLOTANTE (Opcode 0x01) ---
  'CVTF2D': { opcode: 0x01, func: 0x04, type: 'C', origin: 'F', target: 'D', argNum: 2, cycles: 4, fuType: 'FP_ADD' }, // Float a Double
  'CVTD2F': { opcode: 0x01, func: 0x05, type: 'C', origin: 'D', target: 'F', argNum: 2, cycles: 4, fuType: 'FP_ADD' }, // Double a Float
  'CVTF2I': { opcode: 0x01, func: 0x06, type: 'C', origin: 'F', target: 'F', argNum: 2, cycles: 4, fuType: 'FP_ADD' }, // Float a Integer
  'CVTI2F': { opcode: 0x01, func: 0x07, type: 'C', origin: 'F', target: 'F', argNum: 2, cycles: 4, fuType: 'FP_ADD' }, // Integer a Float
  'CVTD2I': { opcode: 0x01, func: 0x08, type: 'C', origin: 'D', target: 'F', argNum: 2, cycles: 4, fuType: 'FP_ADD' }, // Double a Integer
  'CVTI2D': { opcode: 0x01, func: 0x09, type: 'C', origin: 'F', target: 'D', argNum: 2, cycles: 4, fuType: 'FP_ADD' }, // Integer a Double

  // --- MOVIMIENTOS ENTRE REGISTROS (Opcode 0x00 para R-Type o 0x01 para FPU) ---
  'MOVF':   { opcode: 0x01, func: 0x14, type: 'C', origin: 'F', target: 'F', argNum: 2, cycles: 1, fuType: 'FP_ADD' }, // Copiar F1 = F2
  'MOVD':   { opcode: 0x01, func: 0x15, type: 'C', origin: 'D', target: 'D', argNum: 2, cycles: 1, fuType: 'FP_ADD' }, // Copiar D1 = D2

  // Movimientos entre bancos (Cruce de Enteros <-> FP)
  'MOVI2FP':{ opcode: 0x01, func: 0x16, type: 'C', origin: 'R', target: 'F', argNum: 2, cycles: 1, fuType: 'FP_ADD' }, // Fi = Ri (Mueve bit a bit sin convertir)
  'MOVFP2I':{ opcode: 0x01, func: 0x17, type: 'C', origin: 'F', target: 'R', argNum: 2, cycles: 1, fuType: 'FP_ADD' }, // Ri = Fi (Mueve bit a bit sin convertir)

  // Movimientos de registros de sistema/estado (Special Registers)
  'MOVI2S': { opcode: 0x00, func: 0x30, type: 'C', origin: 'R', target: 'R', argNum: 2, cycles: 1, fuType: 'INT_ALU' }, // SR = Ri
  'MOVS2I': { opcode: 0x00, func: 0x31, type: 'C', origin: 'R', target: 'R', argNum: 2, cycles: 1, fuType: 'INT_ALU' }, // Ri = SR
  'POP':    { opcode: 0x00, func: 0x34, type: 'C', origin: 'R', target: 'R', argNum: 2, cycles: 1, fuType: 'INT_ALU' }, // Ri = popcount(VM)

  // Movimientos entre registros de Punto Flotante y Sistema
  'MOVF2S': { opcode: 0x01, func: 0x32, type: 'C', origin: 'F', target: 'F', argNum: 2, cycles: 1, fuType: 'FP_ADD' }, // VM ← Fs (bits como bitmask)
  'MOVS2F': { opcode: 0x01, func: 0x33, type: 'C', origin: 'F', target: 'F', argNum: 2, cycles: 1, fuType: 'FP_ADD' }, // Fd ← VM (empaquetado como bitmask)

  // --- EXTENSIÓN VECTORIAL - Opcodes personalizados usar opcodes libres (0x30-0x3F) ---
  // --- MEMORIA VECTORIAL (Tipo-I)  ---
  'LV':     { opcode: 0x30, type: 'M', origin: 'R', target: 'V', argNum: 0, cycles: 12, fuType: 'VEC_MEM' }, // Load Vector: LV Vi, Ri
  'SV':     { opcode: 0x31, type: 'M', origin: 'R', target: 'V', argNum: 0, cycles: 12, fuType: 'VEC_MEM' }, // Store Vector: SV Ri, Vi

  // --- ARITMÉTICA VECTOR-VECTOR (Tipo-R, Opcode 0x32) ---
  'ADDV':   { opcode: 0x32, func: 0x01, type: 'V', origin: 'V', target: 'V', argNum: 3, cycles: 6, fuType: 'VEC_INT' }, // Vi = Vj + Vk
  'SUBV':   { opcode: 0x32, func: 0x02, type: 'V', origin: 'V', target: 'V', argNum: 3, cycles: 6, fuType: 'VEC_INT' }, // Vi = Vj - Vk
  'MULTV':  { opcode: 0x32, func: 0x03, type: 'V', origin: 'V', target: 'V', argNum: 3, cycles: 7, fuType: 'VEC_MUL' }, // Vi = Vj * Vk
  'DIVV':   { opcode: 0x32, func: 0x04, type: 'V', origin: 'V', target: 'V', argNum: 3, cycles: 20, fuType: 'VEC_DIV' }, // Vi = Vj / Vk

  // --- ARITMÉTICA VECTOR-ESCALAR (Tipo-R, Opcode 0x33) ---
  // Nota: Estas instrucciones usan un registro Float (Fi) como uno de los operandos
  'ADDSV':  { opcode: 0x33, func: 0x01, type: 'V', origin: 'V', target: 'V', argNum: 3, cycles: 6, fuType: 'VEC_INT' }, // Vi = Vj + Fi
  'SUBSV':  { opcode: 0x33, func: 0x02, type: 'V', origin: 'V', target: 'V', argNum: 3, cycles: 6, fuType: 'VEC_INT' }, // Vi = Vj - Fi (o Fi - Vj según orden)
  'MULTSV': { opcode: 0x33, func: 0x03, type: 'V', origin: 'V', target: 'V', argNum: 3, cycles: 7, fuType: 'VEC_MUL' }, // Vi = Vj * Fi
  'DIVSV':  { opcode: 0x33, func: 0x04, type: 'V', origin: 'V', target: 'V', argNum: 3, cycles: 20, fuType: 'VEC_DIV' }, // Vi = Vj / Fi (o Fi / Vj según orden)
  'ADDVS':  { opcode: 0x33, func: 0x05, type: 'V', origin: 'V', target: 'V', argNum: 3, cycles: 6, fuType: 'VEC_INT' }, // Vi = Vj + Fi
  'SUBVS':  { opcode: 0x33, func: 0x06, type: 'V', origin: 'V', target: 'V', argNum: 3, cycles: 6, fuType: 'VEC_INT' }, // Vi = Vj - Fi (o Fi - Vj según orden)
  'MULTVS': { opcode: 0x33, func: 0x07, type: 'V', origin: 'V', target: 'V', argNum: 3, cycles: 7, fuType: 'VEC_MUL' }, // Vi = Vj * Fi
  'DIVVS':  { opcode: 0x33, func: 0x08, type: 'V', origin: 'V', target: 'V', argNum: 3, cycles: 20, fuType: 'VEC_DIV' }, // Vi = Vj / Fi (o Fi / Vj según orden)

  // --- MEMORIA VECTORIAL AVANZADA (Opcodes 0x34 - 0x35) ---
  'LVWS':   { opcode: 0x34, type: 'M', origin: 'R', target: 'V', argNum: 3, cycles: 12, fuType: 'VEC_MEM' }, // Load Vector With Stride
  'SVWS':   { opcode: 0x35, type: 'M', origin: 'R', target: 'V', argNum: 3, cycles: 12, fuType: 'VEC_MEM' }, // Store Vector With Stride
  'LVI':    { opcode: 0x36, type: 'M', origin: 'R', target: 'V', argNum: 3, cycles: 12, fuType: 'VEC_MEM' }, // Load Vector Indexed (Gather)
  'SVI':    { opcode: 0x37, type: 'M', origin: 'R', target: 'V', argNum: 3, cycles: 12, fuType: 'VEC_MEM' }, // Store Vector Indexed (Scatter)

  // --- CONFIGURACIÓN VECTORIAL ---
  'CVI':    { opcode: 0x32, func: 0x10, type: 'R', origin: 'R', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // Create Vector Index: Vd[i] = i * Rs
  'CVM':    { opcode: 0x32, func: 0x11, type: 'R', origin: 'V', target: 'V', argNum: 0, cycles: 1, fuType: 'VEC_INT' }, // Clear Vector Mask: vectorMask[i] = 1 (todos activos)

  // --- COMPARACIONES VECTOR-VECTOR (Opcode 0x38) ---
  'SEQV':   { opcode: 0x38, func: 0x28, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[i] = (Vi[i] == Vj[i])
  'SNEV':   { opcode: 0x38, func: 0x29, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[i] = (Vi[i] != Vj[i])
  'SGTV':   { opcode: 0x38, func: 0x2A, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[i] = (Vi[i] >  Vj[i])
  'SLTV':   { opcode: 0x38, func: 0x2B, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[i] = (Vi[i] <  Vj[i])
  'SGEV':   { opcode: 0x38, func: 0x2C, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[i] = (Vi[i] >= Vj[i])
  'SLEV':   { opcode: 0x38, func: 0x2D, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[i] = (Vi[i] <= Vj[i])

  // --- COMPARACIONES ESCALAR-VECTOR (Opcode 0x39) ---
  'SEQSV':  { opcode: 0x39, func: 0x28, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[k] = (Fi == Vj[k])
  'SNESV':  { opcode: 0x39, func: 0x29, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[k] = (Fi != Vj[k])
  'SGTSV':  { opcode: 0x39, func: 0x2A, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[k] = (Fi >  Vj[k])
  'SLTSV':  { opcode: 0x39, func: 0x2B, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[k] = (Fi <  Vj[k])
  'SGESV':  { opcode: 0x39, func: 0x2C, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[k] = (Fi >= Vj[k])
  'SLESV':  { opcode: 0x39, func: 0x2D, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[k] = (Fi <= Vj[k])

  // --- COMPARACIONES VECTOR-ESCALAR (Opcode 0x3A) ---
  'SEQVS':  { opcode: 0x3A, func: 0x28, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[k] = (Vj[k] == Fi)
  'SNEVS':  { opcode: 0x3A, func: 0x29, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[k] = (Vj[k] != Fi)
  'SGTVS':  { opcode: 0x3A, func: 0x2A, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[k] = (Vj[k] >  Fi)
  'SLTVS':  { opcode: 0x3A, func: 0x2B, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[k] = (Vj[k] <  Fi)
  'SGEVS':  { opcode: 0x3A, func: 0x2C, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[k] = (Vj[k] >= Fi)
  'SLEVS':  { opcode: 0x3A, func: 0x2D, type: 'V', origin: 'V', target: 'V', argNum: 2, cycles: 1, fuType: 'VEC_INT' }, // VM[k] = (Vj[k] <= Fi)

};
