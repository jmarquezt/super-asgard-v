import { runAcrossMachines } from '../run-program';

// Programa raíz: test_fibonacci.asm
describe('test_fibonacci.asm', () => {
  runAcrossMachines(
    'imprime los 10 primeros términos de Fibonacci (0..34), en cualquier configuración de máquina',
    `
      .data
      .align 2
      n_terms:     .word 10
      msg_item:    .ascii "Fibonacci(%d) = %d\\n"

      .align 2
      p_print:     .word msg_item
                   .word 0        ; para el índice %d
                   .word 0        ; para el valor %d

      .text
      main:
          addi r20, r0, #0        ; F(n-2) = 0
          addi r21, r0, #1        ; F(n-1) = 1
          addi r22, r0, #0        ; i = 0
          lw   r23, n_terms       ; N = 10

      loop:
          sub  r5, r22, r23       ; ¿i == N?
          beqz r5, end

          addi r10, r0, p_print
          sw   4(r10), r22        ; Guardar índice i
          sw   8(r10), r20        ; Guardar valor F(n-2)

          addi r14, r0, p_print
          trap 5                  ; Imprimir "Fibonacci(i) = F(n-2)"

          add  r6, r20, r21
          addi r20, r21, #0       ; F(n-2) = F(n-1)
          addi r21, r6, #0        ; F(n-1) = F(n)

          addi r22, r22, #1       ; i++
          j    loop

      end:
          trap 0
    `,
    (processor) => {
      const output = processor.consoleOutput();
      expect(output).toHaveLength(10);
      expect(output[0]).toBe('Fibonacci(0) = 0\n');
      expect(output[9]).toBe('Fibonacci(9) = 34\n');
    },
    { maxCycles: 20000 },
  );
});
