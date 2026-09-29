import { SymbolTable } from '../../../src/app/core/models/asg.symbol-table';
import { runAcrossMachines } from '../run-program';

// Programa raíz: test_bubblesort.asm
describe('test_bubblesort.asm', () => {
  runAcrossMachines(
    'ordena el array [50,10,80,20,40,70,30,60] de forma ascendente, en cualquier configuración de máquina',
    `
      .data
      .align 2
      size:        .word 8
      array:       .word 50, 10, 80, 20, 40, 70, 30, 60

      msg_done:    .ascii "Array ordenado: %d, %d, %d, %d, %d, %d, %d, %d\\n"
      .align 2
      p_print:     .word msg_done
                   .space 32      ; hueco para los 8 resultados

      .text
      main:
          lw   r1, size           ; N = 8
          addi r2, r0, #0         ; i = 0 (bucle externo)

      outer_loop:
          addi r3, r1, #-1        ; r3 = N - 1
          sub  r4, r2, r3         ; ¿i == N-1?
          beqz r4, print_array

          addi r5, r0, #0         ; j = 0 (bucle interno)
          addi r6, r1, #-1
          sub  r6, r6, r2         ; Límite j = N - 1 - i

      inner_loop:
          sub  r7, r5, r6         ; ¿j == Límite?
          beqz r7, next_outer

          slli r8, r5, #2         ; r8 = j * 4
          addi r9, r0, array      ; r9 = &array
          add  r9, r9, r8         ; r9 = &array[j]
          lw   r10, 0(r9)         ; r10 = array[j]
          lw   r11, 4(r9)         ; r11 = array[j+1]

          sub  r12, r11, r10      ; r12 = a[j+1] - a[j]
          bgtz r12, next_inner    ; Si ok (a[j+1] > a[j]), no hacer swap

          sw   0(r9), r11         ; array[j] = r11
          sw   4(r9), r10         ; array[j+1] = r10

      next_inner:
          addi r5, r5, #1         ; j++
          j    inner_loop

      next_outer:
          addi r2, r2, #1         ; i++
          j    outer_loop

      print_array:
          addi r1, r0, #0         ; index i = 0
          addi r2, r0, array      ; r2 = base array
          addi r3, r0, p_print    ; r3 = base p_print
      copy_loop:
          slli r4, r1, #2         ; r4 = i * 4
          add  r5, r2, r4         ; r5 = &array[i]
          lw   r6, 0(r5)          ; r6 = array[i]
          add  r7, r3, r4         ; r7 = &p_print[i]
          sw   4(r7), r6          ; Almacenar en p_print + 4 + i*4
          addi r1, r1, #1
          addi r8, r1, #-8
          bltz r8, copy_loop

          addi r14, r0, p_print   ; R14 apunta al bloque de parámetros
          trap 5                  ; Imprimir
          trap 0                  ; Fin
    `,
    (processor) => {
      // Al compilarse como un único módulo sin `.global`, las etiquetas locales se renombran
      // internamente con el prefijo "__m0__" (ver SourceModule/AsgAssemblerService).
      const arrayAddr = SymbolTable.getAddress('__m0__array');
      const sorted = Array.from({ length: 8 }, (_, i) => processor.dataMemory.read(arrayAddr + i * 4, 4));
      expect(sorted).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
      expect(processor.consoleOutput().join('')).toBe('Array ordenado: 10, 20, 30, 40, 50, 60, 70, 80\n');
    },
    { maxCycles: 20000 },
  );
});
