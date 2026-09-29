import { runAcrossMachines } from '../run-program';

// Programa raíz: test_overflow_fp.asm
describe('test_overflow_fp.asm', () => {
  runAcrossMachines(
    'detecta el desbordamiento de punto flotante tras multiplicaciones sucesivas, en cualquier configuración de máquina',
    `
      .text

      main:
          ; --- FORZAR FP OVERFLOW ---
          addi r1, r0, #1000
          movi2fp f10, r1
          cvti2d  f10, f10    ; f10 = 1000.0

          multd f10, f10, f10 ; 10^6
          multd f10, f10, f10 ; 10^12
          multd f10, f10, f10 ; 10^24
          multd f10, f10, f10 ; 10^48
          multd f10, f10, f10 ; 10^96
          multd f10, f10, f10 ; 10^192
          multd f12, f10, f10 ; 10^384 -> Excepción: FP_OVERFLOW

          trap 0

      __fp_overflow_handler:
          addi r1, r0, msg_exc
          addi r10, r0, p_print
          sw   0(r10), r1
          addi r14, r0, p_print
          trap 5
          trap 0

      .data
      .align 2
      msg_exc:     .ascii "¡MANEJADOR: Excepcion FPU (Overflow/Invalid) detectada!\\n"
      .align 2
      p_print:     .word 0
    `,
    (processor) => {
      expect(processor.cause()).toBe('FP_OVERFLOW');
      expect(processor.consoleOutput().join('')).toContain('Excepcion FPU (Overflow/Invalid) detectada');
    },
    { maxCycles: 20000 },
  );
});
