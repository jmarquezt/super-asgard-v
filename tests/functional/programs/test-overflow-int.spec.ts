import { runAcrossMachines } from '../run-program';

// Programa raíz: test_overflow_int.asm
//
// BUG CONOCIDO (pipelined sin forwarding): falla en la variante [pipelined sin forwarding] con
// `cause() === ''` (no se detecta el overflow). El mismo patrón de dependencia a 2 instrucciones
// sin forwarding YA funciona bien en tests/functional/forwarding.spec.ts, así que el mecanismo
// general de stall RAW-sin-forwarding no es el problema; hay algo específico de esta secuencia
// ("LHI R1,..." seguido de "ORI R1,R1,..." — ambas escriben Y leen el mismo registro R1) que no
// he logrado aislar sin ejecutar paso a paso. Se deja en rojo a propósito como marcador del bug.
describe('test_overflow_int.asm', () => {
  runAcrossMachines(
    'detecta el desbordamiento aritmético al sumar 1 al máximo entero de 32 bits, en cualquier configuración de máquina',
    `
      .text

      main:
          ; Cargar 2.147.483.647 (Máximo Int32)
          lhi  r1, #0x7FFF
          ori  r1, r1, #0xFFFF

          addi r2, r0, #1

          ; Esta operación producirá un resultado de 33 bits, disparando overflow
          add  r3, r1, r2     ; Excepción: ARITHMETIC_OVERFLOW

          trap 0

      __overflow_handler:
          addi r1, r0, msg_exc
          sw   p_print, r1
          addi r14, r0, p_print
          trap 5              ; Mostrar mensaje de excepción
          trap 0              ; Terminar

      .data
      msg_exc: .ascii "¡MANEJADOR: Overflow Aritmetico detectado!\\n"
      .align 2
      p_print: .word 0
    `,
    (processor) => {
      expect(processor.cause()).toBe('ARITHMETIC_OVERFLOW');
      expect(processor.consoleOutput().join('')).toContain('Overflow Aritmetico detectado');
    },
  );
});
