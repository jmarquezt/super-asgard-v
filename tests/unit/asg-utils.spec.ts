import {
  getInstructionConfig,
  parseReg,
  parseReadReg,
  parseWriteReg,
  parseNumberImmediate,
  parseLabel,
} from '../../src/app/core/helpers/asg.utils';
import { SymbolTable } from '../../src/app/core/models/asg.symbol-table';
import { AssemblerError } from '../../src/app/core/models/asg.exceptions';

describe('asg.utils', () => {
  afterEach(() => {
    SymbolTable.clear();
  });

  describe('getInstructionConfig', () => {
    it('returns the configuration for a known opcode', () => {
      const config = getInstructionConfig(1, 'ADDI', ['R1', 'R0', '#1']);
      expect(config.type).toBe('I');
    });

    it('throws on an unknown opcode', () => {
      expect(() => getInstructionConfig(1, 'NOPE', [])).toThrow(AssemblerError);
    });

    it('throws when the argument count does not match the opcode', () => {
      expect(() => getInstructionConfig(1, 'ADDI', ['R1', 'R0'])).toThrow(/Número de argumentos no válido/);
    });
  });

  describe('parseReg / parseReadReg / parseWriteReg', () => {
    it('parses the numeric index of a register of the expected type', () => {
      expect(parseReg(1, 'R5', 'R')).toBe(5);
      expect(parseReg(1, 'F12', 'F')).toBe(12);
      expect(parseReg(1, 'V2', 'V')).toBe(2);
    });

    it('throws when the register type does not match what is expected', () => {
      expect(() => parseReg(1, 'F1', 'R')).toThrow(AssemblerError);
    });

    it('rejects a vector register index outside 0-7', () => {
      expect(() => parseReadReg(1, 'V8', 'V')).toThrow(/excede los límites/);
    });

    it('rejects an odd register index for double precision', () => {
      expect(() => parseReadReg(1, 'F3', 'D')).toThrow(/registro par/);
    });

    it('rejects R0 as a write destination', () => {
      expect(() => parseWriteReg(1, 'R0', 'R')).toThrow(/no puede usarse para escritura/);
    });
  });

  describe('parseNumberImmediate', () => {
    it('parses a decimal immediate', () => {
      expect(parseNumberImmediate(1, '#10')).toBe(10);
    });

    it('parses a hexadecimal immediate', () => {
      expect(parseNumberImmediate(1, '#0xFF')).toBe(255);
    });

    it('parses a negative immediate', () => {
      expect(parseNumberImmediate(1, '#-5')).toBe(-5);
    });

    it('rejects an immediate outside the 16-bit range', () => {
      expect(() => parseNumberImmediate(1, '#70000')).toThrow(/excede los 16 bits/);
    });

    it('resolves a .data label to its address', () => {
      SymbolTable.add('VALOR', 40, 'DATA');
      expect(parseNumberImmediate(1, 'VALOR')).toBe(40);
    });

    it('rejects a .text label used as an immediate', () => {
      SymbolTable.add('LOOP', 104, 'TEXT');
      expect(() => parseNumberImmediate(1, 'LOOP')).toThrow(/pertenece al segmento \.text/);
    });
  });

  describe('parseLabel', () => {
    it('resolves a .text label to its instruction index (address / 4)', () => {
      SymbolTable.add('LOOP', 104, 'TEXT');
      expect(parseLabel(1, 'LOOP')).toBe(26);
    });

    it('rejects a .data label used as a jump target', () => {
      SymbolTable.add('VALOR', 40, 'DATA');
      expect(() => parseLabel(1, 'VALOR')).toThrow(/no puede usarse como destino de salto/);
    });

    it('throws when the label is not defined', () => {
      expect(() => parseLabel(1, 'MISSING')).toThrow(/no definida/);
    });
  });
});
