import {ASG_MAP} from '../asg.map';
import {AsgInstruction} from './asg.instruction';
import {AssemblerError} from '../asg.exceptions';
import {parseLabel, parseReadReg} from '../../helpers/asg.utils';

/**
 * Clase para manejar las instrucciones de tipo salto
 * Genera su objeto propio desde texto (compilador) y desde binario (en tiempo de ejecución)
 * TODO: las traducciones de assembleError con transloco son con métodos estáticos y no es facil de realizar
 * TODO: guardar los parametros de trap r14 y r1 en la conversion a memoria y su decodificacion para no hacerlo a mano
 */
export class AsgJumpInstruction extends AsgInstruction {

  private constructor(id: number, pc: number, opcode: string, imm: number, rs1?: number, rd?: number) {
    super(id, pc, opcode, rd, rs1, undefined, imm);
  }

  public static fromText(line: number, pc: number, opcode: string, args: string[], config: typeof ASG_MAP[string]): AsgJumpInstruction {
    // RFE: sin argumentos, se resolverá en ex con el valor de iar.
    if (opcode === 'RFE')
      return new AsgJumpInstruction(line, pc, opcode, 0);

    // TRAP recibe un código numérico (0-6).
    // rs1 = 14 para que se genere la dependencia del registro.
    // rd = 1 porque TRAP escribe el resultado de la operación en R1.
    if (opcode === 'TRAP') {
      const trapCode = parseInt(args[0], 10);
      if (isNaN(trapCode) || trapCode < 0 || trapCode > 6)
        throw new AssemblerError(`Línea ${line}: Código de TRAP inválido "${args[0]}". Debe ser un número entero 0-6.`, line);
      return new AsgJumpInstruction(line, pc, opcode, trapCode, 14, 1);
    }

    // JR / JALR: el argumento es un registro cuyo VALOR es la dirección de salto.
    // Almacenamos el índice del registro en rs1 para que ex lo resuelva (por si hay forwarding)
    // JALR escribe en R31 (rd=31), JR no escribe (rd=undefined)
    if (opcode === 'JR' || opcode === 'JALR') {
      const regNum = parseReadReg(line, args[0], config.target);
      const rd = opcode === 'JALR' ? 31 : undefined;
      return new AsgJumpInstruction(line, pc, opcode, 0, regNum, rd);
    }

    // J / JAL: el argumento es una etiqueta de texto (dirección de salto absoluta).
    // JAL escribe en R31 (rd=31), J no escribe (rd=undefined)
    const imm = parseLabel(line, args[0]);
    const rd = opcode === 'JAL' ? 31 : undefined;
    return new AsgJumpInstruction(line, pc, opcode, imm, undefined, rd);
  }

  public static fromBinary(line: number, pc: number, opcode: string, word: number): AsgJumpInstruction {
    // RFE: sin operandos.
    if (opcode === 'RFE')
      return new AsgJumpInstruction(line, pc, opcode, 0);


    // TRAP, siempre r14 y r1
    if (opcode === 'TRAP') {
      const trapCode = word & 0x3FFFFFF;
      return new AsgJumpInstruction(line, pc, opcode, trapCode, 14, 1);
    }

    // JR / JALR: rs1 está en bits 25:21
    // JALR escribe en R31 (rd=31), JR no escribe
    if (opcode === 'JR' || opcode === 'JALR') {
      const rs1 = (word >> 21) & 0x1F;
      const rd = opcode === 'JALR' ? 31 : undefined;
      return new AsgJumpInstruction(line, pc, opcode, 0, rs1, rd);
    }

    // J / JAL: etiqueta en los 26 bits inferiores
    // JAL escribe en R31 (rd=31), J no escribe
    const imm = word & 0x3FFFFFF;
    const rd = opcode === 'JAL' ? 31 : undefined;
    return new AsgJumpInstruction(line, pc, opcode, imm, undefined, rd);
  }

  /**
   * Obtención de su binario propio de la instruccion conversion
   * Formato J: [ Opcode(6) | Target(26) ]
   * Formato JR/JALR: [ Opcode(6) | rs1(5) | 0(21) ]
   * Formato RFE: [ Opcode(6) | 0(26) ]
   * Formato TRAP: [ Opcode(6) | Target(26) ]
   */
  public override assemble(): number {
    const opField = this.config.opcode << 26;

    // RFE: solo el opcode, sin operandos.
    if (this.opcode === 'RFE') return opField;

    // JR / JALR: rs1 va en bits 25:21
    if (this.opcode === 'JR' || this.opcode === 'JALR')
      return opField | ((this.rs1! & 0x1F) << 21);

    // J / JAL: target en los 26 bits inferiores.
    // Si el 'imm' es una dirección absoluta la normalizamos (dir >>> 2).
    let targetField = this.imm! & 0x3FFFFFF;
    if (this.imm! > 0x3FFFFFF)
      targetField = (this.imm! >>> 2) & 0x3FFFFFF;

    return opField | targetField;
  }

  /**
   * Obtención de la instrucción original en texto plano
   */
  public override toString(): string {
    if (this.opcode === 'RFE')  return 'RFE';
    if (this.opcode === 'TRAP') return `TRAP ${this.imm}`;
    if (this.opcode === 'JR' || this.opcode === 'JALR') return `${this.opcode} R${this.rs1}`;

    return `${this.opcode} ${this.getLabelOrHex(this.imm!, 'TEXT', true)}`;
  }

}
