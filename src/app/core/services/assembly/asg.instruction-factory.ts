import {AsgInstruction} from '../../models/instructions/asg.instruction';
import {AssemblerError, ExceptionCode} from '../../models/asg.exceptions';
import {ASG_MAP} from '../../models/asg.map';
import {AsgMemoryInstruction} from '../../models/instructions/asg.instruction.memory';
import {AsgBranchInstruction} from '../../models/instructions/asg.instruction.branch';
import {AsgJumpInstruction} from '../../models/instructions/asg.instruction.jump';
import {AsgImmediateInstruction} from '../../models/instructions/asg.instruction.immediate';
import {AsgRegisterInstruction} from '../../models/instructions/asg.instruction.register';
import {AsgVectorInstruction} from '../../models/instructions/asg.instruction.vector';
import {getInstructionConfig} from '../../helpers/asg.utils';
import {AsgConversionInstruction} from '../../models/instructions/asg.instruction.conversion';

/**
 * Factoria de instrucciones. Genera objetos de tipo AsgInstruction tanto desde texto plano (al compilar, desde el analizador semantico) como desde binario (al ejecutar, desde la memoria del procesador)
 */
export class AsgInstructionFactoryService {

  public static encode(opcode: string, args: string[], rawItem: any): AsgInstruction {
    //comprobar que el codigo de operacion es conocido
    const config = getInstructionConfig(rawItem.lineNum, opcode, args);

    let instruction: AsgInstruction;

    switch (config.type) {
      case 'R':
        instruction = AsgRegisterInstruction.fromText(rawItem.lineNum, rawItem.pc, opcode, args, config);
        break;
      case 'I':
        instruction = AsgImmediateInstruction.fromText(rawItem.lineNum, rawItem.pc, opcode, args, config);
        break;
      case 'J':
        instruction = AsgJumpInstruction.fromText(rawItem.lineNum, rawItem.pc, opcode, args, config);
        break;
      case 'B':
        instruction = AsgBranchInstruction.fromText(rawItem.lineNum, rawItem.pc, opcode, args, config);
        break;
      case 'M':
        instruction = AsgMemoryInstruction.fromText(rawItem.lineNum, rawItem.pc, opcode, args, config);
        break;
      case 'C':
        instruction = AsgConversionInstruction.fromText(rawItem.lineNum, rawItem.pc, opcode, args, config);
        break;
      case 'V':
        instruction = AsgVectorInstruction.fromText(rawItem.lineNum, rawItem.pc, opcode, args, config);
        break;
      default:
        throw new AssemblerError(`Línea ${rawItem.lineNum}: Opcode desconocido [${opcode}]`, rawItem.lineNum);
    }

    return instruction;
  }

  public static decode(word: number, pc: number, lineNum: number): AsgInstruction {
    const opcodeHex = (word >>> 26) & 0x3F; // Extraer los 6 bits superiores
    const funcHex = word & 0x7FF;

    // Buscar el opcode en el map (por Opcode o Func)
    const config = this.findConfig(opcodeHex, funcHex);
    let instruction: AsgInstruction;

    if (!config) {
      // Si el hardware no reconoce los bits, generamos un NOP marcado con excepción.
      // Esto permite que el error viaje por el pipeline hasta el commit y genere una excepción precisa.
      instruction = AsgRegisterInstruction.fromBinary(lineNum, pc, 'NOP', word);
      instruction.hasException = true;
      instruction.exceptionCode = ExceptionCode.ILLEGAL_INSTRUCTION;
      return instruction;
    }

    // Instanciar según el tipo de instrucción detectado en el mapa
    switch (config.config.type) {
      case 'R':
        instruction = AsgRegisterInstruction.fromBinary(lineNum, pc, config.name, word);
        break;
      case 'I':
        instruction = AsgImmediateInstruction.fromBinary(lineNum, pc, config.name, word);
        break;
      case 'J':
        instruction = AsgJumpInstruction.fromBinary(lineNum, pc, config.name, word);
        break;
      case 'B':
        instruction = AsgBranchInstruction.fromBinary(lineNum, pc, config.name, word);
        break;
      case 'M':
        instruction = AsgMemoryInstruction.fromBinary(lineNum, pc, config.name, word);
        break;
      case 'C':
        instruction = AsgConversionInstruction.fromBinary(lineNum, pc, config.name, word);
        break;
      case 'V':
        instruction = AsgVectorInstruction.fromBinary(lineNum, pc, config.name, word);
        break;
      default:
        throw new Error("Tipo de instrucción no soportado en el Decoder");
    }

    return instruction;
  }

  /**
   * Convierte el programa de objetos a un buffer de memoria binaria
   *
   * @param program Array de instancias que heredan de AsgInstruction
   * @returns Uint8Array listo para ser cargado en la memoria del procesador
   */
  public static assemble(program: AsgInstruction[]): Uint8Array {
    if (program.length === 0) return new Uint8Array(0);

    // El buffer debe cubrir desde la dirección 0 hasta la última instrucción (instr.pc ya incluye el offset de .text N)
    const bufferSize = program[program.length - 1].pc + 4;
    const memory = new Uint8Array(bufferSize);

    program.forEach(instr => {
      const word = instr.assemble();
      const offset = instr.pc; // Dirección real en memoria (ej: 100, 104... si .text 100)

      // Big Endian: byte más significativo en la dirección menor
      memory[offset]     = (word >>> 24) & 0xFF;
      memory[offset + 1] = (word >>> 16) & 0xFF;
      memory[offset + 2] = (word >>> 8)  & 0xFF;
      memory[offset + 3] = word & 0xFF;
    });

    return memory;
  }

  private static findConfig(op: number, func: number): { name: string, config: typeof ASG_MAP[string]} | null {
    // Buscamos en el mapa de instrucciones
    const entry = Object.entries(ASG_MAP).find(([name, info]) => {
      // Si es Tipo-R o Tipo-V o Tipo-C, deben coincidir tanto el opcode como el func
      if (info.type === 'R' || info.type === 'V' || info.type === 'C') {
        return info.opcode === op && info.func === func;
      }
      // Para el resto (I, J, B, M), solo comparamos el opcode
      return info.opcode === op;
    });

    if (entry) {
      const [name, config] = entry;
      return { name, config };
    }

    return null;
  }
}
