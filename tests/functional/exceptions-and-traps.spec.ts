import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AsgAssemblerService } from '../../src/app/core/services/assembly/asg.assembler';
import { AsgProcessorService } from '../../src/app/core/services/processor/asg.processor';
import { AsgPipelinedProcessorService } from '../../src/app/core/services/processor/asg.pipelined.processor';
import { AsgNonPipelinedProcessorService } from '../../src/app/core/services/processor/asg.non-pipelined.processor';
import { AsgSuperscalarProcessorService } from '../../src/app/core/services/processor/asg.superscalar.processor';
import { runAcrossMachines, freshTestBed } from './run-program';

// Cubre TRAPs y códigos de excepción que ningún otro test funcional ejercita todavía:
// TRAP 1/2 (no soportados), TRAP 3/4 con fd inválido, TRAP 4 (write) en sí, FP_INVALID_OPERATION
// e ILLEGAL_INSTRUCTION vía decodificación real (no la unidad `asg-instruction-factory.spec.ts`,
// que solo llama a decode() directamente sin pasar por el pipeline).
//
// NOTA sobre cobertura: dos casos NO se prueban aquí porque son inalcanzables desde ensamblador:
// - FP_UNDERFLOW: la condición es `res !== 0 && Math.abs(res) < Number.MIN_VALUE`, pero
//   Number.MIN_VALUE ya es el double positivo más pequeño representable — ningún resultado no-nulo
//   puede ser más pequeño que eso. Es código muerto tal como está escrito.
// - "TRAP con código > 6": AsgJumpInstruction.fromText valida el rango 0-6 en el propio ensamblador
//   (`Código de TRAP inválido`), así que el "default" de executeTrap() para códigos desconocidos
//   solo sería alcanzable inyectando un binario a mano, no compilando un programa real.

describe('TRAP 1/2 (no soportados: open/close)', () => {
  // TRAP siempre escribe su resultado en R1 (ver AsgJumpInstruction.fromText), así que basta con
  // no encadenar nada después que lo sobreescriba.
  runAcrossMachines('TRAP 1 (open) devuelve -1 en R1, en cualquier configuración de máquina', '.text\ntrap 1', (processor) => {
    expect(processor.getRegisters()[1]).toBe(-1);
  });

  runAcrossMachines('TRAP 2 (close) devuelve -1 en R1, en cualquier configuración de máquina', '.text\ntrap 2', (processor) => {
    expect(processor.getRegisters()[1]).toBe(-1);
  });
});

describe('TRAP 3 (read) con descriptor de fichero no soportado', () => {
  runAcrossMachines(
    'un fd distinto de 0 (stdin) devuelve -1 sin pedir entrada, en cualquier configuración de máquina',
    `
      .data
      p_read: .word 5, 0, 0
      .text
      addi r14, r0, p_read
      trap 3
    `,
    (processor) => {
      expect(processor.getRegisters()[1]).toBe(-1);
      expect(processor.trapStdinRequest()).toBeNull();
    },
  );
});

describe('TRAP 4 (write)', () => {
  runAcrossMachines(
    'escribe exactamente los bytes indicados a stdout (fd=1), en cualquier configuración de máquina',
    `
      .data
      msg:     .ascii "Hola TRAP4\\n"
      .align 2
      p_write: .word 1, msg, 11
      .text
      addi r14, r0, p_write
      trap 4
    `,
    (processor) => {
      expect(processor.consoleOutput().join('')).toBe('Hola TRAP4\n');
      expect(processor.getRegisters()[1]).toBe(11); // TRAP 4 devuelve el nº de bytes escritos
    },
  );

  runAcrossMachines(
    'un fd que no es 1 (stdout) ni 2 (stderr) devuelve -1 sin escribir nada, en cualquier configuración de máquina',
    `
      .data
      p_write: .word 9, 0, 0
      .text
      addi r14, r0, p_write
      trap 4
    `,
    (processor) => {
      expect(processor.getRegisters()[1]).toBe(-1);
      expect(processor.consoleOutput()).toEqual([]);
    },
  );
});

describe('Excepción FP_INVALID_OPERATION (NaN + NaN)', () => {
  runAcrossMachines(
    'detecta NaN al operar con el patrón de bits IEEE-754 de NaN, en cualquier configuración de máquina',
    `
      .text
      lhi  r1, #0x7FF8   ; r1 = 0x7FF80000 (mitad alta de un NaN silencioso de doble precisión)
      sw   0(r0), r1     ; mem[0..3]
      sw   4(r0), r0     ; mem[4..7] = 0
      ld   f0, 0(r0)     ; f0 = NaN (bits 0x7FF8000000000000)
      addd f2, f0, f0    ; NaN + NaN = NaN -> FP_INVALID_OPERATION
    `,
    (processor) => {
      expect(processor.cause()).toBe('FP_INVALID_OPERATION');
    },
  );
});

describe('Excepción ILLEGAL_INSTRUCTION (decodificación real de un opcode desconocido)', () => {
  // No se puede generar esto ensamblando texto (el ensamblador nunca emite un opcode inválido),
  // así que se ensambla un programa válido y se corrompe a mano la primera instrucción de usuario
  // con una palabra que no corresponde a ningún opcode/func del mapa (opcode 0x00 - familia
  // Tipo-R - con func 0x7FF, fuera del rango de 6 bits que usan los func reales).
  const PROCESSORS: [string, Type<AsgProcessorService>][] = [
    ['pipelined', AsgPipelinedProcessorService],
    ['monociclo (non-pipelined)', AsgNonPipelinedProcessorService],
    ['superescalar', AsgSuperscalarProcessorService],
  ];

  it.each(PROCESSORS)('%s salta al manejador de usuario al decodificar un opcode inválido', (_name, ProcessorType) => {
    freshTestBed();
    const assembler = TestBed.inject(AsgAssemblerService);
    const processor = TestBed.inject(ProcessorType);
    TestBed.tick();

    const result = assembler.assembleProgram([{
      name: 'main', source: `
      .text
      main: NOP
      trap 0

      __illegal_instr_handler:
        addi r5, r0, #999
        rfe
    `}]);
    expect(result.success).toBe(true);

    // Corrompe la primera instrucción de usuario (el NOP en "main") con un opcode/func inválido.
    const patched = new Uint8Array(result.instructionBinary);
    new DataView(patched.buffer).setUint32(result.initialCodePtr, 0x000007ff, false);

    processor.load(patched, result.dataBuffer, result.initialCodePtr);

    let cycles = 0;
    while (!processor.isFinished() && cycles < 5000) {
      processor.nextCycle();
      cycles++;
    }

    expect(processor.getRegisters()[5]).toBe(999);
  });
});
