import {ASG_MAP} from '../asg.map';
import {AsgInstruction} from './asg.instruction';
import {AssemblerError} from '../asg.exceptions';
import {SymbolTable} from '../asg.symbol-table';
import {parseMem, parseReadReg, parseWriteReg} from '../../helpers/asg.utils';

/**
 * Clase para manejar las instrucciones de tipo memoria
 * Genera su objeto propio desde texto (compilador) y desde binario (en tiempo de ejecución)
 * TODO: las traducciones de assembleError con transloco son con métodos estáticos y no es facil de realizar
 */
export class AsgMemoryInstruction extends AsgInstruction {

  // true → direccionamiento directo por etiqueta. false → desplazamiento + registro: offset(Rs)
  private isDirect: boolean;

  private constructor(id: number, pc: number, opcode: string, imm: number, rs2: number, rd?: number, rs1?: number, isDirect: boolean = false) {
    super(id, pc, opcode, rd, rs1, rs2, imm);
    this.isDirect = isDirect;
    // establezco los delays de las operaciones de memoria vectorial
    if (opcode.includes('L') && this.isVector) {
      this.initDelay = this.cyclesRemaining;
    } else if (opcode.includes('S') && this.isVector) {
      this.endDelay = this.cyclesRemaining;
    }
  }

  // Ensamblado desde texto
  //
  // Cargas  (op incluye 'L'):
  //   2 args → LD  Rd, ETIQUETA         (directo,   base implícita R0)
  //   3 args → LD  Rd, offset(Rs)       (indirecto, offset decimal o hex)
  //
  // Almacenamientos (op no incluye 'L'):
  //   2 args → SD  ETIQUETA, Rs         (directo,   base implícita R0)
  //   3 args → SD  offset(Rb), Rs       (indirecto)
  //
  // Operaciones vectoriales con stride/indexed:
  //   LVWS Vd, Rs_base, Rs_stride  → Vd[i] = Mem[Rs_base + i*Rs_stride]
  //   SVWS Vs, Rs_base, Rs_stride  → Mem[Rs_base + i*Rs_stride] = Vs[i]
  //   LVI  Vd, Rs_base, Vs_indices → Vd[i] = Mem[Rs_base + Vs_indices[i]]
  //   SVI  Vs, Rs_base, Vs_indices → Mem[Rs_base + Vs_indices[i]] = Vs[i]
  public static fromText(line: number, pc: number, opcode: string, args: string[], config: typeof ASG_MAP[string]): AsgMemoryInstruction {
    // Operaciones vectoriales stride/indexed: 3 registros (no offset(base))
    if (opcode === 'LVWS' || opcode === 'SVWS' || opcode === 'LVI' || opcode === 'SVI') {
      if (args.length !== 3)
        throw new AssemblerError(`Línea ${line}: ${opcode} requiere formato: Vd, Rs_base, Rs_stride (ej: LVWS V1, R2, R3)`, line);

      const isLoad = opcode.includes('L');
      const vReg = parseWriteReg(line, args[0], 'V');  // Vector destino
      const baseReg = parseReadReg(line, args[1], 'R');  // Registro base (dirección)
      // Para LVI/SVI, el tercer operando es vectorial (vector índice), para LVWS/SVWS es escalar (registro con el valor stride)
      const strideOrIndexReg = parseReadReg(line, args[2], opcode.includes('I') ? 'V' : 'R');

      // - rd: registro vectorial (destino para loads, undefined para stores)
      // - rs2: base (dirección) para loads, vector datos para stores
      // - rs1: undefined para loads, base para stores
      // - imm: número del registro stride/índices
      return new AsgMemoryInstruction(line, pc, opcode, strideOrIndexReg, isLoad ? baseReg : vReg, isLoad ? vReg : undefined, isLoad ? undefined : baseReg, false);
    }

    if (args.length < 2 || args.length > 3)
      throw new AssemblerError(`Línea ${line}: ${opcode} requiere "Rd, etiqueta" o "Rd, offset(Rs)".`, line);

    const isLoad = opcode.includes('L');
    let rd: number | undefined, rs1: number | undefined, rs2: number, imm: number;
    let isDirect = false;

    const alignmentNeeded = (config.target === 'D' || config.target === 'V') ? 8 : (opcode.includes('W') ? 4 : (opcode.includes('H') ? 2 : 1));

    if (isLoad) {
      rd = parseWriteReg(line, args[0], config.target);

      if (args.length === 2) {
        // Directo: LD Rd, ETIQUETA
        isDirect = true;
        const entry = SymbolTable.get(args[1]);
        if (!entry)
          throw new AssemblerError(`Línea ${line}: Etiqueta "${SymbolTable.cleanName(args[1])}" no definida.`, line);
        if (entry.segment !== 'DATA')
          throw new AssemblerError(`Línea ${line}: La etiqueta "${SymbolTable.cleanName(args[1])}" pertenece al segmento .text. En instrucciones de memoria solo se permiten etiquetas de .data.`, line);
        imm  = entry.address;
        rs2  = 0; // base = R0
      } else {
        // Indirecto: LD Rd, offset(Rs)
        const { offset, base } = parseMem(line, args[1], args[2], opcode, config);
        imm = offset;
        rs2 = base;
      }
      rs1 = undefined;
    } else {
      rd = undefined;

      if (args.length === 2) {
        // Directo: SD ETIQUETA, Rs
        isDirect = true;
        const entry = SymbolTable.get(args[0]);
        if (!entry)
          throw new AssemblerError(`Línea ${line}: Etiqueta "${SymbolTable.cleanName(args[0])}" no definida.`, line);
        if (entry.segment !== 'DATA')
          throw new AssemblerError(`Línea ${line}: La etiqueta "${SymbolTable.cleanName(args[0])}" pertenece al segmento .text. En instrucciones de memoria solo se permiten etiquetas de .data.`, line);
        imm  = entry.address;
        rs1  = 0; // base = R0
        rs2  = parseReadReg(line, args[1], config.target);
      } else {
        // Indirecto: SD offset(Rb), Rs
        const { offset, base } = parseMem(line, args[0], args[1], opcode, config);
        imm  = offset;
        rs1  = base;
        rs2  = parseReadReg(line, args[2], config.target);
      }
    }

    if (imm % alignmentNeeded !== 0)
      console.warn(`Aviso en línea ${line}: La dirección 0x${imm.toString(16)} no está alineada para ${opcode}.`);

    return new AsgMemoryInstruction(line, pc, opcode, imm, rs2, rd, rs1, isDirect);
  }

