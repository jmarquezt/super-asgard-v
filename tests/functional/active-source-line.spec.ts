import { vi } from 'vitest';
import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AsgAssemblerService } from '../../src/app/core/services/assembly/asg.assembler';
import { AsgConfigService } from '../../src/app/core/services/asg.config';
import { AsgProcessorService } from '../../src/app/core/services/processor/asg.processor';
import { AsgPipelinedProcessorService } from '../../src/app/core/services/processor/asg.pipelined.processor';
import { AsgNonPipelinedProcessorService } from '../../src/app/core/services/processor/asg.non-pipelined.processor';
import { AsgSuperscalarProcessorService } from '../../src/app/core/services/processor/asg.superscalar.processor';
import { freshTestBed } from './run-program';

// getActiveSourceLines() son las líneas que marca la flecha de ejecución del editor: las de las últimas
// instrucciones que han entrado al procesador. Programa sin saltos ni dependencias para que el avance
// sea predecible.
const SOURCE = `
      .text
      ADDI R1, R0, #1
      ADDI R2, R0, #2
      ADDI R3, R0, #3
      ADDI R4, R0, #4
      ADDI R5, R0, #5
      ADDI R6, R0, #6
`;

/** Carga SOURCE con el mapa PC -> línea igual que lo construye el editor; devuelve las líneas de las instrucciones en orden. */
function load<T extends AsgProcessorService>(type: Type<T>): { processor: T; lines: number[] } {
  const assembler = TestBed.inject(AsgAssemblerService);
  const processor = TestBed.inject(type);
  TestBed.tick();
  const result = assembler.assembleProgram([{ name: 'main', source: SOURCE }]);
  if (!result.success) throw new Error(`Fallo de ensamblado: ${result.message}`);

  const pcToLine = new Map<number, number>();
  result.instructions.forEach(instr => pcToLine.set(instr.pc, instr.id));
  processor.load(result.instructionBinary, result.dataBuffer, result.initialCodePtr, pcToLine);

  const lines = result.instructions.filter(i => i.id > 0).sort((a, b) => a.pc - b.pc).map(i => i.id);
  return { processor, lines };
}

describe('getActiveSourceLines() (flecha de ejecución del editor)', () => {
  beforeEach(() => freshTestBed());

  it('antes de ejecutar ningún ciclo no marca ninguna línea', () => {
    const { processor } = load(AsgPipelinedProcessorService);
    expect(processor.getActiveSourceLines()).toEqual([]);
  });

  it('segmentado: marca la instrucción que acaba de entrar en IF en cada ciclo', () => {
    const { processor, lines } = load(AsgPipelinedProcessorService);

    for (let k = 0; k < lines.length; k++) {
      processor.nextCycle();
      expect(processor.getActiveSourceLines()).toEqual([lines[k]]);
    }
  });

  it('segmentado: con IF ya vacía al final del programa, marca la más joven que siga en el pipeline', () => {
    const { processor, lines } = load(AsgPipelinedProcessorService);
    for (let k = 0; k < lines.length + 1; k++) processor.nextCycle();

    expect(processor.getActiveSourceLines()).toEqual([lines[lines.length - 1]]);
  });

  it('no segmentado: mantiene la línea durante todas las etapas de la instrucción y pasa a la siguiente sin saltarse ninguna', () => {
    const { processor, lines } = load(AsgNonPipelinedProcessorService);

    processor.nextCycle();
    expect(processor.getActiveSourceLines()).toEqual([lines[0]]);
    processor.nextCycle();
    expect(processor.getActiveSourceLines()).toEqual([lines[0]]);

    const seen = [lines[0]];
    for (let c = 0; c < 200 && !processor.isFinished(); c++) {
      processor.nextCycle();
      const [line] = processor.getActiveSourceLines();
      if (line !== undefined && line !== seen[seen.length - 1]) seen.push(line);
    }
    expect(seen).toEqual(lines);
  });

  it('varios módulos: un breakpoint en el 2º módulo para en su instrucción y la línea marcada es la global de esa pestaña', () => {
    vi.useFakeTimers();
    try {
      const assembler = TestBed.inject(AsgAssemblerService);
      const processor = TestBed.inject(AsgPipelinedProcessorService);
      TestBed.tick();
      const modules = [
        { name: 'main', source: '.text\nADDI R1, R0, #1\nADDI R2, R0, #2\n' },
        { name: 'modulo_2', source: '.text\nADDI R3, R0, #3\nADDI R4, R0, #4\n' },
      ];
      const result = assembler.assembleProgram(modules);
      if (!result.success) throw new Error(`Fallo de ensamblado: ${result.message}`);

      // Igual que el editor: línea local 2 de la pestaña 1 (ADDI R3) -> línea global
      const globalLine = 2 + result.lineOffsets[1];
      const pcToLine = new Map<number, number>();
      result.instructions.forEach(instr => pcToLine.set(instr.pc, instr.id));
      expect([...pcToLine.values()]).toContain(globalLine);

      processor.load(result.instructionBinary, result.dataBuffer, result.initialCodePtr, pcToLine);
      processor.setBreakpointLines([globalLine]);
      processor.cyclesPerSecond.set(1000);

      processor.run();
      vi.advanceTimersByTime(5000);

      expect(processor.finished()).toBe(false);
      expect(processor.getActiveSourceLines()).toEqual([globalLine]);
      expect(processor.getRegisters()[2]).toBe(0); // ADDI R2 (pestaña 1) aún en el pipeline
      expect(processor.getRegisters()[3]).toBe(0);

      processor.run();
      vi.advanceTimersByTime(5000);
      expect(processor.finished()).toBe(true);
      expect(processor.getRegisters()[3]).toBe(3);
      expect(processor.getRegisters()[4]).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('superescalar: marca a la vez todas las instrucciones capturadas en el ciclo (hasta el ancho de emisión)', () => {
    const issueWidth = TestBed.inject(AsgConfigService).getCurrentConfig().superscalar.issueWidth;
    const { processor, lines } = load(AsgSuperscalarProcessorService);

    let first: number[] = [];
    for (let c = 0; c < 10 && first.length === 0; c++) {
      processor.nextCycle();
      first = processor.getActiveSourceLines();
    }

    expect(first).toEqual(lines.slice(0, Math.min(issueWidth, lines.length)));
  });

  it('superescalar: a lo largo del programa marca todas las líneas, y la más joven no retrocede en código sin saltos', () => {
    const { processor, lines } = load(AsgSuperscalarProcessorService);

    const marked = new Set<number>();
    let previousYoungest = -1;
    for (let c = 0; c < 200 && !processor.isFinished(); c++) {
      processor.nextCycle();
      const active = processor.getActiveSourceLines();
      if (active.length === 0) continue;

      active.forEach(line => {
        expect(lines).toContain(line);
        marked.add(line);
      });
      // Pueden seguir en IF instrucciones de ciclos anteriores (si ID se atasca), pero la más joven solo avanza
      const youngest = active[active.length - 1];
      expect(youngest).toBeGreaterThanOrEqual(previousYoungest);
      previousYoungest = youngest;
    }
    expect([...marked].sort((a, b) => a - b)).toEqual(lines);
  });
});
