import { runAcrossMachines } from '../run-program';
import { SymbolTable } from '../../../src/app/core/models/asg.symbol-table';

// Programa sintético creado para cubrir opcodes de punto flotante de la ISA que ningún otro
// programa de test ejercitaba: DIVD, aritmética simple precisión (ADDF/SUBF/MULTF/DIVF),
// comparaciones dobles y simples (EQD/NED/LTD/GTD/LED/GED, EQF/NEF/LTF/GTF/LEF/GEF),
// conversiones (CVTF2D/CVTD2F/CVTF2I/CVTD2I/CVTI2F), MOVF/MOVFP2I y SF.
//
// Nota: las variantes "Set" (SLTD/SGTD/SLED/SGED, SLTF/SGTF/SLEF/SGEF) son alias de opcode que
// comparten exactamente el mismo `case` de ejecución que LTD/GTD/LED/GED y LTF/GTF/LEF/GEF
// respectivamente (ver asg.pipelined.processor.ts), así que no se duplican aquí.
//
// Las comparaciones de FP no escriben un registro: solo actualizan el bit de condición FPSR,
// que se lee con BFPT (branch if true). Cada comparación se verifica con el patrón:
//   addi rX, r0, #1 ; CMP ...; bfpt skip ; addi rX, r0, #0 ; skip: sw resultado, rX
describe('cobertura ISA — punto flotante', () => {
  runAcrossMachines(
    'ejecuta las variantes de punto flotante restantes y almacena resultados verificables, en cualquier configuración de máquina',
    `
      .text
      main:
          ld f0, val_a_d        ; F0:F1 = 8.0
          ld f2, val_b_d        ; F2:F3 = 2.0
          divd f4, f0, f2       ; F4:F5 = 4.0
          sd  res_divd, f4

          lf f10, val_a_f       ; F10 = 8.0
          lf f11, val_b_f       ; F11 = 2.0
          addf f12, f10, f11    ; 10.0
          sf  res_addf, f12
          subf f13, f10, f11    ; 6.0
          sf  res_subf, f13
          multf f14, f10, f11   ; 16.0
          sf  res_multf, f14
          divf f15, f10, f11    ; 4.0
          sf  res_divf, f15
          sf  res_sf, f10       ; verifica SF de forma aislada: 8.0

          ; --- Comparaciones dobles ---
          addi r1, r0, #1
          eqd  f0, f2           ; 8.0 == 2.0 → falso
          bfpt skip_eqd
          addi r1, r0, #0
      skip_eqd:
          sw res_eqd, r1

          addi r2, r0, #1
          ned  f0, f2           ; 8.0 != 2.0 → verdadero
          bfpt skip_ned
          addi r2, r0, #0
      skip_ned:
          sw res_ned, r2

          addi r3, r0, #1
          ltd  f2, f0           ; 2.0 < 8.0 → verdadero
          bfpt skip_ltd
          addi r3, r0, #0
      skip_ltd:
          sw res_ltd, r3

          addi r4, r0, #1
          gtd  f0, f2           ; 8.0 > 2.0 → verdadero
          bfpt skip_gtd
          addi r4, r0, #0
      skip_gtd:
          sw res_gtd, r4

          addi r5, r0, #1
          led  f0, f2           ; 8.0 <= 2.0 → falso
          bfpt skip_led
          addi r5, r0, #0
      skip_led:
          sw res_led, r5

          addi r6, r0, #1
          ged  f0, f2           ; 8.0 >= 2.0 → verdadero
          bfpt skip_ged
          addi r6, r0, #0
      skip_ged:
          sw res_ged, r6

          ; --- Comparaciones simples ---
          addi r7, r0, #1
          eqf  f10, f11         ; 8.0 == 2.0 → falso
          bfpt skip_eqf
          addi r7, r0, #0
      skip_eqf:
          sw res_eqf, r7

          addi r8, r0, #1
          nef  f10, f11         ; verdadero
          bfpt skip_nef
          addi r8, r0, #0
      skip_nef:
          sw res_nef, r8

          addi r9, r0, #1
          ltf  f11, f10         ; 2.0 < 8.0 → verdadero
          bfpt skip_ltf
          addi r9, r0, #0
      skip_ltf:
          sw res_ltf, r9

          addi r10, r0, #1
          gtf  f10, f11         ; 8.0 > 2.0 → verdadero
          bfpt skip_gtf
          addi r10, r0, #0
      skip_gtf:
          sw res_gtf, r10

          addi r11, r0, #1
          lef  f10, f11         ; 8.0 <= 2.0 → falso
          bfpt skip_lef
          addi r11, r0, #0
      skip_lef:
          sw res_lef, r11

          addi r12, r0, #1
          gef  f10, f11         ; 8.0 >= 2.0 → verdadero
          bfpt skip_gef
          addi r12, r0, #0
      skip_gef:
          sw res_gef, r12

          ; --- Conversiones ---
          cvtf2d f20, f10       ; double(F20:F21) = 8.0 (float → double)
          sd res_cvtf2d, f20

          cvtd2f f22, f0        ; float(F22) = 8.0 (double → float)
          sf res_cvtd2f, f22

          lf f24, trunc_src_f
          cvtf2i f26, f24       ; trunc(8.7) = 8 (float → entero, almacenado en registro F)
          sf res_cvtf2i, f26

          ld f6, trunc_src_d
          cvtd2i f29, f6        ; trunc(8.7) = 8 (double → entero, almacenado en registro F)
          sf res_cvtd2i, f29

          addi r13, r0, #8
          movi2fp f30, r13      ; F30 = bits de 8 reinterpretados como float
          cvti2f f31, f30       ; decodifica esos bits como entero y convierte a float: 8.0
          sf res_cvti2f, f31

          movf f8, f10          ; copia simple precisión: F8 = F10 = 8.0
          sf res_movf, f8

          movfp2i r14, f10      ; copia bit a bit F10(8.0f) a un registro entero (patrón IEEE-754)
          sw res_movfp2i, r14

          trap 0

      .data
      val_a_d:      .double 8.0
      val_b_d:      .double 2.0
      val_a_f:      .float 8.0
      val_b_f:      .float 2.0
      trunc_src_f:  .float 8.7
      .align 3
      trunc_src_d:  .double 8.7

      res_divd:     .double 0.0
      res_addf:     .float 0.0
      res_subf:     .float 0.0
      res_multf:    .float 0.0
      res_divf:     .float 0.0
      res_sf:       .float 0.0

      res_eqd: .word 0
      res_ned: .word 0
      res_ltd: .word 0
      res_gtd: .word 0
      res_led: .word 0
      res_ged: .word 0
      res_eqf: .word 0
      res_nef: .word 0
      res_ltf: .word 0
      res_gtf: .word 0
      res_lef: .word 0
      res_gef: .word 0

      .align 3
      res_cvtf2d:   .double 0.0
      res_cvtd2f:   .float 0.0
      res_cvtf2i:   .float 0.0
      res_cvtd2i:   .float 0.0
      res_cvti2f:   .float 0.0
      res_movf:     .float 0.0
      res_movfp2i:  .word 0
    `,
    (processor) => {
      const addr = (label: string) => SymbolTable.getAddress(`__m0__${label}`)!;
      const readInt = (label: string) => processor.dataMemory.read(addr(label), 4);
      const readFloat = (label: string) => processor.dataMemory.read(addr(label), 3);
      const readDouble = (label: string) => processor.dataMemory.read(addr(label), 8);

      expect(readDouble('res_divd')).toBeCloseTo(4.0);
      expect(readFloat('res_addf')).toBeCloseTo(10.0);
      expect(readFloat('res_subf')).toBeCloseTo(6.0);
      expect(readFloat('res_multf')).toBeCloseTo(16.0);
      expect(readFloat('res_divf')).toBeCloseTo(4.0);
      expect(readFloat('res_sf')).toBeCloseTo(8.0);

      expect(readInt('res_eqd')).toBe(0);
      expect(readInt('res_ned')).toBe(1);
      expect(readInt('res_ltd')).toBe(1);
      expect(readInt('res_gtd')).toBe(1);
      expect(readInt('res_led')).toBe(0);
      expect(readInt('res_ged')).toBe(1);

      expect(readInt('res_eqf')).toBe(0);
      expect(readInt('res_nef')).toBe(1);
      expect(readInt('res_ltf')).toBe(1);
      expect(readInt('res_gtf')).toBe(1);
      expect(readInt('res_lef')).toBe(0);
      expect(readInt('res_gef')).toBe(1);

      expect(readDouble('res_cvtf2d')).toBeCloseTo(8.0);
      expect(readFloat('res_cvtd2f')).toBeCloseTo(8.0);
      expect(readFloat('res_cvtf2i')).toBeCloseTo(8.0);
      expect(readFloat('res_cvtd2i')).toBeCloseTo(8.0);
      expect(readFloat('res_cvti2f')).toBeCloseTo(8.0);
      expect(readFloat('res_movf')).toBeCloseTo(8.0);
      expect(readInt('res_movfp2i')).toBe(0x41000000); // patrón IEEE-754 de 8.0f
    },
  );
});
