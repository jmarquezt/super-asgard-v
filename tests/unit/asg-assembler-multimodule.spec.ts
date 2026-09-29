import { TestBed } from '@angular/core/testing';
import { AsgAssemblerService } from '../../src/app/core/services/assembly/asg.assembler';
import { SymbolTable } from '../../src/app/core/models/asg.symbol-table';

describe('AsgAssemblerService — ensamblado multi-módulo', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('una etiqueta declarada .global en un módulo es visible (sin prefijo) desde otro módulo', () => {
    const assembler = TestBed.inject(AsgAssemblerService);

    const result = assembler.assembleProgram([
      { name: 'lib', source: '.text\n.global shared\nshared: ADDI R1, R0, #1\nRFE' },
      { name: 'main', source: '.text\nJ shared' },
    ]);

    expect(result.success).toBe(true);
    // La etiqueta global NO se renombra con el prefijo de módulo.
    expect(SymbolTable.get('shared')).toBeDefined();
  });

  it('dos módulos pueden usar el mismo nombre de etiqueta LOCAL sin colisionar', () => {
    const assembler = TestBed.inject(AsgAssemblerService);

    const result = assembler.assembleProgram([
      { name: 'm0', source: '.text\nloop: ADDI R1, R0, #1\nBNEZ R1, loop' },
      { name: 'm1', source: '.text\nloop: ADDI R2, R0, #2\nBNEZ R2, loop' },
    ]);

    expect(result.success).toBe(true);
    // Cada módulo tiene su propia "loop" renombrada internamente con su propio prefijo.
    expect(SymbolTable.get('__m0__loop')).toBeDefined();
    expect(SymbolTable.get('__m1__loop')).toBeDefined();
    // El nombre sin prefijo (ambiguo entre los dos módulos) no debe existir como tal.
    expect(SymbolTable.get('loop')).toBeUndefined();
  });

  it('referenciar una etiqueta que no es global ni está definida en el propio módulo falla al ensamblar', () => {
    const assembler = TestBed.inject(AsgAssemblerService);

    const result = assembler.assembleProgram([
      { name: 'lib', source: '.text\nsecret: ADDI R1, R0, #1\nRFE' }, // "secret" es local a "lib", no .global
      { name: 'main', source: '.text\nJ secret' },
    ]);

    expect(result.success).toBe(false);
    expect(result.message).toContain('no definida');
  });

  it('un error en el 2º módulo reporta el número de línea LOCAL a ese módulo, no el global acumulado', () => {
    const assembler = TestBed.inject(AsgAssemblerService);

    const MOD0 = '.text\nADDI R1, R0, #1'; // 2 líneas
    const MOD1 = '.text\nOPCODE_INEXISTENTE R1'; // el error está en la línea 2 DE ESTE módulo

    const result = assembler.assembleProgram([
      { name: 'm0', source: MOD0 },
      { name: 'm1', source: MOD1 },
    ]);

    expect(result.success).toBe(false);
    expect(result.errorModule).toBe(1);
    // Línea global real: 4 (líneas de m0) + 2 (línea local del error en m1) = 4.
    expect(result.errorLine).toBe(4);
    // El mensaje debe usar la línea LOCAL (2), no la global (4).
    expect(result.message).toContain('Línea 2:');
    expect(result.message).not.toContain('Línea 4:');
  });

  it('un error en el 1er módulo reporta errorModule=0 con la línea global tal cual', () => {
    const assembler = TestBed.inject(AsgAssemblerService);

    const result = assembler.assembleProgram([
      { name: 'm0', source: '.text\nOPCODE_INEXISTENTE R1' },
      { name: 'm1', source: '.text\nADDI R1, R0, #1' },
    ]);

    expect(result.success).toBe(false);
    expect(result.errorModule).toBe(0);
    expect(result.message).toContain('Línea 2:');
  });
});
