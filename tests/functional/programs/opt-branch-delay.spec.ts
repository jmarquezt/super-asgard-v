import { runAcrossMachines } from '../run-program';

// Programa raíz: opt_branch_delay.s
describe('opt_branch_delay.s', () => {
  runAcrossMachines(
    'ejecuta la instrucción previa al salto y continúa en la etiqueta destino, en cualquier configuración de máquina',
    `
      .text
      main:
          addi r1, r0, #10
          addi r2, r0, #20

          add r3, r1, r2

          j end

      end:
          addi r4, r0, #1
          trap 0
    `,
    (processor) => {
      const regs = processor.getRegisters();
      expect(regs[3]).toBe(30);
      expect(regs[4]).toBe(1);
    },
  );
});
