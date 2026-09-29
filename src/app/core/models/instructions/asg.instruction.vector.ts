import {AsgInstruction} from './asg.instruction';
import {ASG_MAP} from '../asg.map';
import {parseReadReg, parseWriteReg} from '../../helpers/asg.utils';

/**
 * Clase para manejar las instrucciones de tipo vector
 * Vienen definidas en el libro como extensión vectorial, podría incluirlas en los tipos ya definidos realmente, pero creo su clase para que sean mas sencillas de manejar
 * Genera su objeto propio desde texto (compilador) y desde binario (en tiempo de ejecución)
 */
export class AsgVectorInstruction extends AsgInstruction {

  private constructor(id: number, pc: number, opcode: string, rs1: number, rs2: number, rd?: number) {
    super(id, pc, opcode, rd, rs1, rs2, undefined);
  }

  public static fromText(line: number, pc: number, opcode: string, args: string[], config: typeof ASG_MAP[string]): AsgVectorInstruction {
    let vs1, vs2;

    if (config.argNum === 2) {
      // Comparaciones vectoriales: sin registro destino, el resultado va a VM
      if (opcode.includes('SV')) {
        vs1 = parseReadReg(line, args[0], 'F');
        vs2 = parseReadReg(line, args[1], config.origin);
      } else if (opcode.includes('VS')) {
        vs1 = parseReadReg(line, args[0], config.origin);
        vs2 = parseReadReg(line, args[1], 'F');
      } else {
        vs1 = parseReadReg(line, args[0], config.origin);
        vs2 = parseReadReg(line, args[1], config.origin);
      }
      return new AsgVectorInstruction(line, pc, opcode, vs1, vs2);
    }

    // argNum === 3: Vd, Vs1, Vs2 — destino explícito
    const vd = parseWriteReg(line, args[0], config.target);
    if (opcode.includes('SV')) {
      vs1 = parseReadReg(line, args[1], 'F');
      vs2 = parseReadReg(line, args[2], config.target);
    } else if (opcode.includes('VS')) {
      vs1 = parseReadReg(line, args[1], config.target);
      vs2 = parseReadReg(line, args[2], 'F');
    } else {
      vs1 = parseReadReg(line, args[1], config.target);
      vs2 = parseReadReg(line, args[2], config.target);
    }
    return new AsgVectorInstruction(line, pc, opcode, vs1, vs2, vd);
  }

  /**
   * Decodifica una palabra de 32 bits para operaciones vectoriales.
   * Formato (Tipo-R): [ Opcode(6) | VS1(5) | VS2(5) | VD(5) | Func(11) ]
   */
  public static fromBinary(line: number, pc: number, opcode: string, word: number): AsgVectorInstruction {
    const vs1 = (word >>> 21) & 0x1F;
    const vs2 = (word >>> 16) & 0x1F;
    const vd  = (word >>> 11) & 0x1F;

    const config = ASG_MAP[opcode];
    // Comparaciones vectoriales (argNum === 2): sin registro destino
    if (config?.argNum === 2)
      return new AsgVectorInstruction(line, pc, opcode, vs1, vs2);

    return new AsgVectorInstruction(line, pc, opcode, vs1, vs2, vd);
  }

  /**
   * Obtención de su binario propio de la instruccion conversion
   * Formato [ Op(6) | vs1(5) | vs2(5) | vd(5) | func(11) ]
   */
  public override assemble(): number {
    return (this.config.opcode << 26) | (this.rs1! << 21) | (this.rs2! << 16) | (this.rd! << 11) | this.config.func!;
  }

  /**
   * Necesito sobreescribir este metodo para meter la latencia inicial de todas las instrucciones vectoriales
   * @param cycles
   */
  override setCyclesRemaining(cycles: number) {
    this.cyclesRemaining = cycles;
    // operaciones funcionales con vectores siempre tienen delay inicial, no final
    this.initDelay = this.cyclesRemaining;
  }

  /**
   * Obtención de la instrucción original en texto plano
   */
  public override toString(): string {
    let rs1, rs2: string;

    if (this.opcode.includes('SV')) {
      rs1 = this.getRegName(this.rs1, 'F');
      rs2 = this.getRegName(this.rs2, this.config.target);
    } else if (this.opcode.includes('VS')) {
      rs1 = this.getRegName(this.rs1, this.config.target);
      rs2 = this.getRegName(this.rs2, 'F');
    } else {
      rs1 = this.getRegName(this.rs1, this.config.target);
      rs2 = this.getRegName(this.rs2, this.config.target);
    }

    // Comparaciones vectoriales (argNum === 2): sin destino, resultado en VM
    if (this.config.argNum === 2)
      return `${this.opcode} ${rs1}, ${rs2}`;

    return `${this.opcode} ${this.getRegName(this.rd, this.config.target)}, ${rs1}, ${rs2}`;
  }

}
