import { runAcrossMachines } from '../run-program';

// Programas raíz: factorial.s (módulo principal) + input.s (subrutina InputUnsigned, combinada como
// segundo módulo del mismo ensamblado, igual que se haría cargando ambos ficheros en el editor).
const INPUT_MODULE = `
.data
	;*** Data for Read-Trap
	ReadBuffer: .space 80
	ReadPar: .word 0,ReadBuffer,80
	;*** Data for Printf-Trap
	PrintfPar: .space 4
		SaveR2: .space 4
		SaveR3: .space 4
		SaveR4: .space 4
		SaveR5: .space 4
.text
	.global InputUnsigned
InputUnsigned:
	;*** save register contents
	sw SaveR2,r2
	sw SaveR3,r3
	sw SaveR4,r4
	sw SaveR5,r5
	;*** Prompt
	sw PrintfPar,r1
	addi r14,r0,PrintfPar
	trap 5
	;*** call Trap-3 to read line
	addi r14,r0,ReadPar
	trap 3
	;*** determine value
	addi r2,r0,ReadBuffer
	addi r1,r0,#0
	addi r4,r0,#10 ;Decimal system
	Loop: ;*** reads digits to end of line
		lbu r3,0(r2)
		seqi r5,r3,#10 ;LF -> Exit
		bnez r5,Finish
		subi r3,r3,#48 ;'0'
		multu r1,r1,r4 ;Shift decimal
		add r1,r1,r3
		addi r2,r2,#1 ;increment pointer
		j Loop
	Finish: ;*** restore old register contents
		lw r2,SaveR2
		lw r3,SaveR3
		lw r4,SaveR4
		lw r5,SaveR5
		jr r31 ; Return
`;

const FACTORIAL_MODULE = `
.data
Prompt:
	.asciiz "A value >1:\\n"
PrintfFormat:
	.asciiz "Factorial = %g\\n\\n"
	.align 2
PrintfPar:
	.word PrintfFormat
PrintfValue:
	.space 8
.text
;*** Read from stdin into R1
addi r1,r0,Prompt
jal InputUnsigned
;*** init values
movi2fp f10,r1
cvti2d f0,f10 ;D0..Count register
addi r2,r0,#1
movi2fp f11,r2
cvti2d f2,f11 ;D2..result
movd f4,f2 ;D4..Constant 1
Loop: ;*** Break loop if D0 = 1
	led f0,f4 ;D0<=1 ?
	bfpt Finish
	;*** Multiplication and next loop
	multd f2,f2,f0
	subd f0,f0,f4
	j Loop
Finish: ;*** write result to stdout
	sd PrintfValue,f2
	addi r14,r0,PrintfPar
	trap 5
	trap 0
`;

describe('factorial.s + input.s', () => {
  // El primer módulo determina el punto de entrada (initialCodePtr): factorial.s debe ir
  // primero para que la ejecución arranque en su "main" y no dentro de la subrutina InputUnsigned.
  runAcrossMachines(
    'lee 5 desde teclado y calcula 5! = 120, en cualquier configuración de máquina',
    [
      { name: 'factorial', source: FACTORIAL_MODULE },
      { name: 'input', source: INPUT_MODULE },
    ],
    (processor) => {
      expect(processor.consoleOutput().join('')).toContain('Factorial = 120.000');
    },
    // InputUnsigned solo termina de leer al encontrar un salto de línea (LF); hay que simular
    // el Enter del usuario igual que con cualquier lectura por teclado (trap 3).
    { stdin: ['5\n'], maxCycles: 20000 },
  );
});
