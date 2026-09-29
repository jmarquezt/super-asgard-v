import { runAcrossMachines } from '../run-program';

// Programa raíz: test_circle_area.asm
const SOURCE = `
.data
.align 3
pi:          .double 3.14159265
zero:        .double 0.0

msg_prompt:  .ascii "Introduce radio (entero positivo): "
.align 2
msg_err:     .ascii "Error: El radio debe ser positivo.\\n"
.align 2
msg_res:     .ascii "Area del circulo = %f\\n"

.align 2
p_read:      .word 0, buffer, 10

.align 3
p_print:     .word 0        ; [Offset 0] fmtPtr
             .word 0        ; [Offset 4] arg1 (High 32 bits de double)
             .word 0        ; [Offset 8] arg1 (Low 32 bits de double)

buffer:      .space 20

.text
main:
    ld   f10, pi
    ld   f12, zero

    addi r1, r0, msg_prompt
    sw   p_print, r1
    addi r14, r0, p_print
    trap 5

    addi r14, r0, p_read
    trap 3

    addi r2, r0, buffer
    addi r1, r0, #0

loop_atoi:
    lb   r4, 0(r2)
    addi r5, r4, #-48
    bltz r5, end_atoi
    addi r6, r0, #9
    sub  r6, r6, r5
    bltz r6, end_atoi
    slli r7, r1, #3
    slli r8, r1, #1
    add  r1, r7, r8
    add  r1, r1, r5
    addi r2, r2, #1
    j    loop_atoi

end_atoi:
    movi2fp f0, r1
    cvti2d  f0, f0

    led  f0, f12
    bfpt error

    multd f2, f0, f0
    multd f2, f2, f10

    addi r1, r0, msg_res
    addi r10, r0, p_print
    sw   0(r10), r1
    sd   4(r10), f2

    addi r14, r0, p_print
    trap 5
    j    end

error:
    addi r1, r0, msg_err
    sw   p_print, r1
    addi r14, r0, p_print
    trap 5

end:
    trap 0
`;

describe('test_circle_area.asm', () => {
  runAcrossMachines(
    'calcula el área para un radio de 5: PI * 5^2 ≈ 78.539816, en cualquier configuración de máquina',
    SOURCE,
    (processor) => {
      expect(processor.consoleOutput().join('')).toContain('Area del circulo = 78.539816');
    },
    { stdin: ['5'], maxCycles: 20000 },
  );

  runAcrossMachines(
    'rechaza un radio de 0 con el mensaje de error, en cualquier configuración de máquina',
    SOURCE,
    (processor) => {
      expect(processor.consoleOutput().join('')).toContain('Error: El radio debe ser positivo.');
    },
    { stdin: ['0'], maxCycles: 20000 },
  );
});
