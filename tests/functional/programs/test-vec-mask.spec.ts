import { runAcrossMachines } from '../run-program';

// Programa raíz: test_vec_mask.asm
describe('test_vec_mask.asm', () => {
  runAcrossMachines(
    'evita la excepción de división por cero enmascarando el elemento conflictivo, en cualquier configuración de máquina',
    `
      .text

      main:
          addi r1, r0, #4
          movi2s vlr, r1      ; VLR = 4

          ; 1. Cargar vectores (vec_b tiene un cero en el segundo elemento)
          lv   v1, vec_a
          lv   v2, vec_b

          ; 2. Configurar Máscara para saltar el elemento 1 (índice base 0)
          addi r2, r0, #13    ; 13 = 1101 (activamos 0, 2, 3; desactivamos el 1)
          movi2fp f0, r2
          movf2s VM, f0           ; VM = bits de f0

          ; 3. Operación DIVV
          ; NO debe saltar al manejador porque el elemento 1 está enmascarado
          divv v3, v1, v2

          addi r1, r0, msg_ok
          sw   p_print, r1
          addi r14, r0, p_print
          trap 5

          trap 0

      __fp_divzero_handler:
          ; Este manejador NO debería ejecutarse si la máscara funciona bien
          addi r1, r0, msg_exc
          sw   p_print, r1
          addi r14, r0, p_print
          trap 5
          trap 0

      .data
      .align 3
      vec_a:   .double 10.0, 10.0, 10.0, 10.0
      vec_b:   .double 2.0, 0.0, 2.0, 2.0
      msg_exc: .ascii "¡ERROR: El manejador se ejecuto indebidamente!\\n"
      .align 2
      msg_ok:  .ascii "Test OK: Excepcion evitada mediante mascara.\\n"
      .align 2
      p_print: .word 0
    `,
    (processor) => {
      expect(processor.cause()).toBe('');
      const output = processor.consoleOutput().join('');
      expect(output).toContain('Test OK: Excepcion evitada mediante mascara');
      expect(output).not.toContain('El manejador se ejecuto indebidamente');
    },
  );
});
