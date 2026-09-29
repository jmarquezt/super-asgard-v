import { AsgLexerService } from '../../src/app/core/services/assembly/asg.lexer';
import { AsgSemanticAnalyzerService } from '../../src/app/core/services/assembly/asg.semantic-analyzer';
import { TokenType } from '../../src/app/core/models/asg.models';
import { CODE_BASE, VECTOR_TABLE_ENTRIES } from '../../src/app/core/models/asg.exceptions';
import { SymbolTable } from '../../src/app/core/models/asg.symbol-table';

function analyze(source: string) {
  const tokens = new AsgLexerService(source).tokenize().filter(t => t.type !== TokenType.EOF);
  tokens.push({ type: TokenType.EOF, value: '', line: source.split('\n').length, column: 0 });
  return new AsgSemanticAnalyzerService(tokens, 4096).analyze();
}

describe('AsgSemanticAnalyzerService', () => {
  afterEach(() => {
    SymbolTable.clear();
  });

  it('places user code right after the interrupt vector table', () => {
    const { initialCodePtr } = analyze('.text\nADDI R1, R0, #1');
    expect(initialCodePtr).toBe(CODE_BASE);
  });

  it('emits the interrupt vector table plus the default handler ahead of user instructions', () => {
    const { instructions } = analyze('.text\nADDI R1, R0, #1\nADDI R2, R0, #2');
    // VECTOR_TABLE_ENTRIES saltos J + 1 default handler (TRAP) + 2 instrucciones de usuario
    expect(instructions).toHaveLength(VECTOR_TABLE_ENTRIES + 1 + 2);
    expect(instructions[VECTOR_TABLE_ENTRIES].opcode).toBe('TRAP');
    expect(instructions[VECTOR_TABLE_ENTRIES + 1].opcode).toBe('ADDI');
    expect(instructions[VECTOR_TABLE_ENTRIES + 1].pc).toBe(CODE_BASE);
  });

  it('resolves a forward label reference to its instruction address', () => {
    const { instructions } = analyze('.text\nBNEZ R1, END\nADDI R2, R0, #1\nEND: ADDI R3, R0, #2');
    const branch = instructions[VECTOR_TABLE_ENTRIES + 1];
    expect(branch.opcode).toBe('BNEZ');
    // La etiqueta END apunta a la 3ª instrucción de usuario (offset 8 bytes = 2 instrucciones más adelante)
    expect(branch.imm).toBe((CODE_BASE + 8) / 4);
  });

  it('lays out .data directives sequentially and writes their values into the data buffer', () => {
    const { dataBuffer } = analyze('.data\nVALOR: .word 100\n.text\nADDI R1, R0, #1');
    const view = new DataView(dataBuffer.buffer);
    expect(view.getInt32(0, false)).toBe(100);
  });

  it('stores a .float directive as an IEEE-754 big-endian single', () => {
    const { dataBuffer } = analyze('.data\nPI: .float 1.5\n.text\nADDI R1, R0, #1');
    const view = new DataView(dataBuffer.buffer);
    expect(view.getFloat32(0, false)).toBeCloseTo(1.5);
  });

  it('pads to the requested boundary with .align', () => {
    const { dataBuffer } = analyze('.data\nA: .byte 1\n.align 2\nB: .word 200\n.text\nADDI R1, R0, #1');
    const view = new DataView(dataBuffer.buffer);
    // .byte ocupa 1 byte (offset 0); .align 2 alinea a 4 bytes -> B queda en el offset 4
    expect(view.getInt32(4, false)).toBe(200);
  });

  it('throws when the program does not declare a .text segment', () => {
    expect(() => analyze('.data\nVALOR: .word 1')).toThrow(/\.text/);
  });

  it('throws when an instruction appears outside the .text segment', () => {
    expect(() => analyze('ADDI R1, R0, #1')).toThrow();
  });

  it('throws when referencing an undefined label', () => {
    expect(() => analyze('.text\nJ NOWHERE')).toThrow(/no definida/);
  });
});
