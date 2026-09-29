import { AsgInstruction } from './asg.instruction';
import {ASG_MAP} from '../asg.map';
import {parseNumberImmediate, parseReadReg, parseWriteReg} from '../../helpers/asg.utils';

/**
 * Opcodes tipo-I cuyo inmediato de 16 bits es logico o sin signo hay que tratarlo como zero-extend para que no de problemas a la hora de ejecutarse (el resto hacemos el sign-extend)
 */
const ZERO_EXTEND_IMMEDIATE_OPCODES = new Set([
  'ANDI', 'ORI', 'XORI', 'LHI',
  'ADDUI', 'SUBUI',
  'SLLI', 'SRLI', 'SRAI',
  'SEQUI', 'SNEUI', 'SLTUI', 'SGTUI', 'SLEUI', 'SGEUI',
]);

/**
 * Clase para manejar las instrucciones de tipo inmediato
 * No vienen definidas en la asg del libro como un tipo propio, pero las incluyo aquí para facilitar calculos
 * Genera su objeto propio desde texto (compilador) y desde binario (en tiempo de ejecución)
 */
export class AsgImmediateInstruction extends AsgInstruction {

  private constructor(id: number, pc:number, opcode: string, rd: number, imm: number, rs1?: number) {
    super(id, pc, opcode, rd, rs1, undefined, imm);

  }

  public static fromText(line: number, pc: number, opcode: string, args: string[], config: typeof ASG_MAP[string]): AsgImmediateInstruction {
    //primer argumento siempre registro resultado
    let rd, imm, rs1;
    rd = parseWriteReg(line, args[0], config.target);
    //caso LHI
    if (args.length == 2) {
      //segundo argumento es un numero inmediato
      imm = parseNumberImmediate(line, args[1]);
    } else {
      //segundo argumento deben ser un registro, tercer argumento un inmediato
      rs1 = parseReadReg(line, args[1], config.target);
      imm = parseNumberImmediate(line, args[2]);
    }

    return new AsgImmediateInstruction(line, pc, opcode, rd, imm, rs1);
  }

  /**
   * Decodifica una palabra de 32 bits para instrucciones tipo ADDI, ANDI, etc.
   * Formato: [ Opcode(6) | RS1(5) | RD(5) | Inmediato(16) ]
   */
  public static fromBinary(line: number, pc: number, opcode: string, word: number): AsgImmediateInstruction {
    // RS1 (Registro fuente) -> Bits 21-25
    const rs1 = (word >>> 21) & 0x1F;
    // RD (Registro destino) -> Bits 16-20
    const rd = (word >>> 16) & 0x1F;
    // Inmediato -> Bits 0-15
    let imm = word & 0xFFFF;

    // Extensión de signo (necesario para que el número sea valido en JS si es negativo).
    // NO aplica a opcodes que tratan el numero sin signo y hay que dejarlo tal cual
    // un inmediato como #0xFFFF en un ORI se convertiría en -1 en vez de 65535. (esto viene como correccion a las pruebas del test de signo)
    if ((imm & 0x8000) && !ZERO_EXTEND_IMMEDIATE_OPCODES.has(opcode))
      imm |= 0xFFFF0000;

    return new AsgImmediateInstruction(line, pc, opcode, rd, imm, rs1);
  }

  /**
   * Obtención de su binario propio de la instruccion conversion
   * [ Op(6) | rs1(5) | rd(5) | imm(16) ]
   */
  public override assemble(): number {
    return (this.config.opcode << 26) | (this.rs1! << 21) | (this.rd! << 16) | this.imm! & 0xFFFF;
  }

  /**
   * Obtención de la instrucción original en texto plano
   */
  public override toString(): string {
    return `${this.opcode} ${this.getRegName(this.rd, this.config.target)}, ${this.getRegName(this.rs1, this.config.target)}, #${this.imm}`;
  }
}
