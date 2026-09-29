import {AsgInstruction} from './asg.instruction';
import {ASG_MAP} from '../asg.map';
import {parseReadReg, parseWriteReg} from '../../helpers/asg.utils';

/**
 * Clase para manejar las instrucciones de tipo registro - registro
 * Genera su objeto propio desde texto (compilador) y desde binario (en tiempo de ejecución)
 */
export class AsgRegisterInstruction extends AsgInstruction {

  private constructor(id: number, pc: number, opcode: string, rs1: number, rs2: number, rd?: number) {
    super(id, pc, opcode, rd, rs1, rs2);
  }

  public static fromText(line: number, pc: number, opcode: string, args: string[], config: typeof ASG_MAP[string]): AsgRegisterInstruction {
    //Primer, segundo y tercer argumento deben ser un registro, salvo operaciones especiales

    // NOP / CVM: sin argumentos
    if (config.argNum === 0) {
      return new AsgRegisterInstruction(line, pc, opcode, 0, 0, 0);
    } else if (config.argNum === 1) {
      // VM Vs: un único registro fuente (sin destino)
      return new AsgRegisterInstruction(line, pc, opcode, parseReadReg(line, args[0], config.origin), 0);
    } else if (config.argNum === 2) {
      if (opcode === 'CVI') {
        // CVI Vd, Rs — destino vectorial, fuente entera (stride)
        return new AsgRegisterInstruction(line, pc, opcode, parseReadReg(line, args[1], 'R'), 0, parseWriteReg(line, args[0], 'V'));
      }
      // Operaciones de comparación F: dos fuentes, sin registro destino
      return new AsgRegisterInstruction(line, pc, opcode, parseReadReg(line, args[0], config.target), parseReadReg(line, args[1], config.target));
    } else {
      // resto de operaciones con registro
      return new AsgRegisterInstruction(line, pc, opcode, parseReadReg(line, args[1], config.target), parseReadReg(line, args[2], config.target), parseWriteReg(line, args[0], config.target));
    }
  }

  public static fromBinary(line: number, pc: number, opcode: string, word: number): AsgRegisterInstruction {
    const rs1 = (word >>> 21) & 0x1F;
    const rs2 = (word >>> 16) & 0x1F;
    const rd  = (word >>> 11) & 0x1F;

    // Las instrucciones de comparación flotante (argNum === 2) no tienen registro destino: su resultado es el bit de condición FPBC.
    // CVI es excepción: tiene dos argumentos pero el primero es de destino.
    const config = ASG_MAP[opcode];
    if (config?.argNum === 2 && opcode !== 'CVI')
      return new AsgRegisterInstruction(line, pc, opcode, rs1, rs2);

    return new AsgRegisterInstruction(line, pc, opcode, rs1, rs2, rd);
  }

  /**
   * Obtención de su binario propio de la instruccion conversion
   * Formato [ Op(6) | rs1(5) | rs2(5) | rd(5) | shift(5) | func(6) ]
   */
  public override assemble(): number {
    // RS1 y RS2 son fuentes, RD es destino. S (Shift) suele ser 0.
    return (this.config.opcode << 26) | (this.rs1! << 21) | (this.rs2! << 16) | (this.rd! << 11) | this.config.func!;
  }

  /**
   * Obtención de la instrucción original en texto plano
   */
  public override toString(): string {
    const prefix = this.isVector ? 'V' : (this.isFloat ? 'F' : 'R');
    if (this.config.argNum === 0) {
      return `${this.opcode}`;
    }
    if (this.opcode === 'CVI') {
      return `CVI V${this.rd}, R${this.rs1}`;
    }
    if (this.config.argNum === 1 && this.rd === undefined) {
      return `${this.opcode} ${this.getRegName(this.rs1, prefix)}`;
    }
    if (this.rd === undefined) {
      return `${this.opcode} ${this.getRegName(this.rs1, prefix)}, ${this.getRegName(this.rs2, prefix)}`;
    }
    return `${this.opcode} ${this.getRegName(this.rd, prefix)}, ${this.getRegName(this.rs1, prefix)}, ${this.getRegName(this.rs2, prefix)}`;
  }
}
