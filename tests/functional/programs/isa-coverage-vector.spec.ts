import { TestBed } from '@angular/core/testing';
import { runAcrossMachines } from '../run-program';
import { AsgConfigService } from '../../../src/app/core/services/asg.config';

// Programa sintético creado para cubrir opcodes vectoriales de la ISA que ningún otro programa
// de test ejercitaba: SUBV, la aritmética escalar-vector (ADDSV/SUBSV/DIVSV) y vector-escalar
// (SUBVS/MULTVS/DIVVS), MOVS2I, CVM/POP, y un representante de cada familia de comparación
// vectorial que faltaba (SNEV para vector-vector, SGTSV para escalar-vector).
//
// Nota de alcance: dentro de cada familia de comparación vectorial (vector-vector, escalar-vector,
// vector-escalar) el único código que cambia entre operadores (EQ/NE/GT/LT/GE/LE) es la propia
// comparación de `switch(true)` en asg.pipelined.processor.ts, idéntica en estructura a la ya
// validada para enteros y FP; lo que sí difiere por familia es la selección de operandos (Vector-
// Vector / Fi-Vj / Vj-Fi), y eso es lo que cubren estos dos casos representativos. SEQV y SEQVS ya
// estaban cubiertos por otros programas (test_vec_mask.asm / test_checkers_vector.asm).
describe('cobertura ISA — vectorial', () => {
  const closeArr = (actual: Float64Array | number[], expected: number[]) => {
    expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v));
  };

  runAcrossMachines(
    'ejecuta SUBV y la aritmética escalar-vector (ADDSV/SUBSV/DIVSV), en cualquier configuración de máquina',
    `
      .text
      main:
          addi r1, r0, #4
          movi2s VLR, r1        ; VL = 4

          addi r2, r0, vecA
          lv v1, 0(r2)          ; V1 = [40, 30, 20, 10]
          addi r3, r0, vecB
          lv v2, 0(r3)          ; V2 = [4, 3, 2, 1]

          subv v3, v1, v2       ; V3 = V1 - V2 = [36, 27, 18, 9]

          lf f0, scalar_val     ; F0 = 5.0

          addsv v4, f0, v2      ; V4 = F0 + V2 = [9, 8, 7, 6]
          subsv v5, f0, v2      ; V5 = F0 - V2 = [1, 2, 3, 4]
          divsv v6, f0, v2      ; V6 = F0 / V2 = [1.25, 1.666..., 2.5, 5]

          trap 0

      .data
      vecA:        .double 40.0, 30.0, 20.0, 10.0
      vecB:        .double 4.0, 3.0, 2.0, 1.0
      scalar_val:  .float 5.0
    `,
    (processor) => {
      const vregs = processor.getVectorRegisters();
      closeArr(vregs[3], [36, 27, 18, 9]);
      closeArr(vregs[4], [9, 8, 7, 6]);
      closeArr(vregs[5], [1, 2, 3, 4]);
      closeArr(vregs[6], [1.25, 5 / 3, 2.5, 5]);
    },
  );

  runAcrossMachines(
    'ejecuta la aritmética vector-escalar (SUBVS/MULTVS/DIVVS) y MOVS2I/CVM/POP, en cualquier configuración de máquina',
    `
      .text
      main:
          addi r1, r0, #4
          movi2s VLR, r1        ; VL = 4

          addi r2, r0, vecA
          lv v1, 0(r2)          ; V1 = [40, 30, 20, 10]
          lv v2, 0(r2)          ; carga muda (da tiempo a V1 a completarse, igual que el bloque SUBV)
          lf f0, scalar_val     ; F0 = 5.0

          subvs v3, v1, f0      ; V3 = V1 - F0 = [35, 25, 15, 5]
          multvs v4, v1, f0     ; V4 = V1 * F0 = [200, 150, 100, 50]
          divvs v5, v1, f0      ; V5 = V1 / F0 = [8, 6, 4, 2]

          movs2i r10, VLR       ; R10 = VLR = 4

          cvm                   ; resetea la máscara vectorial: todos los elementos activos
          pop r11, VM           ; R11 = número de elementos activos = MVL

          trap 0

      .data
      vecA:        .double 40.0, 30.0, 20.0, 10.0
      scalar_val:  .float 5.0
    `,
    (processor) => {
      const vregs = processor.getVectorRegisters();
      closeArr(vregs[3], [35, 25, 15, 5]);
      closeArr(vregs[4], [200, 150, 100, 50]);
      closeArr(vregs[5], [8, 6, 4, 2]);

      expect(processor.getRegisters()[10]).toBe(4);

      const mvl = TestBed.inject(AsgConfigService).getCurrentConfig().mvl;
      expect(processor.getRegisters()[11]).toBe(mvl);
    },
  );

  runAcrossMachines(
    'SNEV calcula la máscara vectorial de una comparación vector-vector distinta de SEQV, en cualquier configuración de máquina',
    `
      .text
      main:
          addi r1, r0, #4
          movi2s VLR, r1

          addi r2, r0, vecA
          lv v1, 0(r2)          ; V1 = [1, 2, 3, 4]
          addi r3, r0, vecB
          lv v2, 0(r3)          ; V2 = [9, 2, 3, 8]

          snev v1, v2           ; VM[i] = V1[i] != V2[i] → [1, 0, 0, 1]

          trap 0

      .data
      vecA: .double 1.0, 2.0, 3.0, 4.0
      vecB: .double 9.0, 2.0, 3.0, 8.0
    `,
    (processor) => {
      expect(processor.cause()).toBe(''); // detecta pronto un fallo de alineación/etc. en vez de leer la VM por defecto
      const vm = Array.from(processor.getVectorMask()).slice(0, 4);
      expect(vm).toEqual([1, 0, 0, 1]);
    },
  );

  runAcrossMachines(
    'SGTSV calcula la máscara vectorial de una comparación escalar-vector (Fi > Vj), en cualquier configuración de máquina',
    `
      .text
      main:
          addi r1, r0, #4
          movi2s VLR, r1

          lf f0, scalar_val     ; F0 = 3.0
          addi r2, r0, vecC
          lv v1, 0(r2)          ; V1 = [1, 3, 5, 2]
          lv v2, 0(r2)          ; carga muda (da tiempo a V1 a completarse)

          sgtsv f0, v1          ; VM[k] = (F0 > V1[k]) → [1, 0, 0, 1]

          trap 0

      .data
      scalar_val: .float 3.0
      .align 3
      vecC:       .double 1.0, 3.0, 5.0, 2.0
    `,
    (processor) => {
      expect(processor.cause()).toBe(''); // detecta pronto un fallo de alineación/etc. en vez de leer la VM por defecto
      const vm = Array.from(processor.getVectorMask()).slice(0, 4);
      expect(vm).toEqual([1, 0, 0, 1]);
    },
  );
});
