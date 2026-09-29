import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AsgAssemblerService, SourceModule } from '../../src/app/core/services/assembly/asg.assembler';
import { AsgConfigService } from '../../src/app/core/services/asg.config';
import { AsgConfig } from '../../src/app/core/models/asg.config';
import { AsgProcessorService } from '../../src/app/core/services/processor/asg.processor';
import { AsgPipelinedProcessorService } from '../../src/app/core/services/processor/asg.pipelined.processor';
import { AsgNonPipelinedProcessorService } from '../../src/app/core/services/processor/asg.non-pipelined.processor';
import { AsgSuperscalarProcessorService } from '../../src/app/core/services/processor/asg.superscalar.processor';

export interface RunOptions {
  /** Límite de ciclos de seguridad antes de considerar que el programa se ha colgado. */
  maxCycles?: number;
  /** Tamaño de la memoria de datos, para programas que usan direcciones grandes (ej. ".data 0x1000"). */
  memorySize?: number;
  /**
   * Respuestas a entregar en orden cada vez que el programa pide entrada por teclado (TRAP 3).
   * Simula lo que el usuario teclearía en la consola del simulador.
   */
  stdin?: string[];
}

/**
 * Ensambla y ejecuta un programa Asgard-V completo (uno o varios módulos) sobre el procesador
 * indicado (`processorType`, por defecto el segmentado/pipelined), hasta que termina o se alcanza
 * el límite de ciclos de seguridad de la prueba. Resuelve automáticamente las peticiones de lectura
 * por teclado (TRAP 3) con `options.stdin`.
 */
export function assembleAndRunOn<T extends AsgProcessorService>(
  processorType: Type<T>,
  source: string | SourceModule[],
  options: RunOptions = {},
): T {
  const { maxCycles = 5000, memorySize, stdin = [] } = options;

  // El tamaño de memoria debe fijarse ANTES de inyectar el procesador: su constructor
  // lee `getCurrentConfig().memorySize` una única vez para crear la memoria de datos.
  if (memorySize !== undefined) {
    TestBed.inject(AsgConfigService).updateConfig({ memorySize });
  }

  const assembler = TestBed.inject(AsgAssemblerService);
  const processor = TestBed.inject(processorType);

  // El constructor de AsgProcessorService registra un effect() que, en su primera ejecución
  // (asíncrona por defecto), llama a reset() al leer la config actual. Si esa primera ejecución
  // se retrasase hasta mitad de la prueba podría borrar el estado ya cargado/ejecutado. Forzamos
  // aquí su único disparo (inocuo: reset() a este punto coincide con el estado inicial) para que
  // no pueda volver a dispararse más tarde, sin necesidad de que la prueba sea asíncrona.
  TestBed.tick();

  const modules: SourceModule[] = typeof source === 'string' ? [{ name: 'main', source }] : source;
  const result = assembler.assembleProgram(modules);
  if (!result.success) {
    throw new Error(`Fallo de ensamblado: ${result.message} (línea ${result.errorLine})`);
  }

  processor.load(result.instructionBinary, result.dataBuffer, result.initialCodePtr);

  const pendingInputs = [...stdin];
  let cycles = 0;
  while (!processor.isFinished() && cycles < maxCycles) {
    processor.nextCycle();
    cycles++;

    if (processor.trapStdinRequest()) {
      if (pendingInputs.length === 0) {
        throw new Error('El programa pidió entrada por teclado (TRAP 3) pero no se proporcionó "stdin" suficiente');
      }
      processor.resolveTrapStdin(pendingInputs.shift()!);
    }
  }

  if (!processor.isFinished()) {
    throw new Error(`El programa no terminó tras ${maxCycles} ciclos (posible bucle infinito)`);
  }

  return processor;
}

/** Atajo de assembleAndRunOn para el procesador segmentado (pipelined), el más usado en las pruebas. */
export function assembleAndRun(
  source: string | SourceModule[],
  options: RunOptions = {},
): AsgPipelinedProcessorService {
  return assembleAndRunOn(AsgPipelinedProcessorService, source, options);
}

/** Atajo de assembleAndRunOn para el procesador monociclo (no segmentado). */
export function assembleAndRunNonPipelined(
  source: string | SourceModule[],
  options: RunOptions = {},
): AsgNonPipelinedProcessorService {
  return assembleAndRunOn(AsgNonPipelinedProcessorService, source, options);
}

/** Atajo de assembleAndRunOn para el procesador superescalar. */
export function assembleAndRunSuperscalar(
  source: string | SourceModule[],
  options: RunOptions = {},
): AsgSuperscalarProcessorService {
  return assembleAndRunOn(AsgSuperscalarProcessorService, source, options);
}

