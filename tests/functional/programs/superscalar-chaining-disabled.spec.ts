import { SymbolTable } from '../../../src/app/core/models/asg.symbol-table';
import { DEFAULT_MACHINE_VARIANTS, runAcrossMachines } from '../run-program';

// Cobertura dedicada a la rama SIN chaining de checkVectorChainingPossibility en el superescalar
// (asg.superscalar.processor.ts): con enableVectorChaining=false, un consumidor debe esperar a que
// el productor procese TODOS sus elementos (vl = producer.execVL), no solo hasta el elemento que
// necesita el siguiente lote. Los demás tests de la suite corren siempre con chaining activado,
// así que esta rama (`else { const vl = producer.execVL; if (producer.currentElement < vl) ... }`)
// quedaba sin ejercitar.
const CHAINING_DISABLED_VARIANTS = DEFAULT_MACHINE_VARIANTS.map(variant => ({
  ...variant,
  config: { ...variant.config, enableVectorChaining: false },
}));

describe('vector chaining desactivado (superescalar)', () => {
  const xValues = Array.from({ length: 8 }, (_, i) => i);
  const yValues = Array.from({ length: 8 }, (_, i) => i * 10);

  runAcrossMachines(
    'Y[i] = a*X[i] + Y[i] sin chaining: el consumidor espera a que el productor procese todo el vector',
    `
      .data 0x1000

      X: .double ${xValues.join(', ')}
      Y: .double ${yValues.join(', ')}
      a: .double 3.0

      .text
              ADDI   R1,R0,#0x1000
              ADDI   R2,R0,#0x1040        ; Y = X + 8*8 = 0x1040
              LD     F2,0x1080(R0)        ; a = 3.0 (justo tras Y: 0x1040 + 8*8 = 0x1080)
              ADDI   R3,R0,#8
              MOVI2S VLR,R3
              LV     V1,0(R1)
              LV     V3,0(R2)
              MULTSV V2,F2,V1
              ADDV   V4,V3,V2
              SV     0(R2),V4
              trap 0
    `,
    (processor) => {
      const yAddr = SymbolTable.getAddress('__m0__Y');
      for (let i = 0; i < 8; i++) {
        expect(processor.dataMemory.read(yAddr + i * 8, 8)).toBe(3 * xValues[i] + yValues[i]);
      }
      expect(processor.cause()).toBe('');
    },
    { memorySize: 8192, maxCycles: 5000 },
    CHAINING_DISABLED_VARIANTS,
  );
});
