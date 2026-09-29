import { runAcrossMachines } from '../run-program';

// Programa raíz: test_dot_product.asm
// 1*10 + 2*20 + 3*30 + 4*40 + 5*50 = 10+40+90+160+250 = 550
describe('test_dot_product.asm', () => {
  runAcrossMachines(
    'calcula el producto escalar de dos vectores de 5 elementos, en cualquier configuración de máquina',
    `
      .data
      .align 3
      vector_a:    .double 1.0, 2.0, 3.0, 4.0, 5.0
      vector_b:    .double 10.0, 20.0, 30.0, 40.0, 50.0
      msg_res:     .ascii "Producto escalar = %f (Esperado: 550.0)\\n"
      .align 2
      p_print:     .word msg_res
                   .double 0.0
      .align 3
      temp:        .space 256

      .text
      main:
          addi r1, r0, #5         ; VL = 5
          movi2s VLR, r1

          ; 1. Multiplicación vectorial: V3 = V1 * V2
          lv   v1, vector_a
          lv   v2, vector_b
          multv v3, v1, v2        ; V3 = {10, 40, 90, 160, 250}

          ; 2. Guardar V3 en memoria para reducirlo escalarmente
          sv   temp, v3

          ; 3. Reducción manual (Sumar elementos de V3 en F0)
          addi r2, r0, #0         ; temporal 0
          movi2fp f0, r2
          cvti2d  f0, f0          ; f0 = 0.0 (acumulador sum)

          addi r10, r0, #0        ; Indice i = 0
          addi r9, r0, temp       ; Base de temp

      sum_loop:
          sub  r3, r10, r1        ; ¿i == VL?
          beqz r3, end_sum

          slli r4, r10, #3        ; r4 = i * 8 (elementos de 64 bits)
          add  r5, r9, r4         ; r5 = &temp[i]
          ld   f2, 0(r5)          ; f2 = temp[i]
          addd f0, f0, f2         ; f0 += f2

          addi r10, r10, #1       ; i++
          j    sum_loop

      end_sum:
          addi r11, r0, p_print
          sd   4(r11), f0         ; Guardar resultado en p_print+4
          addi r14, r0, p_print
          trap 5
          trap 0
    `,
    (processor) => {
      expect(processor.getFloatValue(0, true)).toBe(550);
      expect(processor.consoleOutput().join('')).toContain('Producto escalar = 550.000000');
    },
    { maxCycles: 20000 },
  );
});
