import { AsgLexerService } from '../../src/app/core/services/assembly/asg.lexer';
import { TokenType } from '../../src/app/core/models/asg.models';

function tokenTypes(source: string) {
  return new AsgLexerService(source).tokenize().map(t => t.type);
}

describe('AsgLexerService', () => {
  it('tokenizes a simple instruction with registers and an immediate', () => {
    const tokens = new AsgLexerService('ADDI R1, R0, #10').tokenize();

    expect(tokens.map(t => t.type)).toEqual([
      TokenType.INSTRUCTION,
      TokenType.REGISTER,
      TokenType.COMMA,
      TokenType.REGISTER,
      TokenType.COMMA,
      TokenType.INT,
      TokenType.EOF,
    ]);
    expect(tokens[0].value).toBe('ADDI');
    expect(tokens[5].value).toBe('#10');
  });

  it('strips the trailing colon from a label definition', () => {
    const tokens = new AsgLexerService('LOOP: ADDI R1, R1, #1').tokenize();

    expect(tokens[0].type).toBe(TokenType.LABEL_DEF);
    expect(tokens[0].value).toBe('LOOP');
  });

  it('recognizes memory addressing with parentheses', () => {
    expect(tokenTypes('LW R1, 0(R2)')).toEqual([
      TokenType.INSTRUCTION,
      TokenType.REGISTER,
      TokenType.COMMA,
      TokenType.INT,
      TokenType.PAREN_L,
      TokenType.REGISTER,
      TokenType.PAREN_R,
      TokenType.EOF,
    ]);
  });

  it('distinguishes floats from integers', () => {
    const tokens = new AsgLexerService('.float 5.5').tokenize();
    expect(tokens.map(t => t.type)).toEqual([TokenType.DIRECTIVE, TokenType.FLOAT, TokenType.EOF]);
  });

  it('parses hexadecimal and negative integers', () => {
    const tokens = new AsgLexerService('#0xFF #-5').tokenize();
    expect(tokens[0]).toMatchObject({ type: TokenType.INT, value: '#0xFF' });
    expect(tokens[1]).toMatchObject({ type: TokenType.INT, value: '#-5' });
  });

  it('ignores comments and whitespace, and tracks line numbers', () => {
    const tokens = new AsgLexerService('ADDI R1, R0, #1 ; comentario\nADDI R2, R0, #2').tokenize();
    const secondInstruction = tokens.find(t => t.value === 'ADDI' && t.line === 2);
    expect(secondInstruction).toBeDefined();
    // El comentario no debe generar ningún token adicional
    expect(tokens.filter(t => t.type === TokenType.INSTRUCTION)).toHaveLength(2);
  });

  it('throws a lexical error on an unrecognized character', () => {
    expect(() => new AsgLexerService('ADDI R1, R0, @10').tokenize()).toThrow(/Error Léxico/);
  });
});
