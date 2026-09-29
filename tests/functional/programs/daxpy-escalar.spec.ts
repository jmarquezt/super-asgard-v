import { SymbolTable } from '../../../src/app/core/models/asg.symbol-table';
import { runAcrossMachines } from '../run-program';

// Programa raíz: bucle.s — versión ESCALAR (sin vectorizar) del mismo DAXPY que buclev.s
// (ver daxpy-vectorial.spec.ts): Y[i] = a*X[i] + Y[i], con a=2.0 y X[i]=Y[i]=i. Aquí cada
// elemento se procesa uno a uno con LD/MULTD/ADDD/SD en el bucle, sin LV/SV ni secciones por MVL.
// Y[i] pasa a valer 2*i + i = 3*i para las 190 posiciones (0..189).
describe('bucle.s (escalar)', () => {
  const doubles = (values: number[]) => values.map(v => `${v}`).join(', ');
  const xValues = Array.from({ length: 190 }, (_, i) => i);

  runAcrossMachines(
    'calcula Y[i] = 3*i para las 190 posiciones del vector, en cualquier configuración de máquina',
    `
      .data 0x1000

      X:         .double ${doubles(xValues)}
      Y:         .double ${doubles(xValues)}
      a:         .double 2.0

      .text
      main:      ADDI  R1,R0,#0x1000       ; Carga la dirección del primer elemento de X en R1.
                 ADDI  R2,R0,#0x15F0       ; Carga la dirección del primer elemento de Y en R2.
                 LD    F0,0x1BE0(R0)      ; Carga la dirección del escalar en F0
                 ADDI  R4,R2,#0            ; Cálculo y carga en R4 del fin del vector X.
      inicio:    LD    F2,0(R1)           ; Carga X[i]
                 MULTD F4,F2,F0           ; Multiplica a*X[i]
                 LD    F6,0(R2)           ; Carga Y[i]
                 ADDD  F6,F4,F6           ; Suma a*X[i]+Y[i]
                 SD    0(R2),F6           ; Almacena Y[i]
                 ADDI  R1,R1,#8            ; Incrementa índice X
                 ADDI  R2,R2,#8            ; Incrementa índice Y
                 SGT   R3,R1,R4           ; Comprueba si el índice del vector X ha llegado al final.
                 BEQZ  R3,inicio          ; Comprueba la condición de final del bucle.

      fin:       trap 0                   ; Fin del programa
    `,
    (processor) => {
      // Al compilarse como un único módulo sin `.global`, las etiquetas locales se renombran
      // internamente con el prefijo "__m0__" (ver SourceModule/AsgAssemblerService).
      const yAddr = SymbolTable.getAddress('__m0__Y');
      for (const i of [0, 1, 61, 62, 100, 189]) {
        expect(processor.dataMemory.read(yAddr + i * 8, 8)).toBe(3 * i);
      }
    },
    // 191 iteraciones con MULTD/ADDD reales: el monociclo y el superescalar pueden necesitar
    // bastantes más ciclos que el pipelined al no solapar etapas.
    { memorySize: 8192, maxCycles: 150000 },
  );
});
