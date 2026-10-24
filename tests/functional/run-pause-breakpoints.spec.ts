import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AsgAssemblerService } from '../../src/app/core/services/assembly/asg.assembler';
import { Type } from '@angular/core';
import { AsgProcessorService } from '../../src/app/core/services/processor/asg.processor';
import { AsgPipelinedProcessorService } from '../../src/app/core/services/processor/asg.pipelined.processor';
import { AsgNonPipelinedProcessorService } from '../../src/app/core/services/processor/asg.non-pipelined.processor';
import { freshTestBed } from './run-program';

// Todos los demás tests funcionales avanzan el procesador llamando a nextCycle() manualmente en un
// bucle síncrono. Este fichero prueba el bucle REAL que usa la interfaz: run() (basado en
// requestAnimationFrame, con `cyclesPerSecond` y `maxSpeed`), pause(), y la parada por breakpoint —
// nada de esto se ejercitaba en ningún otro test. Los fake timers de Vitest simulan también
// requestAnimationFrame (un frame cada 16 ms) y performance.now().

function loadProgram<T extends AsgProcessorService = AsgPipelinedProcessorService>(
  source: string,
  type: Type<T> = AsgPipelinedProcessorService as unknown as Type<T>,
): T {
  const assembler = TestBed.inject(AsgAssemblerService);
  const processor = TestBed.inject(type);
  TestBed.tick();
  const result = assembler.assembleProgram([{ name: 'main', source }]);
  if (!result.success) throw new Error(`Fallo de ensamblado: ${result.message}`);
  processor.load(result.instructionBinary, result.dataBuffer, result.initialCodePtr);
  return processor;
}

