import { runAcrossMachines } from '../run-program';

// Programa raíz: test_vec_divzero.asm
describe('test_vec_divzero.asm', () => {
  runAcrossMachines(
    'detecta la división vectorial por cero y ejecuta el manejador, en cualquier configuración de máquina',
    `
      .text

      main:
          ; 1. Configurar VL = 4
          addi r1, r0, #4
          movi2s vlr, r1           ; VLR = 4

          ; 2. Cargar vectores
          lv   v1, vec_a
          lv   v2, vec_b      ; El segundo elemento causará error

          ; 3. Operación conflictiva
          divv v3, v1, v2

          trap 0

      __fp_divzero_handler:
          addi r1, r0, msg_exc
          sw   p_print, r1
          addi r14, r0, p_print
          trap 5              ; Mostrar mensaje de excepción
          trap 0              ; Terminar

      .data
      .align 3
      vec_a:   .double 100.0, 100.0, 100.0, 100.0
      vec_b:   .double 2.0, 0.0, 4.0, 5.0
      msg_exc: .ascii "¡MANEJADOR: Division por cero VECTORIAL detectada!\\n"
      .align 2
      p_print: .word 0
    `,
    (processor) => {
      expect(processor.cause()).toBe('FP_DIVISION_BY_ZERO');
      expect(processor.consoleOutput().join('')).toContain('Division por cero VECTORIAL detectada');
    },
  );
});
