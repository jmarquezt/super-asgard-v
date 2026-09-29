import { runAcrossMachines } from './run-program';

describe('Adelantamiento de datos (forwarding EX/MEM -> EX)', () => {
  runAcrossMachines(
    'propaga el resultado de una ADD directamente a la SUB siguiente, en cualquier configuración de máquina',
    `
      .text
      ADDI R2, R0, #4
      ADDI R3, R0, #6
      ADDI R5, R0, #1
      ADD  R1, R2, R3   ; R1 = 10
      SUB  R4, R1, R5   ; R1 se adelanta desde EX/MEM a EX (o se resuelve sin más en las otras máquinas)
    `,
    (processor) => {
      const regs = processor.getRegisters();
      expect(regs[1]).toBe(10);
      expect(regs[4]).toBe(9);
    },
  );

  // Regresión: LHI (y otros opcodes como ADDU/SUBU/ANDI/ORI/XORI/SLL/SRL...) guardan su
  // `result` en representación SIN signo (>>>0). Sin normalizar el valor reenviado a signo
  // (|0) en getForwardedValue(), una instrucción consumidora que compara el valor con
  // aritmética "normal" (no a nivel de bit) — como la detección de overflow de SUB, que usa
  // `res < -2147483648 || res > 2147483647` en vez de XOR — podía ver un número positivo
  // (2147483648) donde debía ver su negativo (-2147483648), y no detectar el overflow. Solo
  // se manifestaba con forwarding activo (leer el mismo valor del banco de registros, vía
  // Int32Array, ya normaliza el signo correctamente) y solo con valores cuyo bit 31 esté
  // activo (0x7FFFFFFF, usado en el test de ADD de test-overflow-int.spec.ts, no lo destapa
  // porque es positivo en ambas representaciones).
  runAcrossMachines(
    'un valor con el bit 31 activo, generado por LHI y reenviado (forwarding) dos instrucciones después, se interpreta con signo correctamente',
    `
      .text
      main:
          lhi  r1, #0x8000       ; r1 = 0x80000000 (mínimo entero con signo)
          addi r2, r0, #1        ; instrucción de relleno independiente (fuerza forwarding a 2 de distancia)
          sub  r3, r1, r2        ; excepción: ARITHMETIC_OVERFLOW si r1 se interpreta con signo
          trap 0
      __overflow_handler:
          trap 0
    `,
    (processor) => {
      expect(processor.cause()).toBe('ARITHMETIC_OVERFLOW');
    },
  );
});
