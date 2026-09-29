import { TestBed } from '@angular/core/testing';
import { AsgConfigService } from '../../src/app/core/services/asg.config';
import { DEFAULT_SUPERSCALAR_CONFIG, SUPERSCALAR_PRESETS, DEFAULT_LATENCIES, BranchPredictionStrategy } from '../../src/app/core/models/asg.config';
import { assembleAndRun, assembleAndRunSuperscalar, freshTestBed } from './run-program';

// Este fichero cubre la matriz de opciones de configuración (asg.config.ts): forwarding,
// estrategia de predicción de saltos, carriles vectoriales / chaining, latencias personalizadas
// y, para el superescalar, tipo de estaciones de reserva / ancho de emisión / nº de unidades
// funcionales. En todos los casos la propiedad que se comprueba es la misma: cambiar estas
// opciones solo puede afectar al RENDIMIENTO (ciclos, stalls, aciertos de predicción...), NUNCA
// al resultado arquitectónico final de un programa correcto.

const RAW_HAZARD_SOURCE = `
  .text
  ADDI R1, R0, #10
  ADDI R2, R0, #5
  MULT R3, R1, R2
  ADD  R4, R3, R1
`;

const FORWARDING_SOURCE = `
  .text
  ADDI R2, R0, #4
  ADDI R3, R0, #6
  ADDI R5, R0, #1
  ADD  R1, R2, R3
  SUB  R4, R1, R5
`;

// Bucle con 5 iteraciones: el salto de vuelta (BNEZ ... LOOP) se toma 4 veces y no se toma la 5ª
// (la de salida), así que sirve para observar diferencias de acierto/fallo entre predictores.
const LOOP_SOURCE = `
  .text
  ADDI R1, R0, #5
  ADDI R2, R0, #1
  ADDI R3, R0, #1
  LOOP:
  SEQI R3, R1, #1
  BNEZ R3, END
  MULT R2, R2, R1
  SUBI R1, R1, #1
  J    LOOP
  END:
`;

const DAXPY_SOURCE = `
  .data
  .align 3
  val_a:    .double 2.0
  vector_x: .double 1.0, 2.0, 3.0, 4.0
  vector_y: .double 10.0, 10.0, 10.0, 10.0

  .text
  main:
      addi r1, r0, #4
      movi2s VLR, r1
      ld    f0, val_a
      lv    v1, vector_x
      lv    v2, vector_y
      multsv v3, f0, v1
      addv  v2, v3, v2
      sv    vector_y, v2
`;

describe('Matriz de configuración — forwarding', () => {
  beforeEach(() => freshTestBed());

  it('con forwarding (por defecto) resuelve la dependencia sin necesitar un stall RAW', () => {
    const processor = assembleAndRun(FORWARDING_SOURCE);
    expect(processor.getRegisters()[1]).toBe(10);
    expect(processor.getRegisters()[4]).toBe(9);
    expect(processor.stats().rawStalls).toBe(0);
  });

  it('sin forwarding llega al mismo resultado, pero generando un stall RAW', () => {
    TestBed.inject(AsgConfigService).updateConfig({ enableForwarding: false });
    const processor = assembleAndRun(FORWARDING_SOURCE);
    expect(processor.getRegisters()[1]).toBe(10);
    expect(processor.getRegisters()[4]).toBe(9);
    expect(processor.stats().rawStalls).toBeGreaterThan(0);
  });
});

describe('Matriz de configuración — predicción de saltos', () => {
  beforeEach(() => freshTestBed());

  const strategies: BranchPredictionStrategy[] = ['none', 'always-taken', 'btfn', '1-bit', '2-bit', 'gshare', 'hybrid', 'ras'];

  it.each(strategies)('con la estrategia "%s" el resultado final es siempre 5! = 120, prediga bien o mal', (strategy) => {
    TestBed.inject(AsgConfigService).updateConfig({ branchPredictionStrategy: strategy });
    const processor = assembleAndRun(LOOP_SOURCE);
    expect(processor.getRegisters()[1]).toBe(1);
    expect(processor.getRegisters()[2]).toBe(120);
  });

  it('"always-taken" acierta las vueltas del bucle (el salto de retroceso se toma casi siempre)', () => {
    TestBed.inject(AsgConfigService).updateConfig({ branchPredictionStrategy: 'always-taken' });
    const processor = assembleAndRun(LOOP_SOURCE);
    // 4 de las 5 iteraciones SÍ toman el salto de vuelta: con "always-taken" deberían acertar.
    expect(processor.stats().branchHits).toBeGreaterThan(0);
  });

  it('"none" falla la predicción en las vueltas del bucle (siempre predice no-tomado)', () => {
    TestBed.inject(AsgConfigService).updateConfig({ branchPredictionStrategy: 'none' });
    const processor = assembleAndRun(LOOP_SOURCE);
    expect(processor.stats().branchMisses).toBeGreaterThan(0);
  });
});

