import {ASG_MAP} from '../asg.map';
import {AssemblerError, ExceptionCode} from '../asg.exceptions';
import {SymbolTable} from '../asg.symbol-table';

/**
 * Clase base para manejar una instruccion de la arquitectura. Define las propiedades base y metodos para trabajar con ella
 */
export abstract class AsgInstruction {
  // Propiedades de identificación y rastreo
  public id: number;          // ID único, lo necesito para la linea del editor y del timeline
  public opcode: string;      // codigo de operacion
  public cyclesRemaining: number;
  public initDelay: number = 0;     // latencia inicial operaciones vectoriales
  public endDelay: number = 0; // latencia final (operaciones de memoria vectorial)
  public config: typeof ASG_MAP[string];
  // Registros y valores (opcionales según el tipo)
  public rd?: number; //destino
  public rs1?: number; //primer operando
  public rs2?: number; //segundo operando
  public imm?: number; //inmediato
  public result?: number;     // Resultado calculado en EX
  public forwardingSource?: {
    rs1: 'REG' | 'MEM' | 'WB' | 'IMM';
    rs2: 'REG' | 'MEM' | 'WB' | 'IMM';
  };

  //deprecado
  public pc: number = 0;          // contador del programa cuando la instruccion entró

  // Metadatos de tipo
  public isFloat: boolean = false;
  public isFloatOrigin: boolean = false;
  public isDouble: boolean = false;
  public isDoubleSource: boolean = false; // true si los registros FUENTE son double (puede diferir del destino en conversiones)
  public isVector: boolean = false;
  public isStalled: boolean = false;
  public hasException: boolean = false;
  public exceptionCode?: ExceptionCode;
  public currentElement: number = 0; // Para iteración vectorial
  public vectorResult?: Float64Array; //resultado de operacion vectorial

  protected constructor(id: number, pc: number, opcode: string, rd?: number, rs1?: number, rs2?: number, imm?: number) {
    this.id = id;
    this.pc = pc;
    this.opcode = opcode;
    this.rd = rd;
    this.rs1 = rs1;
    this.rs2 = rs2;
    this.imm = imm;
    this.config = ASG_MAP[opcode];
    if (!this.config) throw new AssemblerError(`Línea ${this.id}: Opcode desconocido [${opcode}]`, this.id);
    this.cyclesRemaining = this.config.cycles;
    this.isVector = this.config.target === 'V';
    this.isFloat = (this.config.target === 'F' || this.config.target === 'D');
    this.isFloatOrigin = (this.config.origin === 'F' || this.config.origin === 'D');
    this.isDouble = this.config.target === 'D';
    // En instrucciones de conversión (CVTF2D, CVTD2I…) la precisión del registro fuente puede ser distinto a la del destino y necesito diferenciarlos
    this.isDoubleSource = this.config.type === 'C' ? this.config.origin === 'D' : this.isDouble;
  }

  /**
   * Convierte la instancia de instrucción en una palabra para memoria de 32 bits
   */
  abstract assemble(): number;

  /**
   * Convierte la instancia de instrucción de vuelta a texto inicial
   */
  abstract toString(): string;

  setCyclesRemaining(cycles: number) {
    this.cyclesRemaining = cycles;
  }


  protected getRegName(num: number | undefined, prefix: string = 'R'): string {
    return num !== undefined ? `${prefix}${num}` : '';
  }

  protected getLabelOrHex(val: number, segment: 'TEXT' | 'DATA', isRelative: boolean = false): string {
    let targetAddr = val;

    // Si es un Branch (relativo), calculamos la dirección real
    // offset = (target - (pc + 4)) / 4  => target = (offset * 4) + pc + 4
    if (isRelative) {
      targetAddr = (val * 4);
    }

    // Buscamos en la tabla de símbolos la etiqueta de la direccion
    const label = SymbolTable.getName(targetAddr, segment);

    return label ? label : `0x${targetAddr.toString(16).toUpperCase()}`;
  }

}
