import {ASG_MAP} from '../asg.map';
import {AsgInstruction} from './asg.instruction';
import {parseLabel, parseReadReg} from '../../helpers/asg.utils';

/**
 * Clase para manejar las instrucciones de tipo branch
 * Genera su objeto propio desde texto (compilador) y desde binario (en tiempo de ejecución)
 */
export class AsgBranchInstruction extends AsgInstruction {

  private constructor(id: number, pc: number, opcode: string, rs1: number, imm: number) {
    super(id, pc, opcode, undefined, rs1, undefined, imm);
  }

  public static fromText(line: number, pc: number, opcode: string, args: string[], config: typeof ASG_MAP[string]): AsgBranchInstruction {
    // BFPT / BFPF: solo llevan la etiqueta de salto, internamente la condición se evalua con el bit de condicion de la maquina FPBC
    if (config.argNum === 1)
      return new AsgBranchInstruction(line, pc, opcode, 0, parseLabel(line, args[0]));

    // BEQZ / BNEZ / BGTZ / BLTZ: registro de la condicion + etiqueta de salto
    return new AsgBranchInstruction(line, pc, opcode, parseReadReg(line, args[0], config.target), parseLabel(line, args[1]));
  }

  public static fromBinary(line: number, pc: number, opcode: string, word: number): AsgBranchInstruction {
    // Extraer el registro de condición (rs1) → bits 25:21
    const rs1 = (word >>> 21) & 0x1F;
    // Extraer el inmediato de 16 bits → bits 15:0
    let imm = word & 0xFFFF;

    // Extensión de signo: si el bit 15 está activo es negativo
    if (imm & 0x8000)
      imm |= 0xFFFF0000;

    // BFPT / BFPF: solo etiqueta de salto
    const config = ASG_MAP[opcode];
    if (config?.argNum === 1)
      return new AsgBranchInstruction(line, pc, opcode, 0, imm);

    return new AsgBranchInstruction(line, pc, opcode, rs1, imm);
  }

  /**
   * Obtención de su binario propio de la instruccion branch
   * [ Op(6) | rs1(5) | 0(5) | offset(16) ]
   */
  public override assemble(): number {
    return (this.config.opcode << 26) | (this.rs1! << 21) | this.imm! & 0xFFFF;
  }

  /**
   * Obtención de la instrucción original en texto plano
   */
  public override toString(): string {
    if (this.config.argNum === 1)
      return `${this.opcode} ${this.getLabelOrHex(this.imm!, 'TEXT', true)}`;

    return `${this.opcode} ${this.getRegName(this.rs1, this.config.target)}, ${this.getLabelOrHex(this.imm!, 'TEXT', true)}`;
  }

}
