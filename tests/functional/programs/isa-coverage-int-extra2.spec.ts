import { runAcrossMachines } from '../run-program';
import { SymbolTable } from '../../../src/app/core/models/asg.symbol-table';

// isa-coverage-int.spec.ts cubre casi toda la familia de comparaciones (SNE/SLE/SGE, sus
// variantes inmediatas y sin signo), pero se dejó fuera el trío "igual/mayor/menor" con signo
// más básico: SEQ, SGT, SLT (registro-registro) y SEQI, SGTI, SLTI (inmediato). También AND,
// ANDI y XORI (XOR ya estaba cubierto, pero no sus primos lógicos).
describe('cobertura ISA — comparaciones con signo básicas y lógica restante', () => {
  runAcrossMachines(
    'SEQ/SGT/SLT, SEQI/SGTI/SLTI, y AND/ANDI/XORI producen los resultados esperados',
    `
      .text
      main:
          addi r1, r0, #12
          addi r2, r0, #10

          seq r3, r1, r1        ; 12 == 12 -> 1
          sw  res_seq, r3
          sgt r4, r1, r2        ; 12 > 10 -> 1
          sw  res_sgt, r4
          slt r5, r2, r1        ; 10 < 12 -> 1
          sw  res_slt, r5

          seqi r6, r1, #12      ; 12 == 12 -> 1
          sw   res_seqi, r6
          sgti r7, r1, #10      ; 12 > 10 -> 1
          sw   res_sgti, r7
          slti r8, r2, #12      ; 10 < 12 -> 1
          sw   res_slti, r8

          and  r9, r1, r2       ; 12 & 10 = 8
          sw   res_and, r9
          andi r10, r1, #10     ; 12 & 10 = 8
          sw   res_andi, r10
          xori r11, r1, #10     ; 12 ^ 10 = 6
          sw   res_xori, r11

          trap 0

      .data
      res_seq:  .word 0
      res_sgt:  .word 0
      res_slt:  .word 0
      res_seqi: .word 0
      res_sgti: .word 0
      res_slti: .word 0
      res_and:  .word 0
      res_andi: .word 0
      res_xori: .word 0
    `,
    (processor) => {
      const read = (label: string) => processor.dataMemory.read(SymbolTable.getAddress(`__m0__${label}`)!, 4);

      expect(read('res_seq')).toBe(1);
      expect(read('res_sgt')).toBe(1);
      expect(read('res_slt')).toBe(1);
      expect(read('res_seqi')).toBe(1);
      expect(read('res_sgti')).toBe(1);
      expect(read('res_slti')).toBe(1);
      expect(read('res_and')).toBe(8);
      expect(read('res_andi')).toBe(8);
      expect(read('res_xori')).toBe(6);
    },
  );
});
