import { runAcrossMachines } from '../run-program';

// Programa raíz: test_vec_align.asm
describe('test_vec_align.asm', () => {
  runAcrossMachines(
    'detecta el acceso vectorial desalineado y ejecuta el manejador, en cualquier configuración de máquina',
    `
      .text

      main:
          addi r1, r0, #4
          movi2s VLR, r1

          ; Intentar carga desde dirección no alineada (base + 1)
          addi r2, r0, vec_data
          addi r2, r2, #1     ; R2 apunta a una dirección impar

          ; La siguiente instrucción disparará MEMORY_ALIGNMENT_ERROR
          lv   v1, 0(r2)

          trap 0

      __mem_align_handler:
          addi r1, r0, msg_exc
          sw   p_print, r1
          addi r14, r0, p_print
          trap 5
          trap 0

      .data
      .align 3
      vec_data: .double 1.0, 2.0, 3.0, 4.0
      msg_exc:  .ascii "¡MANEJADOR: Error de alineacion de memoria VECTORIAL!\\n"
      .align 2
      p_print:  .word 0
    `,
    (processor) => {
      expect(processor.cause()).toBe('MEMORY_ALIGNMENT_ERROR');
      expect(processor.consoleOutput().join('')).toContain('Error de alineacion de memoria VECTORIAL');
    },
  );
});
