import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AsgAssemblerService } from '../../src/app/core/services/assembly/asg.assembler';
import { AsgPipelinedProcessorService } from '../../src/app/core/services/processor/asg.pipelined.processor';
import { freshTestBed } from './run-program';

// Todos los demás tests funcionales avanzan el procesador llamando a nextCycle() manualmente en un
// bucle síncrono. Este fichero prueba el bucle REAL que usa la interfaz: run() (basado en
// setInterval, con `speed` y `cyclesPerTick`), pause(), y la parada por breakpoint — nada de esto
// se ejercitaba en ningún otro test.

function loadProgram(source: string): AsgPipelinedProcessorService {
  const assembler = TestBed.inject(AsgAssemblerService);
  const processor = TestBed.inject(AsgPipelinedProcessorService);
  TestBed.tick();
  const result = assembler.assembleProgram([{ name: 'main', source }]);
  if (!result.success) throw new Error(`Fallo de ensamblado: ${result.message}`);
  processor.load(result.instructionBinary, result.dataBuffer, result.initialCodePtr);
  return processor;
}

describe('AsgProcessorService.run() / pause() (bucle real basado en setInterval)', () => {
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
    processor.speed.set(5);

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
    processor.speed.set(100);

    processor.run();
    vi.advanceTimersByTime(150); // deja pasar ~1 tick, pero no lo bastante para terminar
    expect(processor.isRunning()).toBe(true);

    processor.pause();
    const cyclesAtPause = processor.cycle();
    expect(processor.isRunning()).toBe(false);

    vi.advanceTimersByTime(10000); // mucho más tiempo, pero está en pausa
    expect(processor.cycle()).toBe(cyclesAtPause);
    expect(processor.isRunning()).toBe(false);
  });

  it('cyclesPerTick > 1 ejecuta varios ciclos en un único intervalo', () => {
    const processor = loadProgram(`
      .text
      ADDI R1, R0, #1
      ADDI R2, R0, #2
      ADDI R3, R0, #3
      ADDI R4, R0, #4
      ADDI R5, R0, #5
      ADDI R6, R0, #6
      ADDI R7, R0, #7
      ADDI R8, R0, #8
    `);
    processor.cyclesPerTick.set(5);
    processor.speed.set(100);

    processor.run();
    vi.advanceTimersByTime(100); // exactamente 1 intervalo

    expect(processor.cycle()).toBeGreaterThanOrEqual(5);
    processor.pause();
  });

  it('un breakpoint detiene run() antes de llegar a esa línea, y se puede continuar tras quitarlo', () => {
    const processor = loadProgram(`
      .text
      ADDI R1, R0, #10
      ADDI R2, R0, #20
      ADDI R3, R0, #30
    `);
    processor.speed.set(5);

    // Sin mapa PC->línea real de editor, getCurrentSourceLine() usa el fallback (pc/4)+1.
    // La 2ª instrucción (ADDI R2) está en pc=104 -> línea 27.
    const lineOfSecondInstruction = 104 / 4 + 1;
    processor.setBreakpointLines([lineOfSecondInstruction]);

    processor.run();
    vi.advanceTimersByTime(5000); // tiempo de sobra para terminar SI NO hubiera breakpoint

    expect(processor.isRunning()).toBe(false);
    expect(processor.finished()).toBe(false); // se paró por el breakpoint, no por terminar
    expect(processor.cycle()).toBeLessThan(5); // se detuvo enseguida, no ejecutó todo el programa

    // "Continuar": quitar el breakpoint y relanzar debe completar el programa con normalidad.
    processor.setBreakpointLines([]);
    processor.run();
    vi.advanceTimersByTime(5000);

    expect(processor.finished()).toBe(true);
    const regs = processor.getRegisters();
    expect(regs[1]).toBe(10);
    expect(regs[2]).toBe(20);
    expect(regs[3]).toBe(30);
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
