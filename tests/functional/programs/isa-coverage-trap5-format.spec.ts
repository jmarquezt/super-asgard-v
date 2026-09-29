import { runAcrossMachines } from '../run-program';

// TRAP 5 (printf) soporta varios especificadores de formato (trapPrint / executeTrap del
// procesador). Los programas existentes solo ejercitaban %d y %f; el resto (%u, %x/%X, %c, %%,
// %s, %g, %e y el caso "especificador desconocido") quedaban sin cubrir. Como todos los valores
// son constantes conocidas en tiempo de ensamblado, se declaran directamente en el bloque de
// parámetros (mismo layout que usan los programas existentes: primera palabra = puntero al
// formato, seguida de los argumentos en el mismo orden que aparecen en la cadena).
describe('cobertura ISA — TRAP 5 (printf) con especificadores de formato poco usados', () => {
  runAcrossMachines(
    '%u, %x, %X, %c, %%, %s, %g, %e y un especificador desconocido (%z) producen la salida esperada por consola',
    `
      .data
      msg_fmt: .asciiz "%u %x %X %c%% %s %g %e %z\\n"
      msg_s:   .asciiz "OK"
      .align 3
      p_print: .word msg_fmt
               .word 42            ; %u
               .word 255           ; %x -> ff
               .word 4095          ; %X -> FFF
               .word 65            ; %c -> 'A'
               .word msg_s         ; %s -> "OK"
               .double 3.14159     ; %g
               .double 2.5         ; %e -> 2.500000e+0

      .text
      main:
          addi r14, r0, p_print
          trap 5
          trap 0
    `,
    (processor) => {
      expect(processor.cause()).toBe('');
      expect(processor.consoleOutput().join('')).toContain('42 ff FFF A% OK 3.14159 2.500000e+0 %z');
    },
  );
});
