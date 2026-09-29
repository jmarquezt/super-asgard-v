import { runAcrossMachines } from '../run-program';

// Programa raíz: test-loop-unrolling.asm
// Encadena 14 sumas dobladas: F4 empieza en 0.0, cada iteración lee el double recién
// escrito por la anterior y lo duplica, arrancando desde el valor 5.0 guardado en 0x70 (112).
describe('test-loop-unrolling.asm', () => {
  runAcrossMachines(
    'duplica el acumulador 13 veces a partir de 5.0, en cualquier configuración de máquina',
    `
      .data 112
      .double 5.0
      .text
      ADDI R1, R1, #112
      inicio: LD F0, 0(R1)
      ADDD F4,F0,F4
      SUBI R1,R1,#8
      SD 0(R1),F4
      BNEZ R1,inicio
    `,
    (processor) => {
      expect(processor.getRegisters()[1]).toBe(0);
      expect(processor.getFloatValue(4, true)).toBe(5 * 2 ** 13);
    },
  );
});
