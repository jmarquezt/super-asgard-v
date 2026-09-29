import { runAcrossMachines } from '../run-program';

// Programa raíz: opt_unrolling.s
// El cuerpo del bucle siempre lee y escribe la misma dirección fija "array" (no se indexa con R1),
// así que cada una de las 9 iteraciones (i = 0, 8, ..., 64) sigue sumando 10.0 al mismo acumulador:
// array[0] = 1.0 + 9*10.0 = 91.0
describe('opt_unrolling.s', () => {
  runAcrossMachines(
    'acumula 9 sumas de la constante sobre el primer elemento del array, en cualquier configuración de máquina',
    `
      .data
      .align 3
      array: .double 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0
      const: .double 10.0

      .text
      main:
          addi r1, r0, #0     ; Índice i = 0
          ld f2, const        ; Cargar constante

      loop:
          ld f4, array        ; Cargar array[i]
          addd f6, f4, f2     ; array[i] + const
          sd array, f6        ; Guardar resultado

          addi r1, r1, #8     ; i++ (elementos de 8 bytes)
          sgti r2, r1, #64    ; ¿i > 64?
          beqz r2, loop       ; Si no, repetir

          trap 0
    `,
    (processor) => {
      // TRAP siempre fija rd=1 (ver AsgJumpInstruction.fromText): "R1 = valor de retorno de la
      // función". Por eso "trap 0" sobreescribe R1 con su resultado (0) al llegar a WB, borrando el
      // 72 que dejó el bucle; solo R2 (no tocado por el trap) conserva el resultado de la última
      // comprobación (sgti r2, r1, #64 con r1=72 → r2=1).
      expect(processor.getRegisters()[2]).toBe(1);
      expect(processor.dataMemory.read(0, 8)).toBe(91);
    },
  );
});