  public static fromBinary(line: number, pc: number, opcode: string, word: number): AsgMemoryInstruction {
    const isLoad = opcode.includes('L');
    const base    = (word >>> 21) & 0x1F;
    const dataReg = (word >>> 16) & 0x1F;

    let offset = word & 0xFFFF;
    if (offset & 0x8000) offset |= 0xFFFF0000; // sign-extend

    // Si la base es R0 y el offset coincide con una etiqueta .data -> directo
    const isDirect = base === 0 && SymbolTable.getName(offset, 'DATA') !== undefined;

    return new AsgMemoryInstruction(line, pc, opcode, offset, isLoad ? base : dataReg, isLoad ? dataReg : undefined, isLoad ? undefined : base, isDirect);
  }

  // Ensamblado a binario
  // [ Op(6) | base(5) | dest(5) | offset(16) ]
  /**
   * Obtención de su binario propio de la instruccion de memoria
   * Formato [ Op(6) | base(5) | dest(5) | offset(16) ]
   */
  public override assemble(): number {
    const config = ASG_MAP[this.opcode];
    let base: number, dest: number;

    if (this.opcode.includes('L')) {
      base = (this.rs2 || 0) << 21;
      dest = (this.rd  || 0) << 16;
    } else {
      base = (this.rs1 || 0) << 21;
      dest = (this.rs2 || 0) << 16;
    }
    const offset16 = (this.imm || 0) & 0xFFFF;

    return config.opcode << 26 | base | dest | offset16;
  }

  /**
   * Necesito hacer override del metodo base para setear los delays de las instrucciones de memoria vectorial
   * @param cycles
   */
  override setCyclesRemaining(cycles: number) {
    this.cyclesRemaining = cycles;
    // establezco delays de las operaciones de memoria vectorial
    if (this.opcode.includes('L') && this.isVector) {
      this.initDelay = this.cyclesRemaining;
    } else if (this.opcode.includes('S') && this.isVector) {
      this.endDelay = this.cyclesRemaining;
    }
  }

  /**
   * Obtención de la instrucción original en texto plano
   */
  public override toString(): string {
    const isLoad     = this.opcode.includes('L');
    const dataPrefix = this.config.target === 'D' ? 'F' : this.config.target;

    if (this.isDirect) {
      // Directo: mostrar etiqueta (o dirección hex si no hay símbolo)
      const labelStr = this.getLabelOrHex(this.imm!, 'DATA');
      return isLoad ? `${this.opcode} ${this.getRegName(this.rd,  dataPrefix)}, ${labelStr}` : `${this.opcode} ${labelStr}, ${this.getRegName(this.rs2, dataPrefix)}`;
    } else {
      // Indirecto: offset como entero decimal + registro
      const offsetStr = `${this.imm ?? 0}`;
      return isLoad ? `${this.opcode} ${this.getRegName(this.rd,  dataPrefix)}, ${offsetStr}(${this.getRegName(this.rs2, 'R')})` : `${this.opcode} ${offsetStr}(${this.getRegName(this.rs1, 'R')}), ${this.getRegName(this.rs2, dataPrefix)}`;
    }
  }
}