describe('Matriz de configuración — carriles vectoriales y chaining', () => {
  beforeEach(() => freshTestBed());

  it.each([1, 2, 4, 8])('con aluLanes=%i el resultado vectorial es correcto (Y[0] = 2*1 + 10 = 12)', (aluLanes) => {
    TestBed.inject(AsgConfigService).updateConfig({ aluLanes, memLanes: aluLanes });
    const processor = assembleAndRun(DAXPY_SOURCE);
    expect(processor.dataMemory.read(40, 8)).toBe(12);
  });

  it('con vector chaining desactivado el resultado sigue siendo correcto', () => {
    TestBed.inject(AsgConfigService).updateConfig({ enableVectorChaining: false });
    const processor = assembleAndRun(DAXPY_SOURCE);
    expect(processor.dataMemory.read(40, 8)).toBe(12);
  });

  it('con vector chaining activado (por defecto) el resultado también es correcto', () => {
    TestBed.inject(AsgConfigService).updateConfig({ enableVectorChaining: true });
    const processor = assembleAndRun(DAXPY_SOURCE);
    expect(processor.dataMemory.read(40, 8)).toBe(12);
  });
});

describe('Matriz de configuración — latencias personalizadas', () => {
  beforeEach(() => freshTestBed());

  it('con MULT a 1 ciclo el resultado es correcto y el programa termina en menos ciclos', () => {
    TestBed.inject(AsgConfigService).updateConfig({ latencies: { ...DEFAULT_LATENCIES, intMul: 1 } });
    const processor = assembleAndRun(RAW_HAZARD_SOURCE);
    expect(processor.getRegisters()[3]).toBe(50);
    expect(processor.getRegisters()[4]).toBe(60);
    expect(processor.cycle()).toBeLessThan(15);
  });

  it('con MULT a 20 ciclos el resultado sigue siendo correcto (solo tarda más)', () => {
    TestBed.inject(AsgConfigService).updateConfig({ latencies: { ...DEFAULT_LATENCIES, intMul: 20 } });
    const processor = assembleAndRun(RAW_HAZARD_SOURCE, { maxCycles: 200 });
    expect(processor.getRegisters()[3]).toBe(50);
    expect(processor.getRegisters()[4]).toBe(60);
    expect(processor.cycle()).toBeGreaterThan(20);
  });
});

describe('Matriz de configuración — superescalar (RS, unidades funcionales, ancho de emisión)', () => {
  beforeEach(() => freshTestBed());

  it.each(Object.keys(SUPERSCALAR_PRESETS))('con el preset "%s" el resultado es correcto', (presetName) => {
    TestBed.inject(AsgConfigService).updateConfig({
      superscalar: { ...DEFAULT_SUPERSCALAR_CONFIG, ...SUPERSCALAR_PRESETS[presetName] },
    });
    const processor = assembleAndRunSuperscalar(LOOP_SOURCE, { maxCycles: 20000 });
    expect(processor.getRegisters()[1]).toBe(1);
    expect(processor.getRegisters()[2]).toBe(120);
  });

  it.each([1, 2, 4, 8] as const)('con issueWidth=%i el resultado es correcto', (issueWidth) => {
    TestBed.inject(AsgConfigService).updateConfig({
      superscalar: { ...DEFAULT_SUPERSCALAR_CONFIG, issueWidth },
    });
    const processor = assembleAndRunSuperscalar(RAW_HAZARD_SOURCE, { maxCycles: 20000 });
    expect(processor.getRegisters()[3]).toBe(50);
    expect(processor.getRegisters()[4]).toBe(60);
  });

  it.each(['centralized', 'distributed', 'clustered'] as const)('con estaciones de reserva "%s" el resultado es correcto', (rsType) => {
    TestBed.inject(AsgConfigService).updateConfig({
      superscalar: { ...DEFAULT_SUPERSCALAR_CONFIG, rsType },
    });
    const processor = assembleAndRunSuperscalar(RAW_HAZARD_SOURCE, { maxCycles: 20000 });
    expect(processor.getRegisters()[3]).toBe(50);
    expect(processor.getRegisters()[4]).toBe(60);
  });

  it('con una única ALU entera y una única unidad de multiplicación el resultado es correcto (más contención estructural)', () => {
    TestBed.inject(AsgConfigService).updateConfig({
      superscalar: { ...DEFAULT_SUPERSCALAR_CONFIG, intALUs: 1, intMulUnits: 1, memUnits: 1 },
    });
    const processor = assembleAndRunSuperscalar(LOOP_SOURCE, { maxCycles: 20000 });
    expect(processor.getRegisters()[1]).toBe(1);
    expect(processor.getRegisters()[2]).toBe(120);
  });
});
