import { runAcrossMachines } from './run-program';

describe('Programa Factorial (bucle con salto hacia atrás)', () => {
  runAcrossMachines(
    'calcula 5! con un bucle (MULT, SUBI, J), en cualquier configuración de máquina',
    `
      .text
      ADDI R1, R0, #5      ; n = 5
      ADDI R2, R0, #1      ; resultado = 1
      ADDI R3, R0, #1      ; constante 1
      LOOP:
      SEQI R3, R1, #1      ; ¿n == 1?
      BNEZ R3, END
      MULT R2, R2, R1      ; resultado *= n
      SUBI R1, R1, #1      ; n -= 1
      J    LOOP
      END:
    `,
    (processor) => {
      const regs = processor.getRegisters();
      expect(regs[1]).toBe(1);
      expect(regs[2]).toBe(120);
    },
  );
});
