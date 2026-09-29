import {AsgInstruction} from './asg.instruction';
import {ASG_MAP} from '../asg.map';
import {parseReadReg, parseWriteReg} from '../../helpers/asg.utils';
import {AssemblerError} from '../asg.exceptions';

/**
 * Clase para manejar las instrucciones de tipo conversión
 * No vienen definidas en la asg del libro como un tipo propio, pero las incluyo aquí para facilitar calculos
 * Genera su objeto propio desde texto (compilador) y desde binario (en tiempo de ejecución)
 * TODO: las traducciones de assembleError con transloco son con métodos estáticos y no es facil de realizar
 */
export class AsgConversionInstruction extends AsgInstruction {

  private constructor(id: number, pc: number, opcode: string, rd?: number, rs1?: number) {
    super(id, pc, opcode, rd, rs1);
  }

  public static fromText(line: number, pc: number, opcode: string, args: string[], config: typeof ASG_MAP[string]): AsgConversionInstruction {
    // MOVI2S VLR, Rs → VLR = Rs
    if (opcode === 'MOVI2S') {
      if (args[0].toUpperCase() !== 'VLR')
        throw new AssemblerError(`Línea ${line}: MOVI2S espera 'VLR' como primer operando, se encontró '${args[0]}'.`, line);
      return new AsgConversionInstruction(line, pc, opcode, undefined, parseReadReg(line, args[1], 'R'));
    }
    // MOVS2I Rd, VLR → Rd = VLR
    if (opcode === 'MOVS2I') {
      if (args[1].toUpperCase() !== 'VLR')
        throw new AssemblerError(`Línea ${line}: MOVS2I espera 'VLR' como segundo operando, se encontró '${args[1]}'.`, line);
      return new AsgConversionInstruction(line, pc, opcode, parseWriteReg(line, args[0], 'R'), undefined);
    }
    // MOVF2S VM, Fs → VM = Fs
    if (opcode === 'MOVF2S') {
      if (args[0].toUpperCase() !== 'VM')
        throw new AssemblerError(`Línea ${line}: MOVF2S espera 'VM' como primer operando, se encontró '${args[0]}'.`, line);
      return new AsgConversionInstruction(line, pc, opcode, undefined, parseReadReg(line, args[1], 'F'));
    }
    // MOVS2F Fd, VM → Fd = VM
    if (opcode === 'MOVS2F') {
      if (args[1].toUpperCase() !== 'VM')
        throw new AssemblerError(`Línea ${line}: MOVS2F espera 'VM' como segundo operando, se encontró '${args[1]}'.`, line);
      return new AsgConversionInstruction(line, pc, opcode, parseWriteReg(line, args[0], 'F'), undefined);
    }
    // POP Rd, VM → Rd = popcount(VM) (cuenta los 1s en la máscara vectorial)
    if (opcode === 'POP') {
      if (args[1].toUpperCase() !== 'VM')
        throw new AssemblerError(`Línea ${line}: POP espera 'VM' como segundo operando, se encontró '${args[1]}'.`, line);
      return new AsgConversionInstruction(line, pc, opcode, parseWriteReg(line, args[0], 'R'), undefined);
    }

    return new AsgConversionInstruction(line, pc, opcode, parseWriteReg(line, args[0], config.target), parseReadReg(line, args[1], config.origin));
  }

  public static fromBinary(line: number, pc: number, opcode: string, word: number): AsgConversionInstruction {
    const rs1 = (word >>> 21) & 0x1F;
    const rd  = (word >>> 11) & 0x1F;

    if (opcode === 'MOVI2S' || opcode === 'MOVF2S') {
      // No es necesario pasar RD, se resolvera en la etapa ex
      return new AsgConversionInstruction(line, pc, opcode, undefined, rs1);
    }
    if (opcode === 'MOVS2I' || opcode === 'MOVS2F' || opcode === 'POP') {
      // No es necesario pasar rs1, se resolverá en la etapa ex
      return new AsgConversionInstruction(line, pc, opcode, rd, undefined);
    }

    return new AsgConversionInstruction(line, pc, opcode, rd, rs1);
  }

  /**
   * Obtención de su binario propio de la instruccion conversion
   * [ Op(6) | rs1(5) | 0(5) | rd(5) | 0(5) | func(6) ]
   */
  public override assemble(): number {
    return (this.config.opcode << 26) | ((this.rs1 ?? 0) << 21) | (0 << 16) | ((this.rd ?? 0) << 11) | (0 << 6) | this.config.func!;
  }

  /**
   * Obtención de la instrucción original en texto plano
   */
  public override toString(): string {
    if (this.opcode === 'MOVI2S') return `MOVI2S VLR, R${this.rs1}`;
    if (this.opcode === 'MOVS2I') return `MOVS2I R${this.rd}, VLR`;
    if (this.opcode === 'MOVF2S') return `MOVF2S VM, F${this.rs1}`;
    if (this.opcode === 'MOVS2F') return `MOVS2F F${this.rd}, VM`;
    if (this.opcode === 'POP') return `POP R${this.rd}, VM`;
    return `${this.opcode} ${this.getRegName(this.rd, this.config.target)}, ${this.getRegName(this.rs1, this.config.origin)}`;
  }
}
