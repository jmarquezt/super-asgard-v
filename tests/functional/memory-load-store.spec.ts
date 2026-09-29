import { runAcrossMachines } from './run-program';

describe('Acceso a memoria con y sin extensión de signo', () => {
  runAcrossMachines(
    'LB extiende el signo de un byte negativo, LBU no, en cualquier configuración de máquina',
    `
      .text
      ADDI R2, R0, #-1     ; R2 = 0xFFFFFFFF
      ADDI R1, R0, #100    ; dirección 100
      SW   0(R1), R2       ; memoria[100..103] = FF FF FF FF
      LB   R3, 0(R1)       ; con signo -> -1
      LBU  R4, 0(R1)       ; sin signo -> 255
    `,
    (processor) => {
      const regs = processor.getRegisters();
      expect(regs[3]).toBe(-1);
      expect(regs[4]).toBe(255);
    },
  );

  runAcrossMachines(
    'un LW recupera exactamente lo que un SW previo escribió, en cualquier configuración de máquina',
    `
      .text
      ADDI R1, R0, #200
      ADDI R2, R0, #1234
      SW   0(R1), R2
      LW   R3, 0(R1)
    `,
    (processor) => {
      expect(processor.getRegisters()[3]).toBe(1234);
    },
  );
});
