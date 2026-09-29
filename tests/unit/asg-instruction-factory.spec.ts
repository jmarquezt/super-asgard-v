import { AsgLexerService } from '../../src/app/core/services/assembly/asg.lexer';
import { AsgSemanticAnalyzerService } from '../../src/app/core/services/assembly/asg.semantic-analyzer';
import { AsgInstructionFactoryService } from '../../src/app/core/services/assembly/asg.instruction-factory';
import { TokenType } from '../../src/app/core/models/asg.models';
import { CODE_BASE } from '../../src/app/core/models/asg.exceptions';
import { SymbolTable } from '../../src/app/core/models/asg.symbol-table';

function compile(source: string) {
  const tokens = new AsgLexerService(source).tokenize().filter(t => t.type !== TokenType.EOF);
  tokens.push({ type: TokenType.EOF, value: '', line: source.split('\n').length, column: 0 });
  return new AsgSemanticAnalyzerService(tokens, 4096).analyze();
}

function readWord(binary: Uint8Array, pc: number): number {
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  return view.getUint32(pc, false);
}

describe('AsgInstructionFactoryService', () => {
  afterEach(() => {
    SymbolTable.clear();
  });

  it('produces a binary buffer sized to cover the last instruction', () => {
    const { instructions } = compile('.text\nADDI R1, R0, #1');
    const binary = AsgInstructionFactoryService.assemble(instructions);
    const last = instructions[instructions.length - 1];
    expect(binary.length).toBe(last.pc + 4);
  });

  it('round-trips an immediate-type instruction (ADDI) through assemble/decode', () => {
    const { instructions } = compile('.text\nADDI R1, R0, #10');
    const binary = AsgInstructionFactoryService.assemble(instructions);

    const word = readWord(binary, CODE_BASE);
    const decoded = AsgInstructionFactoryService.decode(word, CODE_BASE, 1);

    expect(decoded.opcode).toBe('ADDI');
    expect(decoded.rd).toBe(1);
    expect(decoded.rs1).toBe(0);
    expect(decoded.imm).toBe(10);
  });

  it('round-trips a register-type instruction (ADD) through assemble/decode', () => {
    const { instructions } = compile('.text\nADDI R1, R0, #1\nADD R3, R1, R1');
    const binary = AsgInstructionFactoryService.assemble(instructions);

    const word = readWord(binary, CODE_BASE + 4);
    const decoded = AsgInstructionFactoryService.decode(word, CODE_BASE + 4, 2);

    expect(decoded.opcode).toBe('ADD');
    expect(decoded.rd).toBe(3);
    expect(decoded.rs1).toBe(1);
    expect(decoded.rs2).toBe(1);
  });

  it('round-trips a branch-type instruction (BNEZ) preserving its target', () => {
    const { instructions } = compile('.text\nBNEZ R1, END\nEND: ADDI R2, R0, #1');
    const binary = AsgInstructionFactoryService.assemble(instructions);

    const word = readWord(binary, CODE_BASE);
    const decoded = AsgInstructionFactoryService.decode(word, CODE_BASE, 1);

    expect(decoded.opcode).toBe('BNEZ');
    expect(decoded.rs1).toBe(1);
    expect(decoded.imm).toBe((CODE_BASE + 4) / 4);
  });

  it('decodes an unrecognized opcode/func combination as an illegal instruction', () => {
    // Opcode 0x00 (familia tipo-R) con un func fuera de rango (0x7FF): ninguna entrada del mapa lo define.
    const decoded = AsgInstructionFactoryService.decode(0x7FF, CODE_BASE, 1);
    expect(decoded.hasException).toBe(true);
    expect(decoded.exceptionCode).toBe('ILLEGAL_INSTRUCTION');
  });

  it('returns an empty buffer for an empty program', () => {
    expect(AsgInstructionFactoryService.assemble([])).toEqual(new Uint8Array(0));
  });
});
