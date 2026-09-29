import { runAcrossMachines } from '../run-program';

// Programa sintético que cubre opcodes/ramas enteras que ni isa-coverage-int.spec.ts ni
// test-overflow-int.spec.ts ejercitaban: ADDU/ADDUI/SUBU/MULTU/DIVU (rama normal),
// SLLI/SRLI, y las excepciones de desbordamiento de ADDI/SUB/SUBI (solo ADD estaba
// cubierta) y de división por cero de DIVI/DIVU. Cada procesador (pipelined,
// non-pipelined, superescalar) implementa esta lógica de forma independiente, así que
// runAcrossMachines es la única forma de cubrir los tres a la vez con un solo programa.
describe('cobertura ISA — aritmética entera sin signo y desplazamientos por inmediato', () => {
  runAcrossMachines(
    'ADDU/ADDUI/SUBU/MULTU/DIVU (división exacta)/SLLI/SRLI producen los resultados esperados',
    `
      .text
      main:
          addi r1, r0, #20
          addi r2, r0, #6

          addu  r3, r1, r2        ; 20 + 6 = 26
          sw    res_addu, r3
          addui r4, r1, #6        ; 20 + 6 = 26
          sw    res_addui, r4
          subu  r5, r1, r2        ; 20 - 6 = 14
          sw    res_subu, r5
          multu r6, r1, r2        ; 20 * 6 = 120
          sw    res_multu, r6
          divu  r7, r1, r2        ; 20 / 6 = 3 (entera, sin signo)
          sw    res_divu, r7

          slli  r9, r2, #3        ; 6 << 3 = 48
          sw    res_slli, r9
          addi  r10, r0, #48
          srli  r11, r10, #3      ; 48 >>> 3 = 6
          sw    res_srli, r11

          trap 0

      .data
      res_addu:  .word 0
      res_addui: .word 0
      res_subu:  .word 0
      res_multu: .word 0
      res_divu:  .word 0
      res_slli:  .word 0
      res_srli:  .word 0
    `,
    (processor) => {
      const addr = (label: string) => 4 * ['res_addu', 'res_addui', 'res_subu', 'res_multu', 'res_divu', 'res_slli', 'res_srli'].indexOf(label);
      expect(processor.dataMemory.read(addr('res_addu'), 4, false)).toBe(26);
      expect(processor.dataMemory.read(addr('res_addui'), 4, false)).toBe(26);
      expect(processor.dataMemory.read(addr('res_subu'), 4, false)).toBe(14);
      expect(processor.dataMemory.read(addr('res_multu'), 4, false)).toBe(120);
      expect(processor.dataMemory.read(addr('res_divu'), 4, false)).toBe(3);
      expect(processor.dataMemory.read(addr('res_slli'), 4, false)).toBe(48);
      expect(processor.dataMemory.read(addr('res_srli'), 4, false)).toBe(6);
    },
  );
});

describe('cobertura ISA — desbordamiento aritmético en ADDI/SUB/SUBI', () => {
  // Mismo patrón que test-overflow-int.spec.ts (que solo cubre ADD): construimos
  // 0x7FFFFFFF (máximo entero de 32 bits con signo) vía LHI+ORI para forzar overflow.
  runAcrossMachines(
    'ADDI detecta el desbordamiento al sumar 1 al máximo entero de 32 bits',
    `
      .text
      main:
          lhi  r1, #0x7FFF
          ori  r1, r1, #0xFFFF   ; r1 = 0x7FFFFFFF
          addi r2, r1, #1        ; excepción: ARITHMETIC_OVERFLOW
          trap 0
      __overflow_handler:
          trap 0
    `,
    (processor) => {
      expect(processor.cause()).toBe('ARITHMETIC_OVERFLOW');
    },
  );

  runAcrossMachines(
    'SUB detecta el desbordamiento al restar 1 al mínimo entero de 32 bits',
    `
      .text
      main:
          lhi  r1, #0x8000       ; r1 = 0x80000000 (mínimo entero con signo)
          addi r2, r0, #1
          sub  r3, r1, r2        ; excepción: ARITHMETIC_OVERFLOW
          trap 0
      __overflow_handler:
          trap 0
    `,
    (processor) => {
      expect(processor.cause()).toBe('ARITHMETIC_OVERFLOW');
    },
  );

  runAcrossMachines(
    'SUBI detecta el desbordamiento al restar 1 al mínimo entero de 32 bits',
    `
      .text
      main:
          lhi  r1, #0x8000       ; r1 = 0x80000000 (mínimo entero con signo)
          subi r2, r1, #1        ; excepción: ARITHMETIC_OVERFLOW
          trap 0
      __overflow_handler:
          trap 0
    `,
    (processor) => {
      expect(processor.cause()).toBe('ARITHMETIC_OVERFLOW');
    },
  );
});

describe('cobertura ISA — división por cero en DIVI/DIVU', () => {
  runAcrossMachines(
    'DIVI detecta la división por cero con divisor inmediato',
    `
      .text
      main:
          addi r1, r0, #10
          divi r2, r1, #0        ; excepción: DIVISION_BY_ZERO
          trap 0
      __divzero_handler:
          trap 0
    `,
    (processor) => {
      expect(processor.cause()).toBe('DIVISION_BY_ZERO');
    },
  );

  runAcrossMachines(
    'DIVU detecta la división por cero sin signo',
    `
      .text
      main:
          addi r1, r0, #10
          addi r2, r0, #0
          divu r3, r1, r2        ; excepción: DIVISION_BY_ZERO
          trap 0
      __divzero_handler:
          trap 0
    `,
    (processor) => {
      expect(processor.cause()).toBe('DIVISION_BY_ZERO');
    },
  );
});
