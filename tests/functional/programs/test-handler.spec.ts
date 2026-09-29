import { runAcrossMachines } from '../run-program';

// Programa raíz: test_handler.asm
// Un LW mal alineado dispara MEMORY_ALIGNMENT_ERROR; el manejador de usuario marca R5=999
// y hace RFE, retomando la ejecución justo después del TRAP 0 original.
describe('test_handler.asm', () => {
  runAcrossMachines(
    'salta al manejador de usuario de alineación de memoria y reanuda con RFE, en cualquier configuración de máquina',
    `
      .text
      START:
        LW R1, 5(R0)  ; Acceso mal alineado -> excepción
        trap 0

      __mem_align_handler:
        ADDI R5, R0, #999
        RFE

      __default_handler:
        TRAP 6
    `,
    (processor) => {
      expect(processor.getRegisters()[5]).toBe(999);
      // RFE limpia `cause` deliberadamente al volver de la excepción (ver el 'case RFE' en cada
      // procesador), así que tras el retorno queda vacía otra vez.
      expect(processor.cause()).toBe('');
    },
  );
});
