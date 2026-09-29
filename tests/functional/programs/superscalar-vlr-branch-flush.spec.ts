import { SymbolTable } from '../../../src/app/core/models/asg.symbol-table';
import { DEFAULT_MACHINE_VARIANTS, runAcrossMachines } from '../run-program';

// Test dedicado a la interacción VLR-renombrado + branch misprediction/flush en el superescalar
// (ver asg.superscalar.processor.ts: resolveOperands/RSEntry.vVL-qVL/InFlightInstruction.execVL).
//
// El bucle avanza en secciones de 4 elementos sobre un vector de 12 (3 iteraciones exactas). Se
// fuerza el predictor a 'always-taken' en las cinco máquinas de referencia para GARANTIZAR que el
// BNEZ de salida del bucle (la única iteración realmente no-tomada) se prediga TOMADO por error:
// eso hace que la máquina emita/ejecute especulativamente el MOVI2S y las instrucciones
// vectoriales (LV/ADDSV/SV) de una 4ª iteración FANTASMA antes de resolver la misprediction —
// exactamente el escenario que hay que verificar: una instrucción vectorial con su VLR aún
// pendiente de renombrar (qVL apuntando a un MOVI2S especulativo) queda flusheada junto con su
// productor. El objetivo es comprobar que ese flush no deje colgado ningún stall ni corrompa el
// resultado final (los datos reales, no especulativos, deben quedar exactamente igual en las
// cinco máquinas).
const ALWAYS_TAKEN_VARIANTS = DEFAULT_MACHINE_VARIANTS.map(variant => ({
  ...variant,
  config: { ...variant.config, branchPredictionStrategy: 'always-taken' as const },
}));

describe('VLR renombrado + branch misprediction/flush (superescalar)', () => {
  const xValues = Array.from({ length: 12 }, (_, i) => i);

  runAcrossMachines(
    'suma 100 a cada elemento en secciones de 4, con salida de bucle mispredicha, sin corromper el resultado',
    `
      .data 0x1000

      X: .double ${xValues.join(', ')}
      c: .double 100.0

      .text
              ADDI   R1,R0,#0x1000      ; puntero al vector
              ADDI   R4,R0,#0x1060      ; fin = X + 12*8 = 0x1060 (justo donde empieza 'c')
              ADDI   R3,R0,#4           ; elementos por sección
              LD     F2,0x1060(R0)      ; constante a sumar (100.0)
      inicio: MOVI2S VLR,R3             ; VLR resuelto vía renombrado, aún puede no haber hecho commit
              LV     V1,0(R1)
              ADDSV  V2,F2,V1
              SV     0(R1),V2
              ADDI   R1,R1,#32          ; siguiente sección (4 elementos * 8 bytes)
              SUB    R10,R4,R1
              BNEZ   R10,inicio         ; taken x2, no-taken en la 3ª: misprediction garantizada a la salida
      fin:    trap 0
    `,
    (processor) => {
      const xAddr = SymbolTable.getAddress('__m0__X');
      for (let i = 0; i < 12; i++) {
        expect(processor.dataMemory.read(xAddr + i * 8, 8)).toBe(i + 100);
      }
      expect(processor.cause()).toBe('');
    },
    { memorySize: 8192, maxCycles: 5000 },
    ALWAYS_TAKEN_VARIANTS,
  );
});
