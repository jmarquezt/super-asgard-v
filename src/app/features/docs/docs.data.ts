export interface DocOperand {
  name: string;
  description: string;
}

export interface DocEntry {
  id: string;
  name: string;
  syntax: string;
  description: string;
  operands?: DocOperand[];
  example?: string;
  notes?: string;
}

export interface DocCategory {
  id: string;
  label: string;
  icon: string;
  entries: DocEntry[];
}

export interface DocSection {
  id: string;
  label: string;
  icon: string;
  categories: DocCategory[];
}

//Categorías individuales

const CAT_INT_ALU: DocCategory = {
  id: 'int-alu',
  label: 'DOCS.CATEGORIES.INT_ALU',
  icon: 'calculate',
  entries: [
    {
      id: 'add',  name: 'ADD',
      syntax: 'ADD Rd, Rs1, Rs2',
      description: 'DOCS.INT_ALU.ADD.DESCRIPTION',
      operands: [
        { name: 'Rd',  description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2' },
      ],
      example: 'DOCS.INT_ALU.ADD.EXAMPLE',
    },
    {
      id: 'addu', name: 'ADDU',
      syntax: 'ADDU Rd, Rs1, Rs2',
      description: 'DOCS.INT_ALU.ADDU.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.INT_ALU.ADDU.EXAMPLE',
    },
    {
      id: 'sub', name: 'SUB',
      syntax: 'SUB Rd, Rs1, Rs2',
      description: 'DOCS.INT_ALU.SUB.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.INT_ALU.SUB.EXAMPLE',
    },
    {
      id: 'subu', name: 'SUBU',
      syntax: 'SUBU Rd, Rs1, Rs2',
      description: 'DOCS.INT_ALU.SUBU.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.INT_ALU.SUBU.EXAMPLE',
    },
    {
      id: 'and', name: 'AND',
      syntax: 'AND Rd, Rs1, Rs2',
      description: 'DOCS.INT_ALU.AND.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.INT_ALU.AND.EXAMPLE',
    },
    {
      id: 'or', name: 'OR',
      syntax: 'OR Rd, Rs1, Rs2',
      description: 'DOCS.INT_ALU.OR.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.INT_ALU.OR.EXAMPLE',
    },
    {
      id: 'xor', name: 'XOR',
      syntax: 'XOR Rd, Rs1, Rs2',
      description: 'DOCS.INT_ALU.XOR.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.INT_ALU.XOR.EXAMPLE',
    },
    {
      id: 'mult', name: 'MULT',
      syntax: 'MULT Rd, Rs1, Rs2',
      description: 'DOCS.INT_ALU.MULT.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.INT_ALU.MULT.EXAMPLE',
      notes: 'DOCS.INT_ALU.MULT.NOTES',
    },
    {
      id: 'multu', name: 'MULTU',
      syntax: 'MULTU Rd, Rs1, Rs2',
      description: 'DOCS.INT_ALU.MULTU.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.INT_ALU.MULTU.EXAMPLE',
      notes: 'DOCS.INT_ALU.MULTU.NOTES',
    },
    {
      id: 'div', name: 'DIV',
      syntax: 'DIV Rd, Rs1, Rs2',
      description: 'DOCS.INT_ALU.DIV.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.INT_ALU.DIV.EXAMPLE',
      notes: 'DOCS.INT_ALU.DIV.NOTES',
    },
    {
      id: 'divu', name: 'DIVU',
      syntax: 'DIVU Rd, Rs1, Rs2',
      description: 'DOCS.INT_ALU.DIVU.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.INT_ALU.DIVU.EXAMPLE',
      notes: 'DOCS.INT_ALU.DIVU.NOTES',
    },
    {
      id: 'sll', name: 'SLL',
      syntax: 'SLL Rd, Rs1, Rs2',
      description: 'DOCS.INT_ALU.SLL.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_SHIFT' },
      ],
      example: 'DOCS.INT_ALU.SLL.EXAMPLE',
    },
    {
      id: 'srl', name: 'SRL',
      syntax: 'SRL Rd, Rs1, Rs2',
      description: 'DOCS.INT_ALU.SRL.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_SHIFT' },
      ],
      example: 'DOCS.INT_ALU.SRL.EXAMPLE',
    },
    {
      id: 'sra', name: 'SRA',
      syntax: 'SRA Rd, Rs1, Rs2',
      description: 'DOCS.INT_ALU.SRA.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_SHIFT' },
      ],
      example: 'DOCS.INT_ALU.SRA.EXAMPLE',
    },
    {
      id: 'nop', name: 'NOP',
      syntax: 'NOP',
      description: 'DOCS.INT_ALU.NOP.DESCRIPTION',
      example: 'DOCS.INT_ALU.NOP.EXAMPLE',
      notes: 'DOCS.INT_ALU.NOP.NOTES',
    },
  ],
};

