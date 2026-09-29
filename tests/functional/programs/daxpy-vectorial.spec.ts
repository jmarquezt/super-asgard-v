import { SymbolTable } from '../../../src/app/core/models/asg.symbol-table';
import { DEFAULT_SUPERSCALAR_CONFIG } from '../../../src/app/core/models/asg.config';
import { AsgSuperscalarProcessorService } from '../../../src/app/core/services/processor/asg.superscalar.processor';
import { DEFAULT_MACHINE_VARIANTS, runAcrossMachines } from '../run-program';

// Programa raíz: buclev.s — misma operación que bucle.s (Y[i] = a*X[i] + Y[i] = 3*i) pero
// vectorizada por secciones: una primera sección de 62 elementos (190 mod MVL=64) y el resto
// en secciones completas de 64 (el MVL por defecto de la configuración).
//
// Con los recursos SUPERESCALARES por defecto (1 única unidad vectorial de cada tipo, CDB de 4
// buses) este bucle con encadenamiento vectorial pesado (MULTSV/ADDV, VLR cambiando entre
// secciones) se queda sin recursos para progresar: al principio 5 entradas del ROB se quedaban
// colgadas (`[ROB.lookupValue] tag=X:Y not ready` en bucle infinito); duplicando las unidades
// vectoriales y el CDB bajó a 1 sola entrada colgada, y con la configuración de abajo (unidades
// generosas de todo tipo) el deadlock desaparece del todo. Así que SÍ era contención de recursos
// tal como comentaste, pero al resolverla quedó al descubierto un SEGUNDO bug, este de lógica:
// Y[61]/Y[62] daban valores incorrectos justo en la frontera entre la primera sección (62
// elementos) y la siguiente (64).
//
// CAUSA RAÍZ (ya arreglada, ver resolveOperands/RSEntry.vVL/qVL/InFlightInstruction.execVL en
// asg.superscalar.processor.ts): las instrucciones vectoriales leen implícitamente VLR, pero el
// registro arquitectónico solo se actualiza al hacer COMMIT (en orden) de un MOVI2S. Varias rutas
// de ejecución (executeVectorStore, processVectorElementsIncremental, checkVectorChainingPossibility...)
// leían `this.registerFile.vl()` "en caliente" durante la EJECUCIÓN, así que si el MOVI2S de la
// sección en curso aún no había hecho commit (por ir muy por detrás en el ROB, en orden), se leía
// el valor de la sección ANTERIOR o el de reset — provocando forwarding con datos nunca escritos
// (vl "fantasma" mayor que el real) justo en la frontera entre secciones. Arreglado resolviendo
// VLR vía renombrado en el DISPATCH (igual que cualquier otro operando) y capturando el valor
// correcto por instrucción en `execVL`, en vez de leerlo en caliente.
const SUPERSCALAR_MAS_RECURSOS_VECTORIALES = DEFAULT_MACHINE_VARIANTS.map(variant =>
  variant.processor === AsgSuperscalarProcessorService
    ? {
        ...variant,
        name: 'superescalar (más unidades y buses)',
        config: {
          superscalar: {
            ...DEFAULT_SUPERSCALAR_CONFIG,
            issueWidth: 8 as const,
            robSize: 256,
            cdbWidth: 16,
            intALUs: 4,
            intMulUnits: 4,
            intDivUnits: 4,
            fpAddUnits: 4,
            fpMulUnits: 4,
            fpDivUnits: 4,
            memUnits: 4,
            branchUnits: 4,
            vecMemUnits: 4,
            vecIntUnits: 4,
            vecMulUnits: 4,
            vecDivUnits: 4,
            rsClusterSizes: {
              intCluster: 32, fpCluster: 32, memCluster: 32, vecCluster: 32,
            },
            rsCentralizedSize: 64,
            rsPerUnitSize: 16,
          },
        },
      }
    : variant,
);

describe('buclev.s', () => {
  const doubles = (values: number[]) => values.map(v => `${v}`).join(', ');
  const xValues = Array.from({ length: 190 }, (_, i) => i);

  runAcrossMachines(
    'calcula Y[i] = 3*i para las 190 posiciones, seccionando por el MVL, en cualquier configuración de máquina',
    `
      .data 0x1000

      X:         .double ${doubles(xValues)}
      Y:         .double ${doubles(xValues)}
      a:         .double 2.0

      .text
              ADDI   R1,R0,#0x1000       ; Carga la dirección del primer elemento de X en R1.
              ADDI   R2,R0,#0x15F0       ; Carga la dirección del primer elemento de Y en R2.
              LD     F2,0x1BE0(R0)      ; Carga la dirección del escalar a en F1.
              ADDI   R3,R0,#62          ; Elementos de la primera sección(n mod MVL).
              ADDI   R6,R0,#64          ; Elementos del resto de secciones(MVL).
              ADDI   R8,R0,#8           ; Tamaño por elemento en bytes.
              ADDI   R4,R0,#1520        ; Longitud del vector X en bytes(n * 8).
              ADD    R4,R4,R1           ; Cálculo y carga en R4 del fin del vector X.
              MULT   R5,R3,R8           ; Cálculo y carga en R5 de la longitud de la sección.
              MOVI2S VLR,R3             ; Modifica el VLR para la primera sección.
      inicio: LV     V1,0(R1)           ; Carga en V1 la sección del vector X.
              LV     V3,0(R2)           ; Carga en V2 la sección del vector Y.
              MULTSV V2,F2,V1           ; Multiplica a*X.
              ADDV   V4,V3,V2           ; Suma a*X+Y.
              SV     0(R2),V4           ; Almacena en memoria la sección del vector Y.
              ADD    R1,R1,R5           ; Cálculo de la siguiente dirección de X.
              ADD    R2,R2,R5           ; Cálculo de la siguiente dirección de Y
              MULT   R5,R6,R8           ; Cálculo y carga en R5 de la longitud de la siguiente sección.
              MOVI2S VLR,R6             ; Actualiza el VLR al MVL.
              SUB    R10,R4,R1          ; Calcula los bytes que quedan por procesar.
              BNEZ   R10,inicio         ; Comprueba la condición de final del bucle.
      fin:    trap 0                    ; Fin del programa.
    `,
    (processor) => {
      // Al compilarse como un único módulo sin `.global`, las etiquetas locales se renombran
      // internamente con el prefijo "__m0__" (ver SourceModule/AsgAssemblerService).
      const yAddr = SymbolTable.getAddress('__m0__Y');
      for (const i of [0, 1, 61, 62, 63, 100, 189]) {
        expect(processor.dataMemory.read(yAddr + i * 8, 8)).toBe(3 * i);
      }
    },
    { memorySize: 8192, maxCycles: 20000 },
    SUPERSCALAR_MAS_RECURSOS_VECTORIALES,
  );
});
