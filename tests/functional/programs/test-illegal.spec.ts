import { assembleAndRun, freshTestBed } from '../run-program';

// Programa raíz: test_illegal.asm
//
// A propósito NO se prueba con runAcrossMachines/las 5 configuraciones de máquina: el procesador
// segmentado NO lanza una excepción por PC fuera de rango, doIF() simplemente deja de buscar
// instrucciones cuando `instructionsMemory.at(pc)` es undefined (ver asg.pipelined.processor.ts,
// doIF), así que el programa termina en silencio con el PC "colgado" en 0x7000 en vez de saltar a
// __mem_bounds_handler / __illegal_instr_handler. Esto es un detalle de la etapa IF del pipelined,
// no una garantía de la ISA — el monociclo o el superescalar podrían (¿deberían?) lanzar una
// excepción real ante esto, así que fijar aquí una comparación entre procesadores daría un falso
// positivo o negativo según cuál sea "correcto". Se deja como test específico del pipelined.
describe('test_illegal.asm', () => {
  beforeEach(() => freshTestBed());

  it('deja de buscar instrucciones y termina sin excepción al saltar fuera de rango', () => {
    const processor = assembleAndRun(`
      .text

      main:
          addi r1, r0, #0x7000
          jr   r1
          trap 0

      __illegal_instr_handler:
      __mem_bounds_handler:
          addi r1, r0, msg_exc
          addi r10, r0, p_print
          sw   0(r10), r1
          addi r14, r0, p_print
          trap 5
          trap 0

      .data
      .align 2
      msg_exc: .ascii "¡MANEJADOR: Error de ejecución (PC fuera de límites o ilegal) detectado!\\n"
      .align 2
      p_print: .word 0
    `);

    expect(processor.getRegisters()[1]).toBe(0x7000);
    expect(processor.cause()).toBe('');
    expect(processor.consoleOutput()).toEqual([]);
  });
});