/**
 * Igual que assembleAndRun, pero se detiene en cuanto el programa pide la primera entrada por
 * teclado (TRAP 3), sin resolverla. Útil como "smoke test" de programas interactivos muy grandes,
 * para comprobar que la inicialización se ejecuta sin excepciones antes de pedir datos al usuario.
 */
export function assembleAndRunUntilFirstInput(
  source: string | SourceModule[],
  options: Omit<RunOptions, 'stdin'> = {},
): AsgPipelinedProcessorService {
  const { maxCycles = 20000, memorySize } = options;

  if (memorySize !== undefined) {
    TestBed.inject(AsgConfigService).updateConfig({ memorySize });
  }

  const assembler = TestBed.inject(AsgAssemblerService);
  const processor = TestBed.inject(AsgPipelinedProcessorService);

  // Ver el comentario equivalente en assembleAndRun: forzamos el único disparo del effect
  // del constructor antes de cargar el programa real.
  TestBed.tick();

  const modules: SourceModule[] = typeof source === 'string' ? [{ name: 'main', source }] : source;
  const result = assembler.assembleProgram(modules);
  if (!result.success) {
    throw new Error(`Fallo de ensamblado: ${result.message} (línea ${result.errorLine})`);
  }

  processor.load(result.instructionBinary, result.dataBuffer, result.initialCodePtr);

  let cycles = 0;
  while (!processor.isFinished() && !processor.trapStdinRequest() && cycles < maxCycles) {
    processor.nextCycle();
    cycles++;
  }

  if (!processor.isFinished() && !processor.trapStdinRequest()) {
    throw new Error(`El programa no llegó a pedir entrada ni terminó tras ${maxCycles} ciclos`);
  }

  return processor;
}

export function freshTestBed(): void {
  TestBed.resetTestingModule();
  localStorage.clear();
}

export interface MachineVariant {
  /** Nombre corto para el título del test generado, ej. "pipelined". */
  name: string;
  processor: Type<AsgProcessorService>;
  /** Config parcial a aplicar ANTES de instanciar el procesador (forwarding, predictor, RS...). */
  config?: Partial<AsgConfig>;
}

/**
 * Las configuraciones de máquina "de referencia" contra las que se comprueba cada programa:
 * el pipelined con y sin forwarding, con un predictor de saltos adaptativo, el monociclo
 * (non-pipelined) y el superescalar. Todas implementan la misma ISA, así que el resultado
 * arquitectónico final de un programa correcto debe ser idéntico en las cinco — solo debería
 * cambiar cuántos ciclos tarda cada una.
 */
export const DEFAULT_MACHINE_VARIANTS: MachineVariant[] = [
  { name: 'pipelined', processor: AsgPipelinedProcessorService },
  { name: 'pipelined sin forwarding', processor: AsgPipelinedProcessorService, config: { enableForwarding: false } },
  { name: 'pipelined predictor 2-bit', processor: AsgPipelinedProcessorService, config: { branchPredictionStrategy: '2-bit' } },
  { name: 'monociclo (non-pipelined)', processor: AsgNonPipelinedProcessorService },
  { name: 'superescalar', processor: AsgSuperscalarProcessorService },
];

/**
 * Genera un `it(...)` por cada variante de máquina (`variants`, por defecto DEFAULT_MACHINE_VARIANTS)
 * que ensambla y ejecuta `source` y le pasa el procesador resultante a `verify` para las
 * comprobaciones arquitectónicas (registros, memoria, consola...). Debe llamarse DENTRO de un
 * `describe(...)`, igual que cualquier `it(...)` normal — internamente hace su propio
 * `freshTestBed()` por variante, así que no hace falta (ni se debe) envolverlo en otro `it`.
 *
 * Las comprobaciones específicas de una única implementación (ej. `processor.stats()`, que solo
 * existe en el pipelined) van en un `it(...)` aparte, no aquí.
 */
export function runAcrossMachines(
  description: string,
  source: string | SourceModule[],
  verify: (processor: AsgProcessorService, variant: MachineVariant) => void,
  options: RunOptions = {},
  variants: MachineVariant[] = DEFAULT_MACHINE_VARIANTS,
): void {
  for (const variant of variants) {
    it(`${description} [${variant.name}]`, () => {
      freshTestBed();
      if (variant.config) {
        TestBed.inject(AsgConfigService).updateConfig(variant.config);
      }
      const processor = assembleAndRunOn(variant.processor, source, options);
      verify(processor, variant);
    });
  }
}
