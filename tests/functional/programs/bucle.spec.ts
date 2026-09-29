import { SymbolTable } from '../../../src/app/core/models/asg.symbol-table';
import { runAcrossMachines } from '../run-program';

// Programa raíz: escalar.s (bucle escalar sobre A[10], separando en X/Y según el signo de A[i]-a)
describe('escalar.s', () => {
  runAcrossMachines(
    'separa A[i] en X (A[i]-a >= 0) o Y (A[i]-a < 0), en cualquier configuración de máquina',
    `
      .data
      .align 2
      cero:
        .double 0
      a:
        .double 10 ;variable constante a
      A:
        .double 16, 4, 15, 5, 14, 6, 13, 7, 12, 8
      X:
        .space 80
      Y:
        .space 80
      .text
      .global main
      main:
        ADDI    R1, R0, A   ;guardar posicion inicial de A en R1
        ADDI    R2, R1, #72 ;ultima posicion de A (10 elementos x 8 bytes)
        ADDI    R4, R0, X   ;guardar posicion inicial de X en r4
        ADDI    R5, R0, Y   ;guardar posicion inicial de Y en r5
        LD      F2, a       ;se carga la constante a restar en doble precisión
        LD      F0, cero    ;se carga 0 en doble precisión
      loop:
        LD      F4, 0(R1)   ;cargar en F4 A[i]
        SUBD    F6, F4, F2  ;aux=A[i]-a. Se almacena en F6
        ADDI    R1, R1, #8  ;incrementa el indice i en 8
        LTD     F6, F0      ;se comprueba Si aux<0
        BFPT    else        ;si aux es menor que 0 salta a la etiqueta else
      if:
        SD      0(R4), F4   ;almacena A[i] en X[i]
        SD      0(R5), F0   ;almacena 0 en Y[i]
        J       final       ;salta a final
      else:
        SD      0(R4), F0   ;almacena 0 en X[i]
        SD      0(R5), F4   ;almacena A[i] en Y[i]
      final:
        ADDI    R4, R4, #8  ;incrementa el indice i en 8
        ADDI    R5, R5, #8  ;incrementa el indice i en 8
        SGT     R3, R1, R2  ;si r1>r2 significa que hemos recorrido el vector A completo y finaliza el programa
        BEQZ    R3, loop    ;sino, vuelve a inicio del bucle y continua
      TRAP 6 ; final
    `,
    (processor) => {
      const xAddr = SymbolTable.getAddress('__m0__X')!;
      const yAddr = SymbolTable.getAddress('__m0__Y')!;
      const expectedX = [16, 0, 15, 0, 14, 0, 13, 0, 12, 0];
      const expectedY = [0, 4, 0, 5, 0, 6, 0, 7, 0, 8];

      for (let i = 0; i < 10; i++) {
        expect(processor.dataMemory.read(xAddr + i * 8, 8)).toBe(expectedX[i]);
        expect(processor.dataMemory.read(yAddr + i * 8, 8)).toBe(expectedY[i]);
      }
    },
  );
});
