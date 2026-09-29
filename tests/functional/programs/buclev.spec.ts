import { SymbolTable } from '../../../src/app/core/models/asg.symbol-table';
import { runAcrossMachines } from '../run-program';

// Programa raíz: vectorial.s — misma operación que escalar.s (separar A[i] en X/Y según el signo
// de A[i]-a) pero vectorizada: un único LV de los 10 elementos (VLR=10, sin necesidad de
// seccionar por MVL) y las comparaciones escalar-vector SUBVS/SLESV/SGTSV en vez del bucle
// escalar con LTD/BFPT.
//
// AVISO: el fichero original vectorial.s no llama a CVM entre SLESV y SGTSV. Las comparaciones
// vectoriales heredan/estrechan la máscara actual en vez de recalcularla desde cero (así es como
// test_checkers_vector.asm encadena varias comparaciones para construir un AND lógico), así que
// sin ese reset SGTSV terminaría evaluando "0 > vectorResta[i]" solo en los índices donde SLESV
// ya dejó "vectorResta[i] >= 0" — una intersección vacía, máscara todo ceros. Se añade el CVM que
// falta para que SGTSV calcule su propia condición de forma independiente, tal como indican sus
// comentarios ("A[i] < 0 pone vm = 1 los que cumplan condición").
describe('vectorial.s', () => {
  runAcrossMachines(
    'separa A[i] en X (A[i]-a >= 0) o Y (A[i]-a < 0) usando SUBVS/SLESV/SGTSV, en cualquier configuración de máquina',
    `
      .data
      .align 2
      cero:
        .double 0
      a:
        .double 10 ;variable constante a
      A:
        .double 16, 4, 15, 5, 14, 6, 13, 7, 12, 8
      vectorResta:
        .space 80 ;resta temporal
      X:
        .space 80 ; vector X
      Y:
        .space 80 ; vector Y
      .text
      .global main
      main:
        ADDI    R11, R0, #10  ;10 -> r11
        MOVI2S  VLR, R11  ;10 -> vlr Modificamos la longitud del vector vlr con la de los vectores con los que vamos a trabajar
        ADDI    R1, R0, A ;cargar posicion inicial de A en r1
        ADDI    R2, R0, vectorResta ;cargar posicion inicial del vectorResta temporal en r2
        LV      V1, 0(R1)   ;Carga vector A en V1
        LD      F0, a ; se carga la constante a restar en doble precisión
        SUBVS   V2, V1, F0 ; resta todos los elementos del vector A con la constante a y lo guarda en v2
        SV      0(R2), V2 ; guarda en vectorResta la operacion A[i] - a desde v2
        LV      V3, 0(R2)   ;Carga vectorResta en V3
        LD      F0, cero ; se carga 0 en doble precisión
        ADDI    R1, R0, X ;carga posicion inicial de X en r1
        SLESV   F0, V3 ; vectorResta[i] >= 0 pone vm = 1 los que cumplan condicion
        SV      0(R1), V1 ; guarda en X los que sean mayor o igual a 0
        ADDI    R3, R0, Y ;carga posicion inicial de Y en r3
        CVM ; falta en el original: resetea la mascara para que SGTSV evalue su propia condicion, no la interseccion con la de SLESV
        SGTSV   F0, V3 ; A[i] < 0 pone vm = 1 los que cumplan condicion
        SV      0(R3), V1 ; guarda en Y los que sean menores que 0
        TRAP 6	       ;Fin del programa
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