describe('AsgProcessorService.run() / pause() (bucle real basado en requestAnimationFrame)', () => {
  beforeEach(() => {
    freshTestBed();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('run() ejecuta el programa completo automáticamente hasta el final', () => {
    const processor = loadProgram(`
      .text
      ADDI R1, R0, #10
      ADDI R2, R0, #20
      ADD  R3, R1, R2
    `);
    processor.cyclesPerSecond.set(1000);

    processor.run();
    vi.advanceTimersByTime(5000); // tiempo de sobra para que termine

    expect(processor.isRunning()).toBe(false);
    expect(processor.finished()).toBe(true);
    expect(processor.getRegisters()[3]).toBe(30);
  });

  it('pause() detiene el avance de ciclos aunque siga pasando tiempo', () => {
    const processor = loadProgram(`
      .text
      ADDI R1, R0, #1
      ADDI R2, R0, #2
      ADDI R3, R0, #3
      ADDI R4, R0, #4
      ADDI R5, R0, #5
      ADDI R6, R0, #6
    `);
    processor.cyclesPerSecond.set(10);

    processor.run();
    vi.advanceTimersByTime(150); // ~1 ciclo a 10 Hz, no lo bastante para terminar
    expect(processor.isRunning()).toBe(true);

    processor.pause();
    const cyclesAtPause = processor.cycle();
    expect(processor.isRunning()).toBe(false);

    vi.advanceTimersByTime(10000); // mucho más tiempo, pero está en pausa
    expect(processor.cycle()).toBe(cyclesAtPause);
    expect(processor.isRunning()).toBe(false);
  });

  const EIGHT_ADDI = `
      .text
      ADDI R1, R0, #1
      ADDI R2, R0, #2
      ADDI R3, R0, #3
      ADDI R4, R0, #4
      ADDI R5, R0, #5
      ADDI R6, R0, #6
      ADDI R7, R0, #7
      ADDI R8, R0, #8
    `;

  it('cyclesPerSecond fija el ritmo: a 50 Hz, en 100 ms se ejecutan unos 5 ciclos repartidos en varios frames', () => {
    const processor = loadProgram(EIGHT_ADDI);
    processor.cyclesPerSecond.set(50);

    processor.run();
    vi.advanceTimersByTime(100);

    expect(processor.cycle()).toBeGreaterThanOrEqual(3);
    expect(processor.cycle()).toBeLessThanOrEqual(6);
    expect(processor.isRunning()).toBe(true);
    processor.pause();
  });

  it('cambiar cyclesPerSecond en marcha se aplica sin reiniciar run()', () => {
    const processor = loadProgram(EIGHT_ADDI);
    processor.cyclesPerSecond.set(0.5);

    processor.run();
    vi.advanceTimersByTime(100);
    expect(processor.cycle()).toBe(0);

    processor.cyclesPerSecond.set(1000);
    vi.advanceTimersByTime(1000);
    expect(processor.finished()).toBe(true);
  });

  it('maxSpeed ejecuta el programa entero en el primer frame', () => {
    const processor = loadProgram(EIGHT_ADDI);
    processor.cyclesPerSecond.set(0.5);
    processor.maxSpeed.set(true);

    processor.run();
    vi.advanceTimersByTime(20); // un solo frame

    expect(processor.finished()).toBe(true);
    expect(processor.getRegisters()[8]).toBe(8);
  });

  it('un breakpoint detiene run() antes de llegar a esa línea, y se puede continuar tras quitarlo', () => {
    const processor = loadProgram(`
      .text
      ADDI R1, R0, #10
      ADDI R2, R0, #20
      ADDI R3, R0, #30
    `);
    processor.cyclesPerSecond.set(1000);

    // Sin mapa PC->línea real de editor, se usa el fallback (pc/4)+1.
    // La 2ª instrucción (ADDI R2) está en pc=104 -> línea 27.
    const lineOfSecondInstruction = 104 / 4 + 1;
    processor.setBreakpointLines([lineOfSecondInstruction]);

    processor.run();
    vi.advanceTimersByTime(5000); // tiempo de sobra para terminar SI NO hubiera breakpoint

    expect(processor.isRunning()).toBe(false);
    expect(processor.finished()).toBe(false); // se paró por el breakpoint, no por terminar
    // Para justo tras capturar la instrucción marcada: ciclo 1 captura ADDI R1, ciclo 2 captura ADDI R2
    expect(processor.cycle()).toBe(2);

    // "Continuar" con el breakpoint puesto: no vuelve a parar en la misma instrucción y termina
    processor.run();
    vi.advanceTimersByTime(5000);

    expect(processor.finished()).toBe(true);
    const regs = processor.getRegisters();
    expect(regs[1]).toBe(10);
    expect(regs[2]).toBe(20);
    expect(regs[3]).toBe(30);
  });

  it('no segmentado: el breakpoint para justo al capturar la instrucción marcada (no durante la anterior) y se puede continuar', () => {
    const processor = loadProgram(`
      .text
      ADDI R1, R0, #10
      ADDI R2, R0, #20
      ADDI R3, R0, #30
    `, AsgNonPipelinedProcessorService);
    processor.cyclesPerSecond.set(1000);

    // Sin mapa PC->línea, la 3ª instrucción (ADDI R3, pc=108) corresponde a la línea (108/4)+1
    processor.setBreakpointLines([108 / 4 + 1]);

    processor.run();
    vi.advanceTimersByTime(5000);

    expect(processor.isRunning()).toBe(false);
    expect(processor.finished()).toBe(false);
    // La instrucción anterior ha terminado del todo y la marcada aún no se ha ejecutado
    expect(processor.getRegisters()[2]).toBe(20);
    expect(processor.getRegisters()[3]).toBe(0);

    // "Continuar" con el breakpoint puesto: no vuelve a parar en la misma instrucción y termina
    processor.run();
    vi.advanceTimersByTime(5000);

    expect(processor.finished()).toBe(true);
    expect(processor.getRegisters()[3]).toBe(30);
  });

  it('un breakpoint dentro de un bucle para en cada vuelta en que se vuelve a capturar la instrucción', () => {
    const processor = loadProgram(`
      .text
      ADDI R1, R0, #3
    BUCLE:
      SUBI R1, R1, #1
      ADDI R2, R2, #1
      BNEZ R1, BUCLE
    `);
    processor.cyclesPerSecond.set(1000);
    // ADDI R2 está en pc=108 -> línea (108/4)+1
    processor.setBreakpointLines([108 / 4 + 1]);

    let stops = 0;
    for (let i = 0; i < 10 && !processor.finished(); i++) {
      processor.run();
      vi.advanceTimersByTime(5000);
      if (!processor.finished()) stops++;
    }

    expect(processor.finished()).toBe(true);
    expect(stops).toBe(3);
    expect(processor.getRegisters()[2]).toBe(3);
  });

  it('toggleBreakpoint añade y quita una línea de la lista de breakpoints', () => {
    const processor = loadProgram('.text\nADDI R1, R0, #1');
    expect(processor.getBreakpoints()).toEqual([]);

    processor.toggleBreakpoint(26);
    expect(processor.getBreakpoints()).toEqual([26]);

    processor.toggleBreakpoint(26);
    expect(processor.getBreakpoints()).toEqual([]);
  });
});
