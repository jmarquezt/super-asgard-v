import { assembleAndRun, freshTestBed, runAcrossMachines } from './run-program';

const SOURCE = `
  .text
  ADDI R1, R0, #5
  ADDI R2, R0, #5
  SEQ  R5, R2, R1   ; R5 = (R2 == R1) = 1
  BNEZ R5, EXIT     ; se toma porque R5 != 0
  ADD  R3, R2, R0   ; NO debe ejecutarse
  EXIT: ADD R3, R2, R1
`;

describe('Riesgo de control (salto condicional tomado)', () => {
  runAcrossMachines('anula la instrucción del camino no tomado, en cualquier configuración de máquina', SOURCE, (processor) => {
    const regs = processor.getRegisters();
    expect(regs[5]).toBe(1);
    expect(regs[3]).toBe(10); // Si la instrucción anulada se hubiese colado, R3 sería 5
  });

  describe('detalle específico del pipelined', () => {
    beforeEach(() => freshTestBed());

    it('cuenta el salto tomado como riesgo de control', () => {
      const processor = assembleAndRun(SOURCE);
      expect(processor.stats().controlHazards).toBeGreaterThan(0);
    });
  });
});
