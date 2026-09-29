import { assembleAndRun, freshTestBed, runAcrossMachines } from './run-program';

const SOURCE = `
  .text
  ADDI R1, R0, #10
  ADDI R2, R0, #5
  MULT R3, R1, R2    ; tarda varios ciclos en EX
  ADD  R4, R3, R1    ; debe esperar a que MULT termine
`;

describe('Riesgo de datos RAW (MULT de varios ciclos seguido de una dependencia)', () => {
  runAcrossMachines('produce el mismo resultado en cualquier configuración de máquina', SOURCE, (processor) => {
    const regs = processor.getRegisters();
    expect(regs[1]).toBe(10);
    expect(regs[2]).toBe(5);
    expect(regs[3]).toBe(50);
    expect(regs[4]).toBe(60);
  });

  describe('detalle específico del pipelined', () => {
    beforeEach(() => freshTestBed());

    it('genera un riesgo estructural (no RAW) mientras MULT ocupa la etapa EX', () => {
      const processor = assembleAndRun(SOURCE);
      // MULT ocupa varios ciclos la etapa EX; la ADD siguiente debe esperar (riesgo estructural, no RAW,
      // ya que con forwarding habilitado solo un LOAD-USE genera un stall de tipo RAW). Esto es un
      // detalle de implementación del pipelined: el monociclo y el superescalar no tienen este concepto.
      expect(processor.stats().structuralStalls).toBeGreaterThan(0);
    });
  });
});
