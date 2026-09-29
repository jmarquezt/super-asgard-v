import { runAcrossMachines } from '../run-program';

// Programa raíz: InputSigned.asm
//
// AVISO: el fichero original usa direccionamiento "ETIQUETA(r0)" (ej. "sw SaveR2(r0), r2") e
// inmediatos sin '#' (ej. "seqi r5, r3, 45"). Ninguna de las dos formas es válida en la gramática
// actual de asg.instruction.memory.ts (parseMem exige un desplazamiento NUMÉRICO, no una etiqueta)
// ni en asg.utils.ts (parseNumberImmediate exige el prefijo '#'), así que el fichero, tal cual está
// en el repositorio, no llega a ensamblar. Aquí se reproduce exactamente la misma lógica cambiando
// "ETIQUETA(r0)" por el direccionamiento directo "ETIQUETA" y añadiendo el '#' que falta en los
// inmediatos, para poder verificar el algoritmo (signo, dígitos, error de tipo).
//
// AVISO 2 (bug real de lógica, no de sintaxis): el fichero original pone "addi r1, r0, #0" (poner
// a cero el acumulador) ANTES de "trap 3". Pero resolveTrapStdin() hace
// `this.registerFile.writeIntRegister(1, bytes)` — TRAP 3 (read), igual que cualquier TRAP,
// también escribe su valor de retorno (bytes leídos) en R1 — así que ese "cero" queda sobrescrito
// por la longitud de la línea leída justo antes de que el bucle de dígitos empiece a acumular sobre
// R1. Comparado con input.s, donde "InputUnsigned" sí pone a cero el acumulador DESPUÉS de "trap 3",
// se confirma que es un fallo del propio fichero: aquí se corrige el orden para poder comprobar el
// algoritmo de verdad (signo y dígitos) en vez de este efecto colateral.
//
// Al no tener un "main" que la invoque, el ensamblador arranca directamente en la propia
// subrutina InputSigned (es la primera instrucción de .text). Al terminar hace `jr r31`
// con R31=0, lo que salta al vector RESET (dirección 0) y termina el programa a través del
// manejador por defecto (TRAP 6), igual que ocurriría al cargar este fichero solo en el editor.
//
// BUG CONOCIDO (monociclo): ambos tests fallan en la variante [monociclo (non-pipelined)] con
// R1=0 en vez del valor esperado — como si el bucle de dígitos nunca llegara a ejecutarse tras
// resolver el TRAP 3. Punto sospechoso sin confirmar del todo: en
// asg.non-pipelined.processor.ts (~línea 911-915), al reentrar en la etapa EX de un TRAP 3 ya
// resuelto (`fd === 0 && instr.result !== undefined`), el código hace
// `this.currentStage = 'EX'; return;` en vez de avanzar la instrucción a MEM/completarla — parece
// una etapa que nunca progresa. Se deja en rojo a propósito como marcador del bug hasta
// investigarlo con más detalle (o ejecutando paso a paso).
const SOURCE = `
.data
    ;*** Buffers de lectura
    ReadBuffer: .space 80
    ReadPar:    .word 0, ReadBuffer, 80

    ;*** Parámetros de impresión y backup de registros
    PrintfPar:  .space 4
    SaveR2:     .word 0
    SaveR3:     .word 0
    SaveR4:     .word 0
    SaveR5:     .word 0
    SaveR6:     .word 0  ; Registro extra para validación

    ;*** Variables de estado
    IsNegative: .word 0  ; 0 = Positivo, 1 = Negativo
    ErrorFlag:  .word 0  ; 0 = OK, 1 = Carácter inválido

.text
    .global InputSigned

InputSigned:
    ;*** 1. Guardar registros (Context Save)
    sw SaveR2, r2
    sw SaveR3, r3
    sw SaveR4, r4
    sw SaveR5, r5
    sw SaveR6, r6

    ;*** 2. Inicialización
    addi r10, r0, #0     ; r10 = Error Flag (0 por defecto)
    sw IsNegative, r0
    sw ErrorFlag, r0

    ;*** 3. Entrada de datos
    addi r14, r0, ReadPar
    trap 3              ; Leer línea del teclado -> ReadBuffer (TRAP 3 escribe bytes leídos en R1)
    addi r1, r0, #0      ; r1 = Acumulador resultado (a cero DESPUÉS del trap, ver AVISO 2 arriba)

    ;*** 4. Comprobar signo negativo en el primer carácter
    addi r2, r0, ReadBuffer
    lbu  r3, 0(r2)      ; Leer primer byte
    seqi r5, r3, #45     ; 45 es el código ASCII de '-'
    beqz r5, CheckDigit ; Si no es '-', empezamos a procesar dígitos

    ; Si es negativo:
    addi r5, r0, #1
    sw IsNegative, r5 ; Marcar como negativo
    addi r2, r2, #1      ; Avanzar puntero para saltar el '-'

CheckDigit:
    addi r4, r0, #10     ; Base decimal

Loop:
    lbu  r3, 0(r2)      ; Cargar carácter

    ; ¿Es el fin de línea (LF = 10)?
    seqi r5, r3, #10
    bnez r5, ApplySign  ; Si es Enter, terminar y aplicar signo

    ; --- VALIDACIÓN DE CARÁCTER ---
    slti r5, r3, #48
    sgti r6, r3, #57
    or   r5, r5, r6     ; Si r5 o r6 son 1, el carácter es inválido
    bnez r5, TypeError  ; Saltar a error si no es un número

    ; --- CONVERSIÓN ---
    subi r3, r3, #48     ; Convertir ASCII a valor numérico
    multu r1, r1, r4    ; r1 = r1 * 10
    add  r1, r1, r3     ; r1 = r1 + nuevo dígito

    addi r2, r2, #1      ; Siguiente carácter
    j Loop

TypeError:
    addi r10, r0, #1     ; r10 = 1 (Indica que hubo error)
    j Finish            ; Salir inmediatamente

ApplySign:
    lw   r5, IsNegative
    beqz r5, Finish     ; Si no era negativo, saltar al final
    sub  r1, r0, r1     ; r1 = 0 - r1 (Negar el número)

Finish:
    ;*** Restaurar registros
    lw r2, SaveR2
    lw r3, SaveR3
    lw r4, SaveR4
    lw r5, SaveR5
    lw r6, SaveR6
    jr r31              ; r1 contiene el número, r10 contiene el estado de error
`;

describe('InputSigned.asm', () => {
  // El bucle solo termina al encontrar un salto de línea (LF, código 10): hay que simular
  // el Enter que el usuario pulsaría en un terminal real, igual que con trap 3 sobre teclado.
  runAcrossMachines(
    'lee un número negativo y lo devuelve con el signo aplicado, en cualquier configuración de máquina',
    SOURCE,
    (processor) => {
      const regs = processor.getRegisters();
      expect(regs[1]).toBe(-42);
      expect(regs[10]).toBe(0);
    },
    { stdin: ['-42\n'] },
  );

  runAcrossMachines(
    'marca el flag de error ante un carácter no numérico, en cualquier configuración de máquina',
    SOURCE,
    (processor) => {
      const regs = processor.getRegisters();
      expect(regs[1]).toBe(12);
      expect(regs[10]).toBe(1);
    },
    { stdin: ['12a\n'] },
  );
});
