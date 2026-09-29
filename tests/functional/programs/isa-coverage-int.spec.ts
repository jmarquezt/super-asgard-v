import { runAcrossMachines } from '../run-program';
import { SymbolTable } from '../../../src/app/core/models/asg.symbol-table';

// Programa sintético (no basado en un .asm del repo) creado para cubrir opcodes enteros/lógicos
// de la ISA que ningún otro programa de test ejercitaba: XOR, desplazamientos por registro
// (SLL/SRL/SRA) y por inmediato (SRAI), SUBUI, DIVI, las variantes con signo (SNE/SLE/SGE),
// sin signo registro-registro (SEQU/SNEU/SLTU/SGTU/SLEU/SGEU), con inmediato con y sin signo
// (SNEI/SLEI/SGEI, SEQUI/SNEUI/SLTUI/SGTUI), y SH (store halfword).
describe('cobertura ISA — enteros y lógica', () => {
  runAcrossMachines(
    'ejecuta las variantes enteras/lógicas restantes y almacena resultados verificables, en cualquier configuración de máquina',
    `
      .text
      main:
          addi r1, r0, #12
          addi r2, r0, #10
          xor  r3, r1, r2        ; 12 ^ 10 = 6
          sw   res_xor, r3

          addi r4, r0, #2
          sll  r5, r1, r4        ; 12 << 2 = 48
          sw   res_sll, r5
          srl  r6, r1, r4        ; 12 >>> 2 = 3
          sw   res_srl, r6

          addi r7, r0, #-8
          sra  r8, r7, r4        ; -8 >> 2 = -2 (aritmético)
          sw   res_sra, r8
          srai r9, r7, #1        ; -8 >> 1 = -4
          sw   res_srai, r9

          subui r10, r0, #1      ; 0 - 1 sin signo = 0xFFFFFFFF
          sw    res_subui, r10

          divi r11, r1, #5       ; 12 / 5 = 2 (entera)
          sw    res_divi, r11

          addi r12, r0, #-1      ; 0xFFFFFFFF
          addi r13, r0, #1

          sgtu r14, r12, r13     ; 0xFFFFFFFF > 1 (sin signo) → 1
          sw   res_sgtu, r14
          sltu r15, r12, r13     ; 0xFFFFFFFF < 1 (sin signo) → 0
          sw   res_sltu, r15
          sgeu r16, r12, r13     ; → 1
          sw   res_sgeu, r16
          sleu r17, r13, r12     ; 1 <= 0xFFFFFFFF → 1
          sw   res_sleu, r17
          sequ r18, r12, r12     ; → 1
          sw   res_sequ, r18
          sneu r19, r12, r13     ; → 1
          sw   res_sneu, r19

          sne  r20, r1, r2       ; 12 != 10 → 1
          sw   res_sne, r20
          sle  r21, r2, r1       ; 10 <= 12 → 1
          sw   res_sle, r21
          sge  r22, r1, r2       ; 12 >= 10 → 1
          sw   res_sge, r22

          snei r24, r1, #10      ; 12 != 10 → 1
          sw   res_snei, r24
          slei r25, r2, #10      ; 10 <= 10 → 1
          sw   res_slei, r25
          sgei r26, r1, #10      ; 12 >= 10 → 1
          sw   res_sgei, r26

          sequi r27, r1, #12     ; → 1
          sw    res_sequi, r27
          sneui r28, r1, #10     ; → 1
          sw    res_sneui, r28
          sltui r29, r2, #12     ; 10 < 12 → 1
          sw    res_sltui, r29
          sgtui r30, r1, #10     ; 12 > 10 → 1
          sw    res_sgtui, r30

          sh   res_sh, r1        ; almacena media palabra: 12

          ; JALR: JAL entra a la subrutina (R31 = addr(after_jal)); dentro, JALR usa esa
          ; dirección para volver y de paso reescribe R31 con SU PROPIO enlace de retorno.
          addi r23, r0, #0
          jal  subroutine
      after_jal:
          sw   res_after_jal, r23   ; confirma que volvimos exactamente a esta instrucción
          sw   res_jalr_link, r31   ; R31 = dirección justo después del jalr (jalr_unreached)

          trap 0

      subroutine:
          addi r23, r0, #42
          jalr r31                  ; salta a after_jal; enlaza en R31 = addr(jalr_unreached)
      jalr_unreached:
          addi r23, r0, #999        ; NO debe ejecutarse (saltado por el jalr)

      .data
      res_xor:        .word 0
      res_sll:         .word 0
      res_srl:         .word 0
      res_sra:         .word 0
      res_srai:        .word 0
      res_subui:       .word 0
      res_divi:        .word 0
      res_sgtu:        .word 0
      res_sltu:        .word 0
      res_sgeu:        .word 0
      res_sleu:        .word 0
      res_sequ:        .word 0
      res_sneu:        .word 0
      res_sne:         .word 0
      res_sle:         .word 0
      res_sge:         .word 0
      res_snei:        .word 0
      res_slei:        .word 0
      res_sgei:        .word 0
      res_sequi:       .word 0
      res_sneui:       .word 0
      res_sltui:       .word 0
      res_sgtui:       .word 0
      res_sh:          .word 0
      res_after_jal:   .word 0
      res_jalr_link:   .word 0
    `,
    (processor) => {
      const read = (label: string) => processor.dataMemory.read(SymbolTable.getAddress(`__m0__${label}`)!, 4);

      expect(read('res_xor')).toBe(6);
      expect(read('res_sll')).toBe(48);
      expect(read('res_srl')).toBe(3);
      expect(read('res_sra')).toBe(-2);
      expect(read('res_srai')).toBe(-4);
      expect(read('res_subui')).toBe(-1); // 0xFFFFFFFF leído como entero con signo
      expect(read('res_divi')).toBe(2);

      expect(read('res_sgtu')).toBe(1);
      expect(read('res_sltu')).toBe(0);
      expect(read('res_sgeu')).toBe(1);
      expect(read('res_sleu')).toBe(1);
      expect(read('res_sequ')).toBe(1);
      expect(read('res_sneu')).toBe(1);

      expect(read('res_sne')).toBe(1);
      expect(read('res_sle')).toBe(1);
      expect(read('res_sge')).toBe(1);

      expect(read('res_snei')).toBe(1);
      expect(read('res_slei')).toBe(1);
      expect(read('res_sgei')).toBe(1);

      expect(read('res_sequi')).toBe(1);
      expect(read('res_sneui')).toBe(1);
      expect(read('res_sltui')).toBe(1);
      expect(read('res_sgtui')).toBe(1);

      expect(processor.dataMemory.read(SymbolTable.getAddress('__m0__res_sh')!, 2)).toBe(12);

      // El JALR (dentro de "sub") debe haber saltado de vuelta a "after_jal" usando el R31
      // que dejó el JAL, sin llegar nunca a ejecutar la instrucción siguiente al JALR.
      expect(read('res_after_jal')).toBe(42);
      // El propio JALR reescribe R31 con SU dirección de retorno (PC+4 = jalr_unreached).
      const linkAddr = SymbolTable.getAddress('__m0__jalr_unreached')!;
      expect(read('res_jalr_link')).toBe(linkAddr);
    },
  );
});
