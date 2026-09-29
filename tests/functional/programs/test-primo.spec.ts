import { runAcrossMachines } from '../run-program';

// Programa raíz: test_primo.asm
const SOURCE = `
.data
msg_prompt:  .ascii "Introduce un numero (2-99): "
.align 2
msg_prime:   .ascii "El numero %d es PRIMO.\\n"
.align 2
msg_not:     .ascii "El numero %d NO es primo.\\n"
.align 2
buffer:      .space 20

.align 2
p_read:      .word 0, buffer, 10
.align 2
p_print:     .word 0, 0

.text
main:
    ; 1. Mostrar prompt inicial
    addi r1, r0, msg_prompt
    sw   p_print, r1
    addi r14, r0, p_print
    trap 5

    ; 2. Leer número del usuario
    addi r14, r0, p_read
    trap 3

    ; 3. Convertir ASCII a Entero (atoi)
    addi r2, r0, buffer     ; R2 = puntero al buffer
    addi r3, r0, #0         ; R3 = acumulador

loop_atoi:
    lb   r4, 0(r2)          ; Leer byte
    addi r5, r4, #-48       ; ASCII a int ('0'=48)
    bltz r5, end_atoi
    addi r6, r0, #9
    sub  r6, r6, r5
    bltz r6, end_atoi

    ; acumulador = (acumulador * 10) + digito
    slli r7, r3, #3         ; *8
    slli r8, r3, #1         ; *2
    add  r3, r7, r8         ; *10
    add  r3, r3, r5

    addi r2, r2, #1
    j    loop_atoi

end_atoi:
    ; Probar si R3 es primo
    addi r6, r0, #2
    sub  r7, r3, r6
    bltz r7, is_not_prime

    addi r10, r0, #2        ; divisor

check_loop:
    sub  r7, r10, r3
    beqz r7, is_prime

    div  r11, r3, r10
    mult r12, r11, r10
    sub  r13, r3, r12

    beqz r13, is_not_prime

    addi r10, r10, #1
    j    check_loop

is_prime:
    addi r1, r0, msg_prime
    j    print_result

is_not_prime:
    addi r1, r0, msg_not

print_result:
    sw   p_print, r1        ; fmtPtr
    addi r10, r0, p_print
    sw   4(r10), r3         ; arg1
    addi r14, r0, p_print
    trap 5

    trap 0
`;

describe('test_primo.asm', () => {
  runAcrossMachines(
    'reconoce 17 como número primo, en cualquier configuración de máquina',
    SOURCE,
    (processor) => {
      expect(processor.consoleOutput().join('')).toContain('El numero 17 es PRIMO.');
    },
    { stdin: ['17'], maxCycles: 20000 },
  );

  runAcrossMachines(
    'reconoce 15 como número no primo, en cualquier configuración de máquina',
    SOURCE,
    (processor) => {
      expect(processor.consoleOutput().join('')).toContain('El numero 15 NO es primo.');
    },
    { stdin: ['15'], maxCycles: 20000 },
  );
});
