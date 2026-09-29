import { runAcrossMachines } from '../run-program';

// Programa raíz: test_vec_advanced.asm
// Ejercita CVI, LVWS, SVWS, LVI, SVI, SEQV y CVM encadenados; se comprueba que la secuencia
// completa (gather/scatter incluido) se ejecuta sin excepciones y llega al mensaje final.
describe('test_vec_advanced.asm', () => {
  runAcrossMachines(
    'ejecuta la secuencia de instrucciones vectoriales avanzadas sin excepciones, en cualquier configuración de máquina',
    `
      .data
      .align 3
      vec_contig:  .double 0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0
      vec_res:     .space 128

      msg_ok:      .ascii "Test Vectorial Avanzado Finalizado.\\n"
      .align 2
      p_print:     .word msg_ok

      .text
      main:
          ; 1. Configurar VL = 8
          addi r1, r0, #8
          movi2s vlr, r1

          ; --- PRUEBA 1: LVWS (Load Vector With Stride) ---
          addi r2, r0, vec_contig ; r2 = Base
          addi r3, r0, #16        ; r3 = Stride (16 bytes = 2 doubles)
          lvws v1, r2, r3         ; V1 = {vec[0], vec[2], vec[4], ...}

          ; --- PRUEBA 2: CVI (Create Vector Index) ---
          addi r4, r0, #8         ; r4 = Escalar 8
          cvi  v2, r4             ; V2 = {0, 8, 16, 24, 32, 40, 48, 56}

          ; --- PRUEBA 3: LVI (Load Vector Indexed / Gather) ---
          lvi  v3, r2, v2

          ; --- PRUEBA 4: COMPARACIÓN Y MÁSCARA ---
          seqv v1, v3             ; VM[i] = (V1[i] == V3[i])

          ; --- PRUEBA 5: CVM (Clear Vector Mask) ---
          cvm                     ; Resetear máscara para SVWS

          ; --- PRUEBA 6: SVWS (Store Vector With Stride) ---
          addi r6, r0, vec_res    ; r6 = Base destino
          svws v1, r6, r3

          ; --- PRUEBA 7: SVI (Store Vector Indexed / Scatter) ---
          svi  v3, r6, v2

          ; Finalizar
          addi r1, r0, msg_ok
          sw   p_print, r1
          addi r14, r0, p_print
          trap 5
          trap 0
    `,
    (processor) => {
      expect(processor.cause()).toBe('');
      expect(processor.consoleOutput().join('')).toContain('Test Vectorial Avanzado Finalizado.');
    },
  );
});
