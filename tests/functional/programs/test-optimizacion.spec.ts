import { runAcrossMachines } from '../run-program';

// Programa raíz: test-optimizacion.asm
// R1 baja de 128 a 0 en pasos de 8 (16 iteraciones) y R2 de 256 a 128 en paralelo.
// F2 se carga desde la dirección 0 (no desde donde está realmente la constante Pi en 0x80),
// por lo que vale 0.0 durante toda la ejecución y el acumulador F4 permanece en 0.0.
describe('test-optimizacion.asm', () => {
  runAcrossMachines(
    'termina el bucle tras 16 iteraciones con los punteros en su posición final, en cualquier configuración de máquina',
    `
      .data 128
      .double 3.1415
      .text
      ; --- Inicialización ---
      ADDI  R1, R0, #128   ; Puntero array A (16 elementos double)
      ADDI  R2, R0, #256   ; Puntero array B
      LD    F2, 0(R0)      ; Carga constante Pi
      ADDI  R3, R0, #0     ; Limpiamos acumulador (entero para mov)
      MOVI2FP F4, R3       ; F4 = 0.0 (Acumulador)
      ; --- Bucle Principal a optimizar ---
      inicio:
           LD    F0, 0(R1)       ; Carga A[i] (Latencia carga-uso)
           MULTD F6, F0, F2      ; A[i] * Pi (Latencia larga: 14 ciclos)
           ADDD  F4, F6, F4      ; ACUMULADOR: F4 = F4 + (A[i]*Pi)
           LD    F8, 0(R2)       ; Carga B[i] (Independiente de la ruta A)
           SUBD  F10, F8, F2     ; B[i] - Pi
           SD    0(R2), F10      ; Guarda nuevo B[i]
           SUBI  R1, R1, #8      ; Actualiza puntero A
           SUBI  R2, R2, #8      ; Actualiza puntero B
           BNEZ  R1, inicio      ; Salto con Delay Slot
    `,
    (processor) => {
      const regs = processor.getRegisters();
      expect(regs[1]).toBe(0);
      expect(regs[2]).toBe(128);
      expect(processor.getFloatValue(4, true)).toBe(0);
    },
    { maxCycles: 20000 },
  );
});
