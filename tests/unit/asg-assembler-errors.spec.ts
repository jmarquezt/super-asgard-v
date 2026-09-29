import { TestBed } from '@angular/core/testing';
import { AsgAssemblerService } from '../../src/app/core/services/assembly/asg.assembler';

// Complementa asg-semantic-analyzer.spec.ts (que ya cubre: falta de .text, instrucción fuera de
// .text, etiqueta no definida) con más casuística de error, esta vez pasando por
// AsgAssemblerService.assembleProgram() de punta a punta en vez de invocar el analizador a mano.
describe('AsgAssemblerService — errores de ensamblado', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('detecta el solapamiento de dos bloques de .data', () => {
    const assembler = TestBed.inject(AsgAssemblerService);

    const result = assembler.assembleProgram([{
      name: 'main', source: `
        .data 0
        .word 1, 2, 3, 4, 5
        .data 2
        .word 99
        .text
        ADDI R1, R0, #1
      `,
    }]);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Solapamiento');
  });

  it('detecta el desbordamiento de la memoria de datos', () => {
    const assembler = TestBed.inject(AsgAssemblerService);

    const result = assembler.assembleProgram([{
      name: 'main', source: `
        .data 4090
        .word 1, 2, 3
        .text
        ADDI R1, R0, #1
      `,
    }]);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Desbordamiento de memoria de datos');
  });

  it('detecta un inmediato que excede los 16 bits, ensamblando el programa completo', () => {
    const assembler = TestBed.inject(AsgAssemblerService);

    const result = assembler.assembleProgram([{
      name: 'main', source: '.text\nADDI R1, R0, #70000',
    }]);

    expect(result.success).toBe(false);
    expect(result.message).toContain('excede los 16 bits');
  });

  it('detecta un código de TRAP fuera de rango (0-6) en tiempo de ensamblado', () => {
    const assembler = TestBed.inject(AsgAssemblerService);

    const result = assembler.assembleProgram([{
      name: 'main', source: '.text\nTRAP 9',
    }]);

    expect(result.success).toBe(false);
    expect(result.message).toContain('TRAP');
  });

  it('detecta un registro de doble precisión impar (F3) en tiempo de ensamblado', () => {
    const assembler = TestBed.inject(AsgAssemblerService);

    const result = assembler.assembleProgram([{
      name: 'main', source: '.text\nADDI R1, R0, #10\nMOVI2FP F3, R1\nCVTI2D F3, F3',
    }]);

    expect(result.success).toBe(false);
    expect(result.message).toContain('par');
  });

  it('detecta una directiva de datos usada fuera de .data (ej. .word dentro de .text)', () => {
    const assembler = TestBed.inject(AsgAssemblerService);

    const result = assembler.assembleProgram([{
      name: 'main', source: '.text\n.word 5',
    }]);

    expect(result.success).toBe(false);
  });

  it('un programa correcto sigue ensamblando con éxito (caso de control)', () => {
    const assembler = TestBed.inject(AsgAssemblerService);

    const result = assembler.assembleProgram([{
      name: 'main', source: '.text\nADDI R1, R0, #10',
    }]);

    expect(result.success).toBe(true);
    expect(result.message).toBe('');
    expect(result.instructions.length).toBeGreaterThan(0);
  });
});
