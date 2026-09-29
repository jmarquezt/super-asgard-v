import { SymbolTable } from '../../../src/app/core/models/asg.symbol-table';
import { runAcrossMachines } from '../run-program';

// Programa raíz: test_daxpy.asm
describe('test_daxpy.asm', () => {
  runAcrossMachines(
    'calcula Y = a*X + Y vectorialmente: Y[0] = 2.5*1.0 + 10.0 = 12.5, en cualquier configuración de máquina',
    `
      .data
      .align 3
      val_a:       .double 2.5
      vector_x:    .double 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0
      vector_y:    .double 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0

      msg_res:     .ascii "Resultado Y[0] = %f (Esperado: 12.5)\\n"
      .align 2
      p_print:     .word msg_res
                   .double 0.0

      .text
      main:
          ; 1. Configurar VL (Vector Length) a 16
          addi r1, r0, #16
          movi2s VLR r1           ; VLR = 16

          ; 2. Cargar escalar 'a' en F0
          ld   f0, val_a

          ; 3. Cargar vectores
          lv   v1, vector_x
          lv   v2, vector_y

          ; 4. Operación DAXPY
          multsv v3, f0, v1
          addv  v2, v3, v2

          ; 5. Guardar resultado final
          sv   vector_y, v2

          ; 6. Mostrar el primer elemento
          ld   f2, vector_y
          addi r10, r0, p_print
          sd   4(r10), f2
          addi r14, r0, p_print
          trap 5

          trap 0
    `,
    (processor) => {
      // Al compilarse como un único módulo sin `.global`, las etiquetas locales se renombran
      // internamente con el prefijo "__m0__" (ver SourceModule/AsgAssemblerService).
      const vectorYAddr = SymbolTable.getAddress('__m0__vector_y');
      expect(processor.dataMemory.read(vectorYAddr, 8)).toBe(12.5);
      expect(processor.consoleOutput().join('')).toContain('Resultado Y[0] = 12.500000');
    },
    { maxCycles: 20000 },
  );
});
