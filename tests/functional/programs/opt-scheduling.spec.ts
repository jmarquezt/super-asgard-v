import { runAcrossMachines } from '../run-program';

// Programa raíz: opt_scheduling.s
describe('opt_scheduling.s', () => {
  runAcrossMachines(
    'calcula X = (A * B) + C, en cualquier configuración de máquina',
    `
      .data
      .align 3
      A: .double 10.5
      B: .double 2.5
      C: .double 5.0
      X: .double 0.0

      .text
      main:
          ld f2, A            ; Latencia 2
          ld f4, B            ; Latencia 2

          ; El siguiente MULTD depende de f2 y f4 (Stall si no se separa)
          multd f6, f2, f4    ; Latencia 5

          addi r1, r0, #100   ; Instrucción independiente
          addi r2, r0, #200   ; Instrucción independiente

          ; Este ADDD depende de f6 (Stall largo si no se separa)
          ld f8, C
          addd f10, f6, f8

          sd X, f10
          trap 0
    `,
    (processor) => {
      // TRAP siempre fija rd=1 (ver AsgJumpInstruction.fromText): "R1 = valor de retorno de la
      // función". Por eso "trap 0" sobreescribe R1 con su resultado (0) al llegar a WB, así que no
      // se puede comprobar el #100 que le puso la ADDI: solo R2 (no tocado por el trap) sigue intacto.
      expect(processor.getRegisters()[2]).toBe(200);
      expect(processor.dataMemory.read(24, 8)).toBe(10.5 * 2.5 + 5.0);
    },
  );
});
