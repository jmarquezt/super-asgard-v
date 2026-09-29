import { runAcrossMachines } from '../run-program';

// Programa raíz: test_excepcion.asm
describe('test_excepcion.asm', () => {
  runAcrossMachines(
    'detecta la división entera por cero y ejecuta el manejador, en cualquier configuración de máquina',
    `
      .text
      main:
          addi r1, r0, #100    ; Dividendo
          addi r2, r0, #0      ; Divisor (¡ERROR!)

          div  r3, r1, r2

          addi r4, r0, #999
          trap 0

      __divzero_handler:
          addi r1, r0, msg_exc
          sw   p_print, r1
          addi r14, r0, p_print
          trap 5              ; Mostrar "¡Excepción detectada!"
          trap 0

      .data
      msg_exc:     .ascii "¡MANEJADOR: Excepcion por division entre cero detectada!\\n"
      .align 2
      p_print:     .word 0
    `,
    (processor) => {
      expect(processor.cause()).toBe('DIVISION_BY_ZERO');
      expect(processor.consoleOutput().join('')).toContain('Excepcion por division entre cero detectada');
    },
  );
});
