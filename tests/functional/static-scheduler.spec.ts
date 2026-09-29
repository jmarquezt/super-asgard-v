import { TestBed } from '@angular/core/testing';
import { AsgStaticSchedulerService, StaticSchedulerConfig } from '../../src/app/core/services/assembly/asg.static-scheduler';
import { AsgConfigService } from '../../src/app/core/services/asg.config';
import { assembleAndRun, freshTestBed } from './run-program';

// AsgStaticSchedulerService reordena/desenrolla/rellena delay slots de un programa ya escrito.
// La propiedad que de verdad importa comprobar es que NUNCA cambia el resultado arquitectónico
// final del programa (registros/memoria): las optimizaciones deben ser semánticamente transparentes.
// Por eso estos tests ejecutan el programa ORIGINAL y el OPTIMIZADO por separado y comparan su
// estado final, en vez de intentar predecir a mano el reordenamiento exacto que elige el scheduler.
const NO_OPTS: StaticSchedulerConfig = {
  enableScheduling: false,
  enableUnrolling: false,
  unrollFactor: 1,
  enableRegisterRenaming: false,
  enableDelayedBranch: false,
};

describe('AsgStaticSchedulerService', () => {
  beforeEach(() => freshTestBed());

  it('no modifica el código cuando todas las optimizaciones están desactivadas', () => {
    const scheduler = TestBed.inject(AsgStaticSchedulerService);
    const source = 'ADDI R1, R0, #10\nADDI R2, R0, #20\n';

    const result = scheduler.optimize(source, NO_OPTS);

    expect(result.error).toBeUndefined();
    expect(result.reorderedCount).toBe(0);
    expect(result.insertedCount).toBe(0);
    expect(result.lines.every(l => l.status === 'unchanged')).toBe(true);
  });

  it('el reordenamiento (scheduling) conserva el resultado final del programa', () => {
    const scheduler = TestBed.inject(AsgStaticSchedulerService);
    const source = `
      .data
      .align 3
      A: .double 10.5
      B: .double 2.5
      C: .double 5.0
      X: .double 0.0

      .text
      main:
          ld f2, A
          ld f4, B
          multd f6, f2, f4
          addi r1, r0, #100
          addi r2, r0, #200
          ld f8, C
          addd f10, f6, f8
          sd X, f10
    `;

    const result = scheduler.optimize(source, { ...NO_OPTS, enableScheduling: true });
    expect(result.error).toBeUndefined();

    // assembleAndRun devuelve el mismo procesador "singleton" mientras no se resetee el TestBed,
    // así que hay que capturar los valores de cada ejecución antes de lanzar la siguiente (si no,
    // "original" y "optimized" acabarían siendo literalmente el mismo objeto mutado dos veces).
    const originalProcessor = assembleAndRun(source);
    const original = {
      r1: originalProcessor.getRegisters()[1],
      r2: originalProcessor.getRegisters()[2],
      x: originalProcessor.dataMemory.read(24, 8),
    };

    freshTestBed();
    const optimizedProcessor = assembleAndRun(result.code);
    expect(optimizedProcessor.getRegisters()[1]).toBe(original.r1);
    expect(optimizedProcessor.getRegisters()[2]).toBe(original.r2);
    expect(optimizedProcessor.dataMemory.read(24, 8)).toBe(original.x);
  });

  it('el desenrollado de bucles (unrolling) conserva el resultado final del programa', () => {
    const scheduler = TestBed.inject(AsgStaticSchedulerService);
    // Bucle correcto (a diferencia de opt_unrolling.s) que sí indexa por el puntero: suma los 4
    // elementos de "arr" en el acumulador doble f4. Resultado esperado: 1+2+3+4 = 10.0.
    // La etiqueta va pegada a la PRIMERA instrucción del cuerpo (en vez de en su propia línea), y
    // se añaden un R10 y un V1 que se escriben pero nunca se leen dentro del bucle: los tres
    // detalles ejercitan ramas del renombrado compacto del unroller que de otro modo no se
    // alcanzan (quitar la etiqueta al clonar la 1ª línea en f>0, y el mapeo de registros de tipo
    // R y de tipo V). El LV es puramente decorativo (su resultado no se usa en ningún cálculo),
    // así que no interfiere con la detección de puntero/stride del bucle, que sigue basándose en
    // el LD (SÍ reconocido por el unroller) — LV/SV no lo están, por eso no puede ser la
    // instrucción que fija el puntero del bucle.
    const source = `
      .data
      .align 3
      arr: .double 1.0, 2.0, 3.0, 4.0

      .text
      main:
          addi r1, r0, arr      ; r1 = dirección de arr
          addi r6, r0, #32      ; límite = arr + 32 (justo pasado el último elemento)
          addi r9, r0, #0
          movi2fp f4, r9
          cvti2d f4, f4          ; acumulador = 0.0
      loop: ld f2, 0(r1)
          addi r10, r0, #1      ; temporal entero puramente local a la iteración (candidato a renombrado tipo R)
          lv v1, 0(r1)          ; temporal vectorial puramente local, nunca leído (candidato a renombrado tipo V)
          addd f4, f4, f2
          addi r1, r1, #8
          sub r7, r1, r6
          bnez r7, loop
    `;

    const result = scheduler.optimize(source, { ...NO_OPTS, enableUnrolling: true, unrollFactor: 2 });
    expect(result.error).toBeUndefined();

    const originalProcessor = assembleAndRun(source);
    const originalAcc = originalProcessor.getFloatValue(4, true);

    freshTestBed();
    const optimizedProcessor = assembleAndRun(result.code);
    expect(optimizedProcessor.getFloatValue(4, true)).toBeCloseTo(originalAcc);
    expect(optimizedProcessor.getFloatValue(4, true)).toBeCloseTo(10);
  });

  it('el renombrado de registros conserva el resultado cuando el bloque contiene un salto en medio', () => {
    // applyRegisterRenaming() cierra el bloque actual y lo empuja SIN renombrar en cuanto
    // encuentra un salto (rama antes sin cubrir): comprobamos que ese camino tampoco altera
    // el resultado final del programa.
    const scheduler = TestBed.inject(AsgStaticSchedulerService);
    const source = `
      .text
      main:
          addi r1, r0, #1
          addi r2, r1, #1
          j skip
          addi r3, r0, #99
      skip:
          addi r4, r0, #2
          addi r4, r4, #3
    `;

    const result = scheduler.optimize(source, { ...NO_OPTS, enableRegisterRenaming: true });
    expect(result.error).toBeUndefined();

    const originalProcessor = assembleAndRun(source);
    const original = {
      r1: originalProcessor.getRegisters()[1],
      r2: originalProcessor.getRegisters()[2],
      r4: originalProcessor.getRegisters()[4],
    };

    freshTestBed();
    const optimizedProcessor = assembleAndRun(result.code);
    expect(optimizedProcessor.getRegisters()[1]).toBe(original.r1);
    expect(optimizedProcessor.getRegisters()[2]).toBe(original.r2);
    expect(optimizedProcessor.getRegisters()[4]).toBe(original.r4);
  });

  it('el relleno del delay slot inserta un NOP cuando ningún candidato es seguro de mover (todos dependen del salto)', () => {
    // Encadenamos 4 ADDI que leen y escriben el mismo registro que usa el salto: cada candidato
    // hacia atrás resulta inseguro (hasDependency === true en algún punto de la cadena hasta el
    // propio salto), así que applyDelayedBranchFilling() debe agotar los 4 intentos y caer en la
    // rama de "insertar NOP explícito" en vez de mover ninguna instrucción.
    const scheduler = TestBed.inject(AsgStaticSchedulerService);
    const source = `
      .text
      main:
          addi r5, r0, #1
          addi r5, r5, #1
          addi r5, r5, #1
          addi r5, r5, #1
          beqz r5, end
          addi r9, r0, #1
      end:
          addi r8, r0, #2
    `;

    const result = scheduler.optimize(source, { ...NO_OPTS, enableDelayedBranch: true });
    expect(result.error).toBeUndefined();
    expect(result.insertedCount).toBeGreaterThan(0);
    expect(result.code).toContain('NOP');

    const originalProcessor = assembleAndRun(source);
    const original = { r5: originalProcessor.getRegisters()[5], r8: originalProcessor.getRegisters()[8] };

    freshTestBed();
    TestBed.inject(AsgConfigService).updateConfig({ enableBranchDelaySlot: true });
    const optimizedProcessor = assembleAndRun(result.code);
    expect(optimizedProcessor.getRegisters()[5]).toBe(original.r5);
    expect(optimizedProcessor.getRegisters()[8]).toBe(original.r8);
  });

  it('el relleno del delay slot mueve una instrucción independiente tras el salto sin cambiar el resultado', () => {
    const scheduler = TestBed.inject(AsgStaticSchedulerService);
    const source = `
      .text
      main:
          addi r1, r0, #10
          addi r2, r0, #20
          add r3, r1, r2
          j end
      end:
          addi r4, r0, #1
    `;

    const result = scheduler.optimize(source, { ...NO_OPTS, enableDelayedBranch: true });
    expect(result.error).toBeUndefined();
    expect(result.reorderedCount + result.insertedCount).toBeGreaterThan(0);

    const originalProcessor = assembleAndRun(source);
    const original = { r3: originalProcessor.getRegisters()[3], r4: originalProcessor.getRegisters()[4] };

    // El código con el delay slot relleno solo es semánticamente correcto si el procesador
    // sabe que debe ejecutar SIEMPRE la instrucción que sigue al salto.
    freshTestBed();
    TestBed.inject(AsgConfigService).updateConfig({ enableBranchDelaySlot: true });
    const optimizedProcessor = assembleAndRun(result.code);

    expect(optimizedProcessor.getRegisters()[3]).toBe(original.r3);
    expect(optimizedProcessor.getRegisters()[4]).toBe(original.r4);
  });
});