const CAT_INT_IMM: DocCategory = {
  id: 'int-imm',
  label: 'DOCS.CATEGORIES.INT_IMM',
  icon: 'tag',
  entries: [
    {
      id: 'addi', name: 'ADDI',
      syntax: 'ADDI Rd, Rs1, #imm',
      description: 'DOCS.INT_IMM.ADDI.DESCRIPTION',
      operands: [
        { name: 'Rd',   description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1',  description: 'DOCS.OPERANDS.RS_SRC' },
        { name: '#imm', description: 'DOCS.OPERANDS.IMM_SIGNED' },
      ],
      example: 'DOCS.INT_IMM.ADDI.EXAMPLE',
      notes: 'DOCS.INT_IMM.ADDI.NOTES',
    },
    {
      id: 'addui', name: 'ADDUI',
      syntax: 'ADDUI Rd, Rs1, #imm',
      description: 'DOCS.INT_IMM.ADDUI.DESCRIPTION',
      operands: [
        { name: 'Rd',   description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1',  description: 'DOCS.OPERANDS.RS_SRC' },
        { name: '#imm', description: 'DOCS.OPERANDS.IMM_UNSIGNED' },
      ],
      example: 'DOCS.INT_IMM.ADDUI.EXAMPLE',
      notes: 'DOCS.INT_IMM.ADDUI.NOTES',
    },
    {
      id: 'subi', name: 'SUBI',
      syntax: 'SUBI Rd, Rs1, #imm',
      description: 'DOCS.INT_IMM.SUBI.DESCRIPTION',
      operands: [
        { name: 'Rd',   description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1',  description: 'DOCS.OPERANDS.RS_SRC' },
        { name: '#imm', description: 'DOCS.OPERANDS.IMM_SIGNED_ALT' },
      ],
      example: 'DOCS.INT_IMM.SUBI.EXAMPLE',
      notes: 'DOCS.INT_IMM.SUBI.NOTES',
    },
    {
      id: 'subui', name: 'SUBUI',
      syntax: 'SUBUI Rd, Rs1, #imm',
      description: 'DOCS.INT_IMM.SUBUI.DESCRIPTION',
      operands: [
        { name: 'Rd',   description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1',  description: 'DOCS.OPERANDS.RS_SRC' },
        { name: '#imm', description: 'DOCS.OPERANDS.IMM_UNSIGNED' },
      ],
      example: 'DOCS.INT_IMM.SUBUI.EXAMPLE',
      notes: 'DOCS.INT_IMM.SUBUI.NOTES',
    },
    {
      id: 'multi', name: 'MULTI',
      syntax: 'MULTI Rd, Rs1, #imm',
      description: 'DOCS.INT_IMM.MULTI.DESCRIPTION',
      operands: [
        { name: 'Rd',   description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1',  description: 'DOCS.OPERANDS.RS_SRC' },
        { name: '#imm', description: 'DOCS.OPERANDS.IMM_SIGNED_BASIC' },
      ],
      example: 'DOCS.INT_IMM.MULTI.EXAMPLE',
      notes: 'DOCS.INT_IMM.MULTI.NOTES',
    },
    {
      id: 'divi', name: 'DIVI',
      syntax: 'DIVI Rd, Rs1, #imm',
      description: 'DOCS.INT_IMM.DIVI.DESCRIPTION',
      operands: [
        { name: 'Rd',   description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1',  description: 'DOCS.OPERANDS.RS_SRC' },
        { name: '#imm', description: 'DOCS.OPERANDS.IMM_SIGNED_BASIC' },
      ],
      example: 'DOCS.INT_IMM.DIVI.EXAMPLE',
      notes: 'DOCS.INT_IMM.DIVI.NOTES',
    },
    {
      id: 'andi', name: 'ANDI',
      syntax: 'ANDI Rd, Rs1, #imm',
      description: 'DOCS.INT_IMM.ANDI.DESCRIPTION',
      operands: [
        { name: 'Rd',   description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1',  description: 'DOCS.OPERANDS.RS_SRC' },
        { name: '#imm', description: 'DOCS.OPERANDS.IMM_16BIT' },
      ],
      example: 'DOCS.INT_IMM.ANDI.EXAMPLE',
      notes: 'DOCS.INT_IMM.ANDI.NOTES',
    },
    {
      id: 'ori', name: 'ORI',
      syntax: 'ORI Rd, Rs1, #imm',
      description: 'DOCS.INT_IMM.ORI.DESCRIPTION',
      operands: [
        { name: 'Rd',   description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1',  description: 'DOCS.OPERANDS.RS_SRC' },
        { name: '#imm', description: 'DOCS.OPERANDS.IMM_16BIT_HEX' },
      ],
      example: 'DOCS.INT_IMM.ORI.EXAMPLE',
      notes: 'DOCS.INT_IMM.ORI.NOTES',
    },
    {
      id: 'xori', name: 'XORI',
      syntax: 'XORI Rd, Rs1, #imm',
      description: 'DOCS.INT_IMM.XORI.DESCRIPTION',
      operands: [
        { name: 'Rd',   description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1',  description: 'DOCS.OPERANDS.RS_SRC' },
        { name: '#imm', description: 'DOCS.OPERANDS.IMM_16BIT_ALT' },
      ],
      example: 'DOCS.INT_IMM.XORI.EXAMPLE',
      notes: 'DOCS.INT_IMM.XORI.NOTES',
    },
    {
      id: 'slli', name: 'SLLI',
      syntax: 'SLLI Rd, Rs1, #imm',
      description: 'DOCS.INT_IMM.SLLI.DESCRIPTION',
      operands: [
        { name: 'Rd',   description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1',  description: 'DOCS.OPERANDS.RS_SRC' },
        { name: '#imm', description: 'DOCS.OPERANDS.SHIFT_AMOUNT' },
      ],
      example: 'DOCS.INT_IMM.SLLI.EXAMPLE',
      notes: 'DOCS.INT_IMM.SLLI.NOTES',
    },
    {
      id: 'srli', name: 'SRLI',
      syntax: 'SRLI Rd, Rs1, #imm',
      description: 'DOCS.INT_IMM.SRLI.DESCRIPTION',
      operands: [
        { name: 'Rd',   description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1',  description: 'DOCS.OPERANDS.RS_SRC' },
        { name: '#imm', description: 'DOCS.OPERANDS.SHIFT_AMOUNT_BASIC' },
      ],
      example: 'DOCS.INT_IMM.SRLI.EXAMPLE',
      notes: 'DOCS.INT_IMM.SRLI.NOTES',
    },
    {
      id: 'srai', name: 'SRAI',
      syntax: 'SRAI Rd, Rs1, #imm',
      description: 'DOCS.INT_IMM.SRAI.DESCRIPTION',
      operands: [
        { name: 'Rd',   description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1',  description: 'DOCS.OPERANDS.RS_SRC' },
        { name: '#imm', description: 'DOCS.OPERANDS.SHIFT_AMOUNT_BASIC' },
      ],
      example: 'DOCS.INT_IMM.SRAI.EXAMPLE',
      notes: 'DOCS.INT_IMM.SRAI.NOTES',
    },
    {
      id: 'lhi', name: 'LHI',
      syntax: 'LHI Rd, #imm',
      description: 'DOCS.INT_IMM.LHI.DESCRIPTION',
      operands: [
        { name: 'Rd',   description: 'DOCS.OPERANDS.RD' },
        { name: '#imm', description: 'DOCS.OPERANDS.IMM_HIGH' },
      ],
      example: 'DOCS.INT_IMM.LHI.EXAMPLE',
      notes: 'DOCS.INT_IMM.LHI.NOTES',
    },
  ],
};

const CAT_MEMORY: DocCategory = {
  id: 'memory',
  label: 'DOCS.CATEGORIES.MEMORY',
  icon: 'memory',
  entries: [
    {
      id: 'lb', name: 'LB',
      syntax: 'LB Rd, LABEL          ; direct (implicit base R0)\nLB Rd, offset(Rs)       ; indirect (numeric offset)',
      description: 'DOCS.MEMORY.LB.DESCRIPTION',
      operands: [
        { name: 'Rd',       description: 'DOCS.OPERANDS.RD' },
        { name: 'LABEL', description: 'DOCS.OPERANDS.LABEL_DATA' },
        { name: 'offset',   description: 'DOCS.OPERANDS.OFFSET_NUMERIC' },
        { name: 'Rs',       description: 'DOCS.OPERANDS.RS_BASE' },
      ],
      example: 'DOCS.MEMORY.LB.EXAMPLE',
      notes: 'DOCS.MEMORY.LB.NOTES',
    },
    {
      id: 'lbu', name: 'LBU',
      syntax: 'LBU Rd, LABEL\nLBU Rd, offset(Rs)',
      description: 'DOCS.MEMORY.LBU.DESCRIPTION',
      operands: [
        { name: 'Rd',       description: 'DOCS.OPERANDS.RD' },
        { name: 'LABEL', description: 'DOCS.OPERANDS.LABEL_DATA' },
        { name: 'offset',   description: 'DOCS.OPERANDS.OFFSET_NUMERIC' },
        { name: 'Rs',       description: 'DOCS.OPERANDS.RS_BASE' },
      ],
      example: 'DOCS.MEMORY.LBU.EXAMPLE',
      notes: 'DOCS.MEMORY.LBU.NOTES',
    },
    {
      id: 'lh', name: 'LH',
      syntax: 'LH Rd, LABEL\nLH Rd, offset(Rs)',
      description: 'DOCS.MEMORY.LH.DESCRIPTION',
      operands: [
        { name: 'Rd',       description: 'DOCS.OPERANDS.RD' },
        { name: 'LABEL', description: 'DOCS.OPERANDS.LABEL_DATA' },
        { name: 'offset',   description: 'DOCS.OPERANDS.OFFSET_NUMERIC' },
        { name: 'Rs',       description: 'DOCS.OPERANDS.RS_BASE' },
      ],
      example: 'DOCS.MEMORY.LH.EXAMPLE',
      notes: 'DOCS.MEMORY.ALIGN_2',
    },
    {
      id: 'lhu', name: 'LHU',
      syntax: 'LHU Rd, LABEL\nLHU Rd, offset(Rs)',
      description: 'DOCS.MEMORY.LHU.DESCRIPTION',
      operands: [
        { name: 'Rd',       description: 'DOCS.OPERANDS.RD' },
        { name: 'LABEL', description: 'DOCS.OPERANDS.LABEL_DATA' },
        { name: 'offset',   description: 'DOCS.OPERANDS.OFFSET_NUMERIC' },
        { name: 'Rs',       description: 'DOCS.OPERANDS.RS_BASE' },
      ],
      example: 'DOCS.MEMORY.LHU.EXAMPLE',
      notes: 'DOCS.MEMORY.ALIGN_2',
    },
    {
      id: 'lw', name: 'LW',
      syntax: 'LW Rd, LABEL\nLW Rd, offset(Rs)',
      description: 'DOCS.MEMORY.LW.DESCRIPTION',
      operands: [
        { name: 'Rd',       description: 'DOCS.OPERANDS.RD' },
        { name: 'LABEL', description: 'DOCS.OPERANDS.LABEL_DATA' },
        { name: 'offset',   description: 'DOCS.OPERANDS.OFFSET_NO_LABEL' },
        { name: 'Rs',       description: 'DOCS.OPERANDS.RS_BASE' },
      ],
      example: 'DOCS.MEMORY.LW.EXAMPLE',
      notes: 'DOCS.MEMORY.ALIGN_4',
    },
    {
      id: 'lf', name: 'LF',
      syntax: 'LF Fd, LABEL\nLF Fd, offset(Rs)',
      description: 'DOCS.MEMORY.LF.DESCRIPTION',
      operands: [
        { name: 'Fd',       description: 'DOCS.OPERANDS.FD_ANY' },
        { name: 'LABEL', description: 'DOCS.OPERANDS.LABEL_DATA' },
        { name: 'offset',   description: 'DOCS.OPERANDS.OFFSET_NUMERIC' },
        { name: 'Rs',       description: 'DOCS.OPERANDS.RS_BASE' },
      ],
      example: 'DOCS.MEMORY.LF.EXAMPLE',
      notes: 'DOCS.MEMORY.LF.NOTES',
    },
    {
      id: 'ld', name: 'LD',
      syntax: 'LD Fd, LABEL\nLD Fd, offset(Rs)',
      description: 'DOCS.MEMORY.LD.DESCRIPTION',
      operands: [
        { name: 'Fd',       description: 'DOCS.OPERANDS.FD_EVEN' },
        { name: 'LABEL', description: 'DOCS.OPERANDS.LABEL_DATA_SHORT' },
        { name: 'offset',   description: 'DOCS.OPERANDS.OFFSET_INDIRECT' },
        { name: 'Rs',       description: 'DOCS.OPERANDS.RS_BASE' },
      ],
      example: 'DOCS.MEMORY.LD.EXAMPLE',
      notes: 'DOCS.MEMORY.LD.NOTES',
    },
    {
      id: 'sb', name: 'SB',
      syntax: 'SB LABEL, Rs2\nSB offset(Rs1), Rs2',
      description: 'DOCS.MEMORY.SB.DESCRIPTION',
      operands: [
        { name: 'LABEL', description: 'DOCS.OPERANDS.LABEL_DATA_SHORT' },
        { name: 'offset',   description: 'DOCS.OPERANDS.OFFSET_NUMERIC' },
        { name: 'Rs1',      description: 'DOCS.OPERANDS.RS_BASE' },
        { name: 'Rs2',      description: 'DOCS.OPERANDS.RS_SRC' },
      ],
      example: 'DOCS.MEMORY.SB.EXAMPLE',
      notes: 'DOCS.MEMORY.SB.NOTES',
    },
    {
      id: 'sh', name: 'SH',
      syntax: 'SH LABEL, Rs2\nSH offset(Rs1), Rs2',
      description: 'DOCS.MEMORY.SH.DESCRIPTION',
      operands: [
        { name: 'LABEL', description: 'DOCS.OPERANDS.LABEL_DATA_SHORT' },
        { name: 'offset',   description: 'DOCS.OPERANDS.OFFSET_NUMERIC' },
        { name: 'Rs1',      description: 'DOCS.OPERANDS.RS_BASE' },
        { name: 'Rs2',      description: 'DOCS.OPERANDS.RS_SRC' },
      ],
      example: 'DOCS.MEMORY.SH.EXAMPLE',
      notes: 'DOCS.MEMORY.ALIGN_2',
    },
    {
      id: 'sw', name: 'SW',
      syntax: 'SW LABEL, Rs2\nSW offset(Rs1), Rs2',
      description: 'DOCS.MEMORY.SW.DESCRIPTION',
      operands: [
        { name: 'LABEL', description: 'DOCS.OPERANDS.LABEL_DATA_SHORT' },
        { name: 'offset',   description: 'DOCS.OPERANDS.OFFSET_NO_LABEL' },
        { name: 'Rs1',      description: 'DOCS.OPERANDS.RS_BASE' },
        { name: 'Rs2',      description: 'DOCS.OPERANDS.RS_SRC' },
      ],
      example: 'DOCS.MEMORY.SW.EXAMPLE',
      notes: 'DOCS.MEMORY.ALIGN_4',
    },
    {
      id: 'sf', name: 'SF',
      syntax: 'SF LABEL, Fd\nSF offset(Rs), Fd',
      description: 'DOCS.MEMORY.SF.DESCRIPTION',
      operands: [
        { name: 'LABEL', description: 'DOCS.OPERANDS.LABEL_DATA_SHORT' },
        { name: 'offset',   description: 'DOCS.OPERANDS.OFFSET_INDIRECT' },
        { name: 'Rs',       description: 'DOCS.OPERANDS.RS_BASE' },
        { name: 'Fd',       description: 'DOCS.OPERANDS.FD_SRC_ANY' },
      ],
      example: 'DOCS.MEMORY.SF.EXAMPLE',
      notes: 'DOCS.MEMORY.ALIGN_4',
    },
    {
      id: 'sd', name: 'SD',
      syntax: 'SD LABEL, Fd\nSD offset(Rs), Fd',
      description: 'DOCS.MEMORY.SD.DESCRIPTION',
      operands: [
        { name: 'LABEL', description: 'DOCS.OPERANDS.LABEL_DATA_SHORT' },
        { name: 'offset',   description: 'DOCS.OPERANDS.OFFSET_INDIRECT' },
        { name: 'Rs',       description: 'DOCS.OPERANDS.RS_BASE' },
        { name: 'Fd',       description: 'DOCS.OPERANDS.FD_EVEN_SRC' },
      ],
      example: 'DOCS.MEMORY.SD.EXAMPLE',
      notes: 'DOCS.MEMORY.SD.NOTES',
    },
  ],
};

const CAT_BRANCHES: DocCategory = {
  id: 'branches',
  label: 'DOCS.CATEGORIES.BRANCHES',
  icon: 'fork_right',
  entries: [
    {
      id: 'beqz', name: 'BEQZ',
      syntax: 'BEQZ Rs, label',
      description: 'DOCS.BRANCHES.BEQZ.DESCRIPTION',
      operands: [
        { name: 'Rs',       description: 'DOCS.OPERANDS.RS_COMPARE_ZERO' },
        { name: 'label', description: 'DOCS.OPERANDS.LABEL_TEXT_FULL' },
      ],
      example: 'DOCS.BRANCHES.BEQZ.EXAMPLE',
      notes: 'DOCS.BRANCHES.BEQZ.NOTES',
    },
    {
      id: 'bnez', name: 'BNEZ',
      syntax: 'BNEZ Rs, label',
      description: 'DOCS.BRANCHES.BNEZ.DESCRIPTION',
      operands: [
        { name: 'Rs',       description: 'DOCS.OPERANDS.RS_COMPARE_ZERO' },
        { name: 'label', description: 'DOCS.OPERANDS.LABEL_TEXT' },
      ],
      example: 'DOCS.BRANCHES.BNEZ.EXAMPLE',
      notes: 'DOCS.BRANCHES.TEXT_ONLY',
    },
    {
      id: 'bgtz', name: 'BGTZ',
      syntax: 'BGTZ Rs, label',
      description: 'DOCS.BRANCHES.BGTZ.DESCRIPTION',
      operands: [
        { name: 'Rs',       description: 'DOCS.OPERANDS.RS_COMPARE_ZERO' },
        { name: 'label', description: 'DOCS.OPERANDS.LABEL_TEXT' },
      ],
      example: 'DOCS.BRANCHES.BGTZ.EXAMPLE',
      notes: 'DOCS.BRANCHES.TEXT_ONLY',
    },
    {
      id: 'bltz', name: 'BLTZ',
      syntax: 'BLTZ Rs, label',
      description: 'DOCS.BRANCHES.BLTZ.DESCRIPTION',
      operands: [
        { name: 'Rs',       description: 'DOCS.OPERANDS.RS_COMPARE_ZERO' },
        { name: 'label', description: 'DOCS.OPERANDS.LABEL_TEXT' },
      ],
      example: 'DOCS.BRANCHES.BLTZ.EXAMPLE',
      notes: 'DOCS.BRANCHES.TEXT_ONLY',
    },
    {
      id: 'bfpt', name: 'BFPT',
      syntax: 'BFPT label',
      description: 'DOCS.BRANCHES.BFPT.DESCRIPTION',
      operands: [
        { name: 'label', description: 'DOCS.OPERANDS.LABEL_TEXT' },
      ],
      example: 'DOCS.BRANCHES.BFPT.EXAMPLE',
      notes: 'DOCS.BRANCHES.BFPT.NOTES',
    },
    {
      id: 'bfpf', name: 'BFPF',
      syntax: 'BFPF label',
      description: 'DOCS.BRANCHES.BFPF.DESCRIPTION',
      operands: [
        { name: 'label', description: 'DOCS.OPERANDS.LABEL_TEXT' },
      ],
      example: 'DOCS.BRANCHES.BFPF.EXAMPLE',
      notes: 'DOCS.BRANCHES.TEXT_ONLY',
    },
    {
      id: 'j', name: 'J',
      syntax: 'J label',
      description: 'DOCS.BRANCHES.J.DESCRIPTION',
      operands: [
        { name: 'label', description: 'DOCS.OPERANDS.LABEL_TEXT_NO_DATA' },
      ],
      example: 'DOCS.BRANCHES.J.EXAMPLE',
      notes: 'DOCS.BRANCHES.J.NOTES',
    },
    {
      id: 'jal', name: 'JAL',
      syntax: 'JAL label',
      description: 'DOCS.BRANCHES.JAL.DESCRIPTION',
      operands: [
        { name: 'label', description: 'DOCS.OPERANDS.LABEL_TEXT_NO_DATA' },
      ],
      example: 'DOCS.BRANCHES.JAL.EXAMPLE',
      notes: 'DOCS.BRANCHES.JAL.NOTES',
    },
    {
      id: 'jr', name: 'JR',
      syntax: 'JR Rs',
      description: 'DOCS.BRANCHES.JR.DESCRIPTION',
      operands: [
        { name: 'Rs', description: 'DOCS.OPERANDS.RS_TARGET_ADDR' },
      ],
      example: 'DOCS.BRANCHES.JR.EXAMPLE',
      notes: 'DOCS.BRANCHES.JR.NOTES',
    },
    {
      id: 'jalr', name: 'JALR',
      syntax: 'JALR Rd, Rs',
      description: 'DOCS.BRANCHES.JALR.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD_RETURN' },
        { name: 'Rs', description: 'DOCS.OPERANDS.RS_TARGET_ADDR' },
      ],
      example: 'DOCS.BRANCHES.JALR.EXAMPLE',
      notes: 'DOCS.BRANCHES.JALR.NOTES',
    },
  ],
};

const CAT_COMPARE: DocCategory = {
  id: 'compare',
  label: 'DOCS.CATEGORIES.COMPARE',
  icon: 'compare_arrows',
  entries: [
    {
      id: 'seq', name: 'SEQ / SEQU',
      syntax: 'SEQ Rd, Rs1, Rs2\nSEQU Rd, Rs1, Rs2',
      description: 'DOCS.COMPARE.SEQ.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.COMPARE.SEQ.EXAMPLE',
    },
    {
      id: 'sne', name: 'SNE / SNEU',
      syntax: 'SNE Rd, Rs1, Rs2',
      description: 'DOCS.COMPARE.SNE.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.COMPARE.SNE.EXAMPLE',
    },
    {
      id: 'slt', name: 'SLT / SLTU',
      syntax: 'SLT Rd, Rs1, Rs2',
      description: 'DOCS.COMPARE.SLT.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.COMPARE.SLT.EXAMPLE',
    },
    {
      id: 'sgt', name: 'SGT / SGTU',
      syntax: 'SGT Rd, Rs1, Rs2',
      description: 'DOCS.COMPARE.SGT.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.COMPARE.SGT.EXAMPLE',
    },
    {
      id: 'sle', name: 'SLE / SLEU',
      syntax: 'SLE Rd, Rs1, Rs2',
      description: 'DOCS.COMPARE.SLE.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.COMPARE.SLE.EXAMPLE',
    },
    {
      id: 'sge', name: 'SGE / SGEU',
      syntax: 'SGE Rd, Rs1, Rs2',
      description: 'DOCS.COMPARE.SGE.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS1_ALT' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS2_ALT' },
      ],
      example: 'DOCS.COMPARE.SGE.EXAMPLE',
    },
    {
      id: 'seqi', name: 'SEQI / SEQUI',
      syntax: 'SEQI Rd, Rs1, #imm',
      description: 'DOCS.COMPARE.SEQI.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS_SRC' },
        { name: '#imm', description: 'DOCS.OPERANDS.IMM_SIGNED_BASIC' },
      ],
      example: 'DOCS.COMPARE.SEQI.EXAMPLE',
    },
    {
      id: 'slti', name: 'SLTI / SLTUI / SGTI / SGTUI / SLEI / SLEUI / SGEI / SGEUI / SNEI / SNEUI',
      syntax: 'SLTI Rd, Rs1, #imm',
      description: 'DOCS.COMPARE.SLTI.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS_SRC' },
        { name: '#imm', description: 'DOCS.OPERANDS.IMM_SIGNED_BASIC' },
      ],
      example: 'DOCS.COMPARE.SLTI.EXAMPLE',
    },
  ],
};

const CAT_FLOAT: DocCategory = {
  id: 'float',
  label: 'DOCS.CATEGORIES.FLOAT',
  icon: 'functions',
  entries: [
    {
      id: 'addf', name: 'ADDF / SUBF / MULTF / DIVF',
      syntax: 'ADDF Fd, Fs1, Fs2',
      description: 'DOCS.FLOAT.ADDF.DESCRIPTION',
      operands: [
        { name: 'Fd',  description: 'DOCS.OPERANDS.FD_ANY' },
        { name: 'Fs1', description: 'DOCS.OPERANDS.FS1_SP' },
        { name: 'Fs2', description: 'DOCS.OPERANDS.FS2_SP' },
      ],
      example: 'DOCS.FLOAT.ADDF.EXAMPLE',
    },
    {
      id: 'addd', name: 'ADDD / SUBD / MULTD / DIVD',
      syntax: 'ADDD Fd, Fs1, Fs2',
      description: 'DOCS.FLOAT.ADDD.DESCRIPTION',
      operands: [
        { name: 'Fd',  description: 'DOCS.OPERANDS.FD_EVEN_DEST' },
        { name: 'Fs1', description: 'DOCS.OPERANDS.FS1_DP' },
        { name: 'Fs2', description: 'DOCS.OPERANDS.FS2_DP' },
      ],
      example: 'DOCS.FLOAT.ADDD.EXAMPLE',
      notes: 'DOCS.FLOAT.ADDD.NOTES',
    },
    {
      id: 'eqf', name: 'EQF / NEF / LTF / GTF / LEF / GEF\nSLTF / SGTF / SLEF / SGEF',
      syntax: 'EQF Fs1, Fs2',
      description: 'DOCS.FLOAT.EQF.DESCRIPTION',
      operands: [
        { name: 'Fs1', description: 'DOCS.OPERANDS.FS1_SP_ANY' },
        { name: 'Fs2', description: 'DOCS.OPERANDS.FS2_SP_ANY' },
      ],
      example: 'DOCS.FLOAT.EQF.EXAMPLE',
      notes: 'DOCS.FLOAT.EQF.NOTES',
    },
    {
      id: 'eqd', name: 'EQD / NED / LTD / GTD / LED / GED\nSLTD / SGTD / SLED / SGED',
      syntax: 'EQD Fs1, Fs2',
      description: 'DOCS.FLOAT.EQD.DESCRIPTION',
      operands: [
        { name: 'Fs1', description: 'DOCS.OPERANDS.FS1_DP_EVEN' },
        { name: 'Fs2', description: 'DOCS.OPERANDS.FS2_DP_EVEN' },
      ],
      example: 'DOCS.FLOAT.EQD.EXAMPLE',
      notes: 'DOCS.FLOAT.EQD.NOTES',
    },
    {
      id: 'cvtf2d', name: 'CVTF2D / CVTD2F',
      syntax: 'CVTF2D Fd, Fs',
      description: 'DOCS.FLOAT.CVTF2D.DESCRIPTION',
      operands: [
        { name: 'Fd', description: 'DOCS.OPERANDS.FD_DEST_DP' },
        { name: 'Fs', description: 'DOCS.OPERANDS.FS_SRC' },
      ],
      example: 'DOCS.FLOAT.CVTF2D.EXAMPLE',
    },
    {
      id: 'cvti2d', name: 'CVTI2D / CVTI2F / CVTD2I / CVTF2I',
      syntax: 'CVTI2D Fd, Fs\nCVTD2I Fd, Fs\nCVTI2F Fd, Fs\nCVTF2I Fd, Fs',
      description: 'DOCS.FLOAT.CVTI2D.DESCRIPTION',
      operands: [
        { name: 'Fd', description: 'DOCS.OPERANDS.FD_RD_CONV_DEST' },
        { name: 'Fs', description: 'DOCS.OPERANDS.FS_CONV_SRC' },
      ],
      example: 'DOCS.FLOAT.CVTI2D.EXAMPLE',
      notes: 'DOCS.FLOAT.CVTI2D.NOTES',
    },
    {
      id: 'movf', name: 'MOVF / MOVD',
      syntax: 'MOVF Fd, Fs',
      description: 'DOCS.FLOAT.MOVF.DESCRIPTION',
      operands: [
        { name: 'Fd', description: 'DOCS.OPERANDS.FD_MOV_DEST' },
        { name: 'Fs', description: 'DOCS.OPERANDS.FS_SRC' },
      ],
      example: 'DOCS.FLOAT.MOVF.EXAMPLE',
    },
    {
      id: 'movi2fp', name: 'MOVI2FP / MOVFP2I',
      syntax: 'MOVI2FP Fd, Rs',
      description: 'DOCS.FLOAT.MOVI2FP.DESCRIPTION',
      operands: [
        { name: 'Fd / Rd', description: 'DOCS.OPERANDS.FD_RD_RAW_DEST' },
        { name: 'Rs / Fs', description: 'DOCS.OPERANDS.RS_FS_RAW_SRC' },
      ],
      example: 'DOCS.FLOAT.MOVI2FP.EXAMPLE',
      notes: 'DOCS.FLOAT.MOVI2FP.NOTES',
    },
    {
      id: 'movi2s', name: 'MOVI2S / MOVS2I',
      syntax: 'MOVI2S VLR, Rs\nMOVS2I Rd, VLR',
      description: 'DOCS.FLOAT.MOVI2S.DESCRIPTION',
      operands: [
        { name: 'VLR', description: 'DOCS.OPERANDS.VLR' },
        { name: 'Rs',  description: 'DOCS.OPERANDS.RS_INT_SRC' },
        { name: 'Rd',  description: 'DOCS.OPERANDS.RD_INT_DEST' },
      ],
      example: 'DOCS.FLOAT.MOVI2S.EXAMPLE',
    },
    {
      id: 'movf2s', name: 'MOVF2S / MOVS2F',
      syntax: 'MOVF2S VM, Fs\nMOVS2F Fd, VM',
      description: 'DOCS.FLOAT.MOVF2S.DESCRIPTION',
      operands: [
        { name: 'VM', description: 'DOCS.OPERANDS.VM' },
        { name: 'Fs / Fd', description: 'DOCS.OPERANDS.FS_FD' },
      ],
      example: 'DOCS.FLOAT.MOVF2S.EXAMPLE',
      notes: 'DOCS.FLOAT.MOVF2S.NOTES',
    },
    {
      id: 'pop', name: 'POP',
      syntax: 'POP Rd, VM',
      description: 'DOCS.FLOAT.POP.DESCRIPTION',
      operands: [
        { name: 'Rd', description: 'DOCS.OPERANDS.RD_INT_DEST' },
        { name: 'VM', description: 'DOCS.OPERANDS.VM' },
      ],
      example: 'DOCS.FLOAT.POP.EXAMPLE',
      notes: 'DOCS.FLOAT.POP.NOTES',
    },
  ],
};

const CAT_VECTOR: DocCategory = {
  id: 'vector',
  label: 'DOCS.CATEGORIES.VECTOR',
  icon: 'view_column',
  entries: [
    {
      id: 'lv', name: 'LV / SV',
      syntax: 'LV Vd, Rs\nSV Rs, Vd',
      description: 'DOCS.VECTOR.LV.DESCRIPTION',
      operands: [
        { name: 'Vd', description: 'DOCS.OPERANDS.VD' },
        { name: 'Rs', description: 'DOCS.OPERANDS.RS_BASE_ADDR' },
      ],
      example: 'DOCS.VECTOR.LV.EXAMPLE',
    },
    {
      id: 'lvws', name: 'LVWS / SVWS',
      syntax: 'LVWS Vd, Rs1, Rs2',
      description: 'DOCS.VECTOR.LVWS.DESCRIPTION',
      operands: [
        { name: 'Vd', description: 'DOCS.OPERANDS.VD' },
        { name: 'Rs1', description: 'DOCS.OPERANDS.RS_BASE_ADDR' },
        { name: 'Rs2', description: 'DOCS.OPERANDS.RS_STRIDE' },
      ],
      example: 'DOCS.VECTOR.LVWS.EXAMPLE',
    },
    {
      id: 'lvi', name: 'LVI / SVI',
      syntax: 'LVI Vd, Rs, Vi',
      description: 'DOCS.VECTOR.LVI.DESCRIPTION',
      operands: [
        { name: 'Vd', description: 'DOCS.OPERANDS.VD' },
        { name: 'Rs', description: 'DOCS.OPERANDS.RS_BASE_ADDR' },
        { name: 'Vi', description: 'DOCS.OPERANDS.VI_INDEX' },
      ],
      example: 'DOCS.VECTOR.LVI.EXAMPLE',
    },
    {
      id: 'addv', name: 'ADDV / SUBV / MULTV / DIVV',
      syntax: 'ADDV Vd, Vs1, Vs2',
      description: 'DOCS.VECTOR.ADDV.DESCRIPTION',
      operands: [
        { name: 'Vd', description: 'DOCS.OPERANDS.VD_DEST' },
        { name: 'Vs1', description: 'DOCS.OPERANDS.VS1' },
        { name: 'Vs2', description: 'DOCS.OPERANDS.VS2' },
      ],
      example: 'DOCS.VECTOR.ADDV.EXAMPLE',
      notes: 'DOCS.VECTOR.ADDV.NOTES',
    },
    {
      id: 'addsv', name: 'ADDSV / SUBSV / MULTSV / DIVSV',
      syntax: 'ADDSV Vd, Fs, Vs',
      description: 'DOCS.VECTOR.ADDSV.DESCRIPTION',
      operands: [
        { name: 'Vd', description: 'DOCS.OPERANDS.VD_DEST' },
        { name: 'Fs', description: 'DOCS.OPERANDS.FS_SCALAR' },
        { name: 'Vs', description: 'DOCS.OPERANDS.VS_SRC' },
      ],
      example: 'DOCS.VECTOR.ADDSV.EXAMPLE',
    },
    {
      id: 'addvs', name: 'ADDVS / SUBVS / MULTVS / DIVVS',
      syntax: 'ADDVS Vd, Vs, Fs',
      description: 'DOCS.VECTOR.ADDVS.DESCRIPTION',
      operands: [
        { name: 'Vd', description: 'DOCS.OPERANDS.VD_DEST' },
        { name: 'Vs', description: 'DOCS.OPERANDS.VS_SRC' },
        { name: 'Fs', description: 'DOCS.OPERANDS.FS_SCALAR' },
      ],
      example: 'DOCS.VECTOR.ADDVS.EXAMPLE',
    },
    {
      id: 'cvi', name: 'CVI',
      syntax: 'CVI Vd, Rs',
      description: 'DOCS.VECTOR.CVI.DESCRIPTION',
      operands: [
        { name: 'Vd', description: 'DOCS.OPERANDS.VD_DEST' },
        { name: 'Rs', description: 'DOCS.OPERANDS.RS_STRIDE' },
      ],
      example: 'DOCS.VECTOR.CVI.EXAMPLE',
      notes: 'DOCS.VECTOR.CVI.NOTES',
    },
    {
      id: 'cvm', name: 'CVM',
      syntax: 'CVM',
      description: 'DOCS.VECTOR.CVM.DESCRIPTION',
      example: 'DOCS.VECTOR.CVM.EXAMPLE',
    },
    {
      id: 'seqv', name: 'SEQV / SNEV / SGTV / SLTV / SGEV / SLEV',
      syntax: 'SEQV Vs1, Vs2',
      description: 'DOCS.VECTOR.SEQV.DESCRIPTION',
      operands: [
        { name: 'Vs1', description: 'DOCS.OPERANDS.VS1' },
        { name: 'Vs2', description: 'DOCS.OPERANDS.VS2' },
      ],
      example: 'DOCS.VECTOR.SEQV.EXAMPLE',
      notes: 'DOCS.VECTOR.SEQV.NOTES',
    },
    {
      id: 'seqsv', name: 'SEQSV / SNESV / SGTSV / SLTSV / SGESV / SLESV',
      syntax: 'SEQSV Fs, Vs',
      description: 'DOCS.VECTOR.SEQSV.DESCRIPTION',
      operands: [
        { name: 'Fs', description: 'DOCS.OPERANDS.FS_SCALAR' },
        { name: 'Vs', description: 'DOCS.OPERANDS.VS_SRC' },
      ],
      example: 'DOCS.VECTOR.SEQSV.EXAMPLE',
      notes: 'DOCS.VECTOR.SEQSV.NOTES',
    },
    {
      id: 'seqvs', name: 'SEQVS / SNEVS / SGTVS / SLTVS / SGEVS / SLEVS',
      syntax: 'SEQVS Vs, Fs',
      description: 'DOCS.VECTOR.SEQVS.DESCRIPTION',
      operands: [
        { name: 'Vs', description: 'DOCS.OPERANDS.VS_SRC' },
        { name: 'Fs', description: 'DOCS.OPERANDS.FS_SCALAR' },
      ],
      example: 'DOCS.VECTOR.SEQVS.EXAMPLE',
      notes: 'DOCS.VECTOR.SEQVS.NOTES',
    },
  ],
};

const CAT_DIRECTIVES: DocCategory = {
  id: 'directives',
  label: 'DOCS.CATEGORIES.DIRECTIVES',
  icon: 'code',
  entries: [
    {
      id: 'dir-data', name: '.data',
      syntax: '.data',
      description: 'DOCS.DIRECTIVES.DATA.DESCRIPTION',
      example: 'DOCS.DIRECTIVES.DATA.EXAMPLE',
    },
    {
      id: 'dir-text', name: '.text',
      syntax: '.text',
      description: 'DOCS.DIRECTIVES.TEXT.DESCRIPTION',
      example: 'DOCS.DIRECTIVES.TEXT.EXAMPLE',
    },
    {
      id: 'dir-global', name: '.global',
      syntax: '.global label',
      description: 'DOCS.DIRECTIVES.GLOBAL.DESCRIPTION',
      example: 'DOCS.DIRECTIVES.GLOBAL.EXAMPLE',
      notes: 'DOCS.DIRECTIVES.GLOBAL.NOTES',
    },
    {
      id: 'dir-word', name: '.word',
      syntax: '.word value [, value2, ...]',
      description: 'DOCS.DIRECTIVES.WORD.DESCRIPTION',
      example: 'DOCS.DIRECTIVES.WORD.EXAMPLE',
    },
    {
      id: 'dir-byte', name: '.byte',
      syntax: '.byte value [, value2, ...]',
      description: 'DOCS.DIRECTIVES.BYTE.DESCRIPTION',
      example: 'DOCS.DIRECTIVES.BYTE.EXAMPLE',
    },
    {
      id: 'dir-float', name: '.float',
      syntax: '.float value',
      description: 'DOCS.DIRECTIVES.FLOAT.DESCRIPTION',
      example: 'DOCS.DIRECTIVES.FLOAT.EXAMPLE',
    },
    {
      id: 'dir-double', name: '.double',
      syntax: '.double value',
      description: 'DOCS.DIRECTIVES.DOUBLE.DESCRIPTION',
      example: 'DOCS.DIRECTIVES.DOUBLE.EXAMPLE',
    },
    {
      id: 'dir-space', name: '.space',
      syntax: '.space n',
      description: 'DOCS.DIRECTIVES.SPACE.DESCRIPTION',
      example: 'DOCS.DIRECTIVES.SPACE.EXAMPLE',
    },
    {
      id: 'dir-ascii', name: '.ascii',
      syntax: '.ascii "string"',
      description: 'DOCS.DIRECTIVES.ASCII.DESCRIPTION',
      example: 'DOCS.DIRECTIVES.ASCII.EXAMPLE',
    },
    {
      id: 'dir-asciiz', name: '.asciiz',
      syntax: '.asciiz "string"',
      description: 'DOCS.DIRECTIVES.ASCIIZ.DESCRIPTION',
      example: 'DOCS.DIRECTIVES.ASCIIZ.EXAMPLE',
      notes: 'DOCS.DIRECTIVES.ASCIIZ.NOTES',
    },
    {
      id: 'dir-align', name: '.align',
      syntax: '.align n',
      description: 'DOCS.DIRECTIVES.ALIGN.DESCRIPTION',
      example: 'DOCS.DIRECTIVES.ALIGN.EXAMPLE',
    },
  ],
};

const CAT_TRAPS: DocCategory = {
  id: 'traps',
  label: 'DOCS.CATEGORIES.TRAPS',
  icon: 'terminal',
  entries: [
    {
      id: 'iar', name: 'IAR',
      syntax: 'DOCS.TRAPS.IAR.SYNTAX',
      description: 'DOCS.TRAPS.IAR.DESCRIPTION',
      example: 'DOCS.TRAPS.IAR.EXAMPLE',
      notes: 'DOCS.TRAPS.IAR.NOTES',
    },
    {
      id: 'rfe', name: 'RFE',
      syntax: 'RFE',
      description: 'DOCS.TRAPS.RFE.DESCRIPTION',
      example: 'DOCS.TRAPS.RFE.EXAMPLE',
      notes: 'DOCS.TRAPS.RFE.NOTES',
    },
    {
      id: 'trap0', name: 'TRAP 0 — exit',
      syntax: 'TRAP 0',
      description: 'DOCS.TRAPS.TRAP0.DESCRIPTION',
      example: 'DOCS.TRAPS.TRAP0.EXAMPLE',
    },
    {
      id: 'trap1', name: 'TRAP 1 — open',
      syntax: 'TRAP 1',
      description: 'DOCS.TRAPS.TRAP1.DESCRIPTION',
      example: 'DOCS.TRAPS.TRAP1.EXAMPLE',
      notes: 'DOCS.TRAPS.TRAP1.NOTES',
    },
    {
      id: 'trap2', name: 'TRAP 2 — close',
      syntax: 'TRAP 2',
      description: 'DOCS.TRAPS.TRAP2.DESCRIPTION',
      example: 'DOCS.TRAPS.TRAP2.EXAMPLE',
    },
    {
      id: 'trap3', name: 'TRAP 3 — read',
      syntax: 'ADDI R14, R0, ParamBlock\nTRAP 3',
      description: 'DOCS.TRAPS.TRAP3.DESCRIPTION',
      operands: [
        { name: 'R14', description: 'DOCS.OPERANDS.R14_PARAM' },
      ],
      example: 'DOCS.TRAPS.TRAP3.EXAMPLE',
      notes: 'DOCS.TRAPS.TRAP3.NOTES',
    },
    {
      id: 'trap4', name: 'TRAP 4 — write',
      syntax: 'ADDI R14, R0, ParamBlock\nTRAP 4',
      description: 'DOCS.TRAPS.TRAP4.DESCRIPTION',
      operands: [
        { name: 'R14', description: 'DOCS.OPERANDS.R14_PARAM' },
      ],
      example: 'DOCS.TRAPS.TRAP4.EXAMPLE',
    },
    {
      id: 'trap5', name: 'TRAP 5 — printf',
      syntax: 'ADDI R14, R0, ParamBlock\nTRAP 5',
      description: 'DOCS.TRAPS.TRAP5.DESCRIPTION',
      operands: [
        { name: 'R14', description: 'DOCS.OPERANDS.R14_PARAM' },
      ],
      example: 'DOCS.TRAPS.TRAP5.EXAMPLE',
      notes: 'DOCS.TRAPS.TRAP5.NOTES',
    },
  ],
};

const CAT_CONFIG: DocCategory = {
  id: 'config',
  label: 'DOCS.CATEGORIES.CONFIG',
  icon: 'settings',
  entries: [
    {
      id: 'cfg-memory', name: 'DOCS.CONFIG.MEMORY.NAME',
      syntax: 'memorySize: number',
      description: 'DOCS.CONFIG.MEMORY.DESCRIPTION',
      example: 'DOCS.CONFIG.MEMORY.EXAMPLE',
      notes: 'DOCS.CONFIG.MEMORY.NOTES',
    },
    {
      id: 'cfg-forwarding', name: 'Data Forwarding',
      syntax: 'enableForwarding: boolean',
      description: 'DOCS.CONFIG.FORWARDING.DESCRIPTION',
      example: 'DOCS.CONFIG.FORWARDING.EXAMPLE',
      notes: 'DOCS.CONFIG.FORWARDING.NOTES',
    },
    {
      id: 'cfg-chaining', name: 'Vector Chaining',
      syntax: 'enableVectorChaining: boolean',
      description: 'DOCS.CONFIG.CHAINING.DESCRIPTION',
      example: 'DOCS.CONFIG.CHAINING.EXAMPLE',
      notes: 'DOCS.CONFIG.CHAINING.NOTES',
    },
    {
      id: 'cfg-alu-lanes', name: 'ALU Lanes',
      syntax: 'aluLanes: number',
      description: 'DOCS.CONFIG.ALU_LANES.DESCRIPTION',
      example: 'DOCS.CONFIG.ALU_LANES.EXAMPLE',
    },
    {
      id: 'cfg-mem-lanes', name: 'Mem Lanes',
      syntax: 'memLanes: number',
      description: 'DOCS.CONFIG.MEM_LANES.DESCRIPTION',
      example: 'DOCS.CONFIG.MEM_LANES.EXAMPLE',
    },
    {
      id: 'cfg-bp', name: 'DOCS.CONFIG.BP.NAME',
      syntax: 'branchPredictionStrategy: string',
      description: 'DOCS.CONFIG.BP.DESCRIPTION',
      example: 'DOCS.CONFIG.BP.EXAMPLE',
      notes: 'DOCS.CONFIG.BP.NOTES',
    },
    {
      id: 'cfg-ras', name: 'DOCS.CONFIG.RAS.NAME',
      syntax: 'branchPredictionStrategy: "ras"',
      description: 'DOCS.CONFIG.RAS.DESCRIPTION',
      example: 'DOCS.CONFIG.RAS.EXAMPLE',
      notes: 'DOCS.CONFIG.RAS.NOTES',
    },
    {
      id: 'cfg-delay-slot', name: 'Branch Delay Slot',
      syntax: 'enableBranchDelaySlot: boolean',
      description: 'DOCS.CONFIG.DELAY_SLOT.DESCRIPTION',
      example: 'DOCS.CONFIG.DELAY_SLOT.EXAMPLE',
      notes: 'DOCS.CONFIG.DELAY_SLOT.NOTES',
    },
    {
      id: 'cfg-ghr', name: 'GHR Bits',
      syntax: 'ghrBits: number',
      description: 'DOCS.CONFIG.GHR.DESCRIPTION',
      example: 'DOCS.CONFIG.GHR.EXAMPLE',
    },
    {
      id: 'cfg-mvl', name: 'DOCS.CONFIG.MVL.NAME',
      syntax: 'mvl: number',
      description: 'DOCS.CONFIG.MVL.DESCRIPTION',
      example: 'DOCS.CONFIG.MVL.EXAMPLE',
      notes: 'DOCS.CONFIG.MVL.NOTES',
    },
    {
      id: 'cfg-logging', name: 'Logging',
      syntax: 'loggingEnabled: boolean',
      description: 'DOCS.CONFIG.LOGGING.DESCRIPTION',
      example: 'DOCS.CONFIG.LOGGING.EXAMPLE',
    },
    {
      id: 'cfg-log-level', name: 'DOCS.CONFIG.LOG_LEVEL.NAME',
      syntax: "logLevel: 'error' | 'warning' | 'relevant' | 'debug'",
      description: 'DOCS.CONFIG.LOG_LEVEL.DESCRIPTION',
      example: 'DOCS.CONFIG.LOG_LEVEL.EXAMPLE',
      notes: 'DOCS.CONFIG.LOG_LEVEL.NOTES',
    },
    {
      id: 'cfg-timeline', name: 'DOCS.CONFIG.TIMELINE.NAME',
      syntax: "timelineMode: 'live' | 'on-finish' | 'disabled'",
      description: 'DOCS.CONFIG.TIMELINE.DESCRIPTION',
      example: 'DOCS.CONFIG.TIMELINE.EXAMPLE',
    },
    {
      id: 'cfg-latencies', name: 'DOCS.CONFIG.LATENCIES.NAME',
      syntax: 'latencies: LatencyConfig',
      description: 'DOCS.CONFIG.LATENCIES.DESCRIPTION',
      example: 'DOCS.CONFIG.LATENCIES.EXAMPLE',
      notes: 'DOCS.CONFIG.LATENCIES.NOTES',
    },
    {
      id: 'cfg-superscalar-rs', name: 'DOCS.CONFIG.SUPERSCALAR_RS.NAME',
      syntax: "rsType: 'centralized' | 'distributed' | 'clustered'",
      description: 'DOCS.CONFIG.SUPERSCALAR_RS.DESCRIPTION',
      example: 'DOCS.CONFIG.SUPERSCALAR_RS.EXAMPLE',
      notes: 'DOCS.CONFIG.SUPERSCALAR_RS.NOTES',
    },
    {
      id: 'cfg-superscalar-issue', name: 'DOCS.CONFIG.SUPERSCALAR_ISSUE.NAME',
      syntax: 'issueWidth: 1 | 2 | 4 | 8 · robSize: number · cdbWidth: number',
      description: 'DOCS.CONFIG.SUPERSCALAR_ISSUE.DESCRIPTION',
      example: 'DOCS.CONFIG.SUPERSCALAR_ISSUE.EXAMPLE',
      notes: 'DOCS.CONFIG.SUPERSCALAR_ISSUE.NOTES',
    },
    {
      id: 'cfg-superscalar-fu-counts', name: 'DOCS.CONFIG.SUPERSCALAR_FU_COUNTS.NAME',
      syntax: 'intALUs · intMulUnits · intDivUnits · fpAddUnits · fpMulUnits · fpDivUnits · memUnits · branchUnits · vecMemUnits · vecIntUnits · vecMulUnits · vecDivUnits',
      description: 'DOCS.CONFIG.SUPERSCALAR_FU_COUNTS.DESCRIPTION',
      example: 'DOCS.CONFIG.SUPERSCALAR_FU_COUNTS.EXAMPLE',
      notes: 'DOCS.CONFIG.SUPERSCALAR_FU_COUNTS.NOTES',
    },
    {
      id: 'cfg-superscalar-vector-overlap', name: 'DOCS.CONFIG.SUPERSCALAR_VECTOR_OVERLAP.NAME',
      syntax: 'enableVectorInitOverlap: boolean',
      description: 'DOCS.CONFIG.SUPERSCALAR_VECTOR_OVERLAP.DESCRIPTION',
      example: 'DOCS.CONFIG.SUPERSCALAR_VECTOR_OVERLAP.EXAMPLE',
      notes: 'DOCS.CONFIG.SUPERSCALAR_VECTOR_OVERLAP.NOTES',
    },
    {
      id: 'cfg-superscalar-presets', name: 'DOCS.CONFIG.SUPERSCALAR_PRESETS.NAME',
      syntax: "'minimal' | 'balanced' | 'aggressive'",
      description: 'DOCS.CONFIG.SUPERSCALAR_PRESETS.DESCRIPTION',
      example: 'DOCS.CONFIG.SUPERSCALAR_PRESETS.EXAMPLE',
      notes: 'DOCS.CONFIG.SUPERSCALAR_PRESETS.NOTES',
    },
  ],
};

const CAT_OPTIMIZATION: DocCategory = {
  id: 'optimization',
  label: 'DOCS.CATEGORIES.OPTIMIZATION',
  icon: 'auto_fix_high',
  entries: [
    {
      id: 'opt-scheduling', name: 'DOCS.OPTIMIZATION.SCHEDULING.NAME',
      syntax: 'Static Instruction Scheduling',
      description: 'DOCS.OPTIMIZATION.SCHEDULING.DESCRIPTION',
      example: 'DOCS.OPTIMIZATION.SCHEDULING.EXAMPLE',
    },
    {
      id: 'opt-unrolling', name: 'DOCS.OPTIMIZATION.UNROLLING.NAME',
      syntax: 'Loop Unrolling',
      description: 'DOCS.OPTIMIZATION.UNROLLING.DESCRIPTION',
      example: 'DOCS.OPTIMIZATION.UNROLLING.EXAMPLE',
      notes: 'DOCS.OPTIMIZATION.UNROLLING.NOTES',
    },
    {
      id: 'opt-reg-renaming', name: 'DOCS.OPTIMIZATION.REGISTER_RENAMING.NAME',
      syntax: 'Static Register Renaming',
      description: 'DOCS.OPTIMIZATION.REGISTER_RENAMING.DESCRIPTION',
      example: 'DOCS.OPTIMIZATION.REGISTER_RENAMING.EXAMPLE',
    },
    {
      id: 'opt-delayed-branch', name: 'DOCS.OPTIMIZATION.DELAYED_BRANCH.NAME',
      syntax: 'Branch Delay Slot Filling',
      description: 'DOCS.OPTIMIZATION.DELAYED_BRANCH.DESCRIPTION',
      example: 'DOCS.OPTIMIZATION.DELAYED_BRANCH.EXAMPLE',
      notes: 'DOCS.OPTIMIZATION.DELAYED_BRANCH.NOTES',
    },
  ],
};

const CAT_PROCESSORS: DocCategory = {
  id: 'processors',
  label: 'DOCS.CATEGORIES.PROCESSORS',
  icon: 'memory',
  entries: [
    {
      id: 'proc-nonpipelined', name: 'DOCS.PROCESSORS.NONPIPELINED.NAME',
      syntax: 'DOCS.PROCESSORS.NONPIPELINED.SYNTAX',
      description: 'DOCS.PROCESSORS.NONPIPELINED.DESCRIPTION',
      example: 'DOCS.PROCESSORS.NONPIPELINED.EXAMPLE',
      notes: 'DOCS.PROCESSORS.NONPIPELINED.NOTES',
    },
    {
      id: 'proc-pipelined', name: 'DOCS.PROCESSORS.PIPELINED.NAME',
      syntax: 'DOCS.PROCESSORS.PIPELINED.SYNTAX',
      description: 'DOCS.PROCESSORS.PIPELINED.DESCRIPTION',
      operands: [
        { name: 'Forwarding', description: 'DOCS.PROCESSORS.PIPELINED.OP_FORWARDING' },
        { name: 'Branch Prediction', description: 'DOCS.PROCESSORS.PIPELINED.OP_BP' },
        { name: 'Vector Chaining', description: 'DOCS.PROCESSORS.PIPELINED.OP_CHAINING' },
        { name: 'Branch Delay Slot', description: 'DOCS.PROCESSORS.PIPELINED.OP_DELAY_SLOT' },
      ],
      example: 'DOCS.PROCESSORS.PIPELINED.EXAMPLE',
      notes: 'DOCS.PROCESSORS.PIPELINED.NOTES',
    },
    {
      id: 'proc-superscalar', name: 'DOCS.PROCESSORS.SUPERSCALAR.NAME',
      syntax: 'DOCS.PROCESSORS.SUPERSCALAR.SYNTAX',
      description: 'DOCS.PROCESSORS.SUPERSCALAR.DESCRIPTION',
      operands: [
        { name: 'ROB Size', description: 'DOCS.PROCESSORS.SUPERSCALAR.OP_ROB' },
        { name: 'RS per FU', description: 'DOCS.PROCESSORS.SUPERSCALAR.OP_RS' },
        { name: 'Issue Width', description: 'DOCS.PROCESSORS.SUPERSCALAR.OP_ISSUE' },
        { name: 'Branch Delay Slot', description: 'DOCS.PROCESSORS.SUPERSCALAR.OP_DELAY_SLOT' },
      ],
      example: 'DOCS.PROCESSORS.SUPERSCALAR.EXAMPLE',
      notes: 'DOCS.PROCESSORS.SUPERSCALAR.NOTES',
    },
  ],
};

const CAT_EXCEPTIONS: DocCategory = {
  id: 'exceptions',
  label: 'DOCS.CATEGORIES.EXCEPTIONS',
  icon: 'error_outline',
  entries: [
    {
      id: 'exc-overview', name: 'DOCS.EXCEPTIONS.OVERVIEW.NAME',
      syntax: 'DOCS.EXCEPTIONS.OVERVIEW.SYNTAX',
      description: 'DOCS.EXCEPTIONS.OVERVIEW.DESCRIPTION',
      notes: 'DOCS.EXCEPTIONS.OVERVIEW.NOTES',
    },
    {
      id: 'exc-vectors', name: 'DOCS.EXCEPTIONS.VECTORS.NAME',
      syntax: 'DOCS.EXCEPTIONS.VECTORS.SYNTAX',
      description: 'DOCS.EXCEPTIONS.VECTORS.DESCRIPTION',
      example: 'DOCS.EXCEPTIONS.VECTORS.EXAMPLE',
    },
    {
      id: 'exc-handlers', name: 'DOCS.EXCEPTIONS.HANDLERS.NAME',
      syntax: '__handler_name:',
      description: 'DOCS.EXCEPTIONS.HANDLERS.DESCRIPTION',
      example: 'DOCS.EXCEPTIONS.HANDLERS.EXAMPLE',
      notes: 'DOCS.EXCEPTIONS.HANDLERS.NOTES',
    },
    {
      id: 'exc-default', name: 'Default Handler',
      syntax: 'TRAP 6',
      description: 'DOCS.EXCEPTIONS.DEFAULT.DESCRIPTION',
      example: 'DOCS.EXCEPTIONS.DEFAULT.EXAMPLE',
      notes: 'DOCS.EXCEPTIONS.DEFAULT.NOTES',
    },
    {
      id: 'exc-iar', name: 'IAR - Interrupt Address Register',
      syntax: 'DOCS.EXCEPTIONS.IAR.SYNTAX',
      description: 'DOCS.EXCEPTIONS.IAR.DESCRIPTION',
      example: 'DOCS.EXCEPTIONS.IAR.EXAMPLE',
      notes: 'DOCS.EXCEPTIONS.IAR.NOTES',
    },
    {
      id: 'exc-cause', name: 'CAUSE',
      syntax: 'DOCS.EXCEPTIONS.CAUSE.SYNTAX',
      description: 'DOCS.EXCEPTIONS.CAUSE.DESCRIPTION',
      example: 'DOCS.EXCEPTIONS.CAUSE.EXAMPLE',
      notes: 'DOCS.EXCEPTIONS.CAUSE.NOTES',
    },
    {
      id: 'exc-rfe', name: 'RFE - Return From Exception',
      syntax: 'RFE',
      description: 'DOCS.EXCEPTIONS.RFE.DESCRIPTION',
      example: 'DOCS.EXCEPTIONS.RFE.EXAMPLE',
      notes: 'DOCS.EXCEPTIONS.RFE.NOTES',
    },
  ],
};

const CAT_HOW_TO_USE: DocCategory = {
  id: 'how-to-use',
  label: 'DOCS.CATEGORIES.HOW_TO_USE',
  icon: 'info',
  entries: [
    {
      id: 'how-getting-started', name: 'DOCS.HOW_TO_USE.GETTING_STARTED.NAME',
      syntax: 'Escribir → Run → Observar',
      description: 'DOCS.HOW_TO_USE.GETTING_STARTED.DESCRIPTION',
      example: 'DOCS.HOW_TO_USE.GETTING_STARTED.EXAMPLE',
    },
    {
      id: 'how-flow', name: 'DOCS.HOW_TO_USE.FLOW.NAME',
      syntax: 'Ensamblado → Reserva de memoria → Ejecución',
      description: 'DOCS.HOW_TO_USE.FLOW.DESCRIPTION',
      example: 'DOCS.HOW_TO_USE.FLOW.EXAMPLE',
    },
    {
      id: 'how-controls', name: 'DOCS.HOW_TO_USE.CONTROLS.NAME',
      syntax: 'Toolbar',
      description: 'DOCS.HOW_TO_USE.CONTROLS.DESCRIPTION',
      notes: 'DOCS.HOW_TO_USE.CONTROLS.NOTES',
    },
    {
      id: 'how-modules', name: 'DOCS.HOW_TO_USE.MODULES.NAME',
      syntax: 'Editor · Registros · Eventos · Pipeline · Timeline · Consola · Memoria',
      description: 'DOCS.HOW_TO_USE.MODULES.DESCRIPTION',
    },
    {
      id: 'how-registers', name: 'DOCS.HOW_TO_USE.REGISTERS.NAME',
      syntax: 'R0-R31 · F0-F31 · V0-V7',
      description: 'DOCS.HOW_TO_USE.REGISTERS.DESCRIPTION',
      notes: 'DOCS.HOW_TO_USE.REGISTERS.NOTES',
    },
    {
      id: 'how-memory-view', name: 'DOCS.HOW_TO_USE.MEMORY_VIEW.NAME',
      syntax: 'DEC / HEX / BIN / ASCII',
      description: 'DOCS.HOW_TO_USE.MEMORY_VIEW.DESCRIPTION',
      notes: 'DOCS.HOW_TO_USE.MEMORY_VIEW.NOTES',
    },
    {
      id: 'how-event-view', name: 'DOCS.HOW_TO_USE.EVENT_VIEW.NAME',
      syntax: 'Registro de eventos',
      description: 'DOCS.HOW_TO_USE.EVENT_VIEW.DESCRIPTION',
      notes: 'DOCS.HOW_TO_USE.EVENT_VIEW.NOTES',
    },
    {
      id: 'how-stats', name: 'DOCS.HOW_TO_USE.STATS.NAME',
      syntax: 'Performance Metrics',
      description: 'DOCS.HOW_TO_USE.STATS.DESCRIPTION',
      notes: 'DOCS.HOW_TO_USE.STATS.NOTES',
    },
    {
      id: 'how-editor', name: 'DOCS.HOW_TO_USE.EDITOR.NAME',
      syntax: 'Monaco Editor',
      description: 'DOCS.HOW_TO_USE.EDITOR.DESCRIPTION',
      notes: 'DOCS.HOW_TO_USE.EDITOR.NOTES',
    },
    {
      id: 'how-breakpoints', name: 'DOCS.HOW_TO_USE.BREAKPOINTS.NAME',
      syntax: 'Click en el margen izquierdo',
      description: 'DOCS.HOW_TO_USE.BREAKPOINTS.DESCRIPTION',
      notes: 'DOCS.HOW_TO_USE.BREAKPOINTS.NOTES',
    },
    {
      id: 'how-superscalar-views', name: 'DOCS.HOW_TO_USE.SUPERSCALAR_VIEWS.NAME',
      syntax: 'ROB · RS · CDB',
      description: 'DOCS.HOW_TO_USE.SUPERSCALAR_VIEWS.DESCRIPTION',
    },
    {
      id: 'how-io', name: 'DOCS.HOW_TO_USE.IO.NAME',
      syntax: 'TRAP 3 / TRAP 5',
      description: 'DOCS.HOW_TO_USE.IO.DESCRIPTION',
      example: 'DOCS.HOW_TO_USE.IO.EXAMPLE',
    },
    {
      id: 'how-export', name: 'DOCS.HOW_TO_USE.EXPORT.NAME',
      syntax: 'CSV / PNG',
      description: 'DOCS.HOW_TO_USE.EXPORT.DESCRIPTION',
      notes: 'DOCS.HOW_TO_USE.EXPORT.NOTES',
    },
    {
      id: 'how-settings', name: 'DOCS.HOW_TO_USE.SETTINGS.NAME',
      syntax: 'Icono de ajustes',
      description: 'DOCS.HOW_TO_USE.SETTINGS.DESCRIPTION',
      notes: 'DOCS.HOW_TO_USE.SETTINGS.NOTES',
    },
    {
      id: 'how-static-scheduling', name: 'DOCS.HOW_TO_USE.STATIC_SCHEDULING_UI.NAME',
      syntax: 'Botón "Optimizar"',
      description: 'DOCS.HOW_TO_USE.STATIC_SCHEDULING_UI.DESCRIPTION',
      notes: 'DOCS.HOW_TO_USE.STATIC_SCHEDULING_UI.NOTES',
    },
    {
      id: 'how-theme-lang', name: 'DOCS.HOW_TO_USE.THEME_LANG.NAME',
      syntax: 'Barra superior',
      description: 'DOCS.HOW_TO_USE.THEME_LANG.DESCRIPTION',
    },
  ],
};

const CAT_EXAMPLES_BASIC: DocCategory = {
  id: 'examples-basic',
  label: 'DOCS.CATEGORIES.EXAMPLES_BASIC',
  icon: 'assignment',
  entries: [
    {
      id: 'ex-factorial', name: 'DOCS.EXAMPLES.FACTORIAL.NAME',
      syntax: 'Bucle simple',
      description: 'DOCS.EXAMPLES.FACTORIAL.DESCRIPTION',
      example: 'DOCS.EXAMPLES.FACTORIAL.EXAMPLE',
    },
    {
      id: 'ex-fibonacci', name: 'DOCS.EXAMPLES.FIBONACCI.NAME',
      syntax: 'Patrón de dependencias RAW',
      description: 'DOCS.EXAMPLES.FIBONACCI.DESCRIPTION',
      example: 'DOCS.EXAMPLES.FIBONACCI.EXAMPLE',
    },
  ],
};

const CAT_EXAMPLES_MATH: DocCategory = {
  id: 'examples-math',
  label: 'DOCS.CATEGORIES.EXAMPLES_MATH',
  icon: 'functions',
  entries: [
    {
      id: 'ex-circle', name: 'DOCS.EXAMPLES.CIRCLE.NAME',
      syntax: 'FPU + Llamadas al sistema',
      description: 'DOCS.EXAMPLES.CIRCLE.DESCRIPTION',
      example: 'DOCS.EXAMPLES.CIRCLE.EXAMPLE',
    },
  ],
};

const CAT_EXAMPLES_VECTOR: DocCategory = {
  id: 'examples-vector',
  label: 'DOCS.CATEGORIES.EXAMPLES_VECTOR',
  icon: 'view_column',
  entries: [
    {
      id: 'ex-daxpy', name: 'DOCS.EXAMPLES.DAXPY.NAME',
      syntax: 'Paralelismo Vectorial',
      description: 'DOCS.EXAMPLES.DAXPY.DESCRIPTION',
      example: 'DOCS.EXAMPLES.DAXPY.EXAMPLE',
    },
  ],
};

//Organización por secciones principales

export const DOC_SECTIONS: DocSection[] = [
  {
    id: 'application',
    label: 'DOCS.SECTIONS.APPLICATION',
    icon: 'apps',
    categories: [
      CAT_HOW_TO_USE,
      CAT_PROCESSORS,
      CAT_EXCEPTIONS,
      CAT_CONFIG,
    ],
  },
  {
    id: 'instructions',
    label: 'DOCS.SECTIONS.INSTRUCTIONS',
    icon: 'list_alt',
    categories: [
      CAT_INT_ALU,
      CAT_INT_IMM,
      CAT_MEMORY,
      CAT_BRANCHES,
      CAT_COMPARE,
      CAT_FLOAT,
      CAT_VECTOR,
      CAT_DIRECTIVES,
      CAT_TRAPS,
    ],
  },
  {
    id: 'static-scheduling',
    label: 'DOCS.SECTIONS.SCHEDULING',
    icon: 'bolt',
    categories: [
      CAT_OPTIMIZATION,
    ],
  },
  {
    id: 'examples',
    label: 'DOCS.SECTIONS.EXAMPLES',
    icon: 'library_books',
    categories: [
      CAT_EXAMPLES_BASIC,
      CAT_EXAMPLES_MATH,
      CAT_EXAMPLES_VECTOR,
    ],
  },
];

// Mantener por compatibilidad si es necesario o para búsquedas globales
export const DOC_CATEGORIES: DocCategory[] = [
  ...DOC_SECTIONS.flatMap(s => s.categories)
];
