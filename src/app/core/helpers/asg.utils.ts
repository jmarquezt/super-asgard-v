import {AssemblerError} from '../models/asg.exceptions';
import {SymbolTable} from '../models/asg.symbol-table';
import {ASG_MAP} from '../models/asg.map';

/**
 * Helper con funciones principalmente para la compilacion del programa, parseo de registros, numeros y sus comprobaciones
 * TODO: son metodos que se llaman estáticamente y es complicado meter transloco para las traducciones, habría que refactorizar para poder traducir estos textos
 */

/**
 * Compruebo si el opcode indicado esta definido en la arquitectura y si los argumentos recibidos para el son los que requiere
 * @param line
 * @param opcode
 * @param args
 */
export function getInstructionConfig(line: number, opcode: string, args: string[]): typeof ASG_MAP[string] {
  const config = ASG_MAP[opcode];
  if (!config) throw new AssemblerError(`Línea ${line}: Opcode desconocido [${opcode}]`, line);

  if (config.argNum > 0) {
    if (args.length !== config.argNum) {
      throw new AssemblerError(`Línea ${line}: Número de argumentos no válido. Operacion ${opcode} debe contener ${config.argNum} argumentos, ${args.length} recibidos`, line);
    }
  }

  return config;
}

/**
 * Compruebo la etiqueta recibida y devuelvo el address desde la tabla de simbolos
 * @param line
 * @param label
 */
export function parseLabel(line: number, label: string): number {
  const match = label.match(/^([a-z_][a-z0-9_]*)$/i);
  if (!match)
    throw new AssemblerError(`Línea ${line}: Argumento inmediato "${SymbolTable.cleanName(label)}" no es válido. Debe ser una etiqueta que empiece por letra o "_" y alfanumerica`, line);

  const entry = SymbolTable.get(match[1]);
  if (!entry)
    throw new AssemblerError(`Línea ${line}: Etiqueta "${SymbolTable.cleanName(match[1])}" no definida.`, line);
  if (entry.segment !== 'TEXT')
    throw new AssemblerError(`Línea ${line}: La etiqueta "${SymbolTable.cleanName(match[1])}" pertenece al segmento .data y no puede usarse como destino de salto. Usa una etiqueta del segmento .text.`, line);

  return entry.address / 4;
}

/**
 * Compruebo el registro usado por una instrucción
 * Se comprueba que el tipo usado corresponda con el esperado por la instrucción
 * @param line
 * @param arg
 * @param expectedType
 */
export function parseReg(line: number, arg: string, expectedType: 'R' | 'F' | 'D' | 'V'): number {
  const type = arg.toUpperCase()[0] as 'R' | 'F' | 'V';
  const normType = expectedType === 'D' ? 'F' : expectedType;

  if (type !== normType)
    throw new AssemblerError(`Línea ${line}: Se esperaba registro tipo ${normType}, se recibió ${type}.`, line);

  return parseInt(arg.substring(1));
}

/**
 * Compruebo el registro de lectura de una operación.
 * Se comprueba que esté dentro del rango del procesador y si es double, que el registro usado sea par
 * @param line
 * @param arg
 * @param expectedType
 */
export function parseReadReg(line: number, arg: string, expectedType: 'R' | 'F' | 'D' | 'V'): number {
  const number = parseReg(line, arg, expectedType);
  const normType = expectedType === 'D' ? 'F' : expectedType;

  if (normType === 'V') {
    if (number < 0 || number > 7)
      throw new AssemblerError(`Línea ${line}: El registro ${normType}${number} excede los límites. Rango válido: 0-7`, line);
  } else {
    if (number < 0 || number > 31)
      throw new AssemblerError(`Línea ${line}: El registro ${normType}${number} excede los límites. Rango válido: 0-31`, line);
  }

  if (expectedType === 'D' && number % 2 !== 0)
    throw new AssemblerError(`Línea ${line}: El registro F${number} no es válido para doble precisión. Debe ser un registro par (F0, F2, … F30).`, line);

  return number;
}

/**
 * Compruebo el registro de escritura de una operación.
 * Se valida que no se esté usando el registro R0 como escritura (prohibido en la arquitectura)
 * @param line
 * @param arg
 * @param expectedType
 */
export function parseWriteReg(line: number, arg: string, expectedType: 'R' | 'F' | 'D' | 'V'): number {
  const number = parseReadReg(line, arg, expectedType);

  if (expectedType === 'R' && number === 0)
    throw new AssemblerError(`Línea ${line}: El registro R0 no puede usarse para escritura. Rango válido: 1-31`, line);

  return number;
}

/**
 * Compruebo un inmediato recibido por instrucción (número o etiqueta)
 * Se valida el rango del número -> 16 bits máximo para instruccion inmediata y que la etiqueta exista en la tabla de simbolos y además que esté dentro de directiva .data
 * @param line
 * @param arg
 */
export function parseNumberImmediate(line: number, arg: string): number {
  // Validar número # (ej: #10, #0xFF, #-4)
  const numMatch = arg.match(/^#(-?0x[0-9A-F]+|-?\d+)$/i);
  if (numMatch) {
    const val = numMatch[1].toLowerCase().includes('0x')
      ? parseInt(numMatch[1], 16)
      : parseInt(numMatch[1], 10);

    if (isNaN(val))
      throw new AssemblerError(`Línea ${line}: El valor inmediato "${SymbolTable.cleanName(arg)}" no es un número válido.`, line);

    if (val < -32768 || val > 65535)
      throw new AssemblerError(`Línea ${line}: El valor inmediato ${arg} (${val}) excede los 16 bits permitidos.`, line);

    return val;
  }

  // Etiquetas
  const labelMatch = arg.match(/^([a-z_][a-z0-9_]*)$/i);
  if (labelMatch) {
    const entry = SymbolTable.get(labelMatch[1]);
    if (!entry)
      throw new AssemblerError(`Línea ${line}: Etiqueta "${SymbolTable.cleanName(labelMatch[1])}" no definida.`, line);
    if (entry.segment !== 'DATA')
      throw new AssemblerError(`Línea ${line}: La etiqueta "${SymbolTable.cleanName(labelMatch[1])}" pertenece al segmento .text. Como inmediato solo se permiten etiquetas de .data.`, line);
    if (entry.address > 65535)
      throw new AssemblerError(`Línea ${line}: La dirección de "${SymbolTable.cleanName(labelMatch[1])}" (${entry.address}) excede los 16 bits del campo inmediato.`, line);

    return entry.address;
  }

  throw new AssemblerError(`Línea ${line}: Argumento inmediato "${SymbolTable.cleanName(arg)}" no es válido. Debe ser un número (#10, #0xFF) o una etiqueta de .data.`, line);
}

/**
 * Comprueba el offset de desplazamiento de una operacion de memoria
 * Valida que no se use una etiqueta como desplazamiento (hay que usar desplazamiento directo en caso de etiquetas)
 * Valida pero no lanza error en caso de un alineamiento incorrecto (dará error en tiempo de ejecución).
 * Esta validación la dejo así porque puede ser que semanticamente el alineamiento parezca incorrecto, pero no tengo la información cargada en el registro, por lo que puede ser correcto en tiempo de ejecución
 * @param line
 * @param imm
 * @param reg
 * @param opcode
 * @param config
 */
export function parseMem(line: number, imm: string, reg: string, opcode: string, config: typeof ASG_MAP[string]) {
  // El formato offset(Registro) solo acepta desplazamientos numéricos.
  // Para usar etiquetas de .data, emplea el direccionamiento directo: OP Rd, etiqueta
  const clean = imm.replace('#', '').trim();
  let offset: number;
  if (clean.startsWith('-0x') || clean.startsWith('-0X')) {
    offset = -parseInt(clean.slice(3), 16);
  } else {
    offset = parseInt(clean);
  }

  if (isNaN(offset))
    throw new AssemblerError(
      `Línea ${line}: "${SymbolTable.cleanName(imm)}" no es un desplazamiento numérico válido. Para acceso directo por etiqueta usa: ${opcode} Rd, ETIQUETA`,
      line
    );

  const baseReg = parseReadReg(line, reg, 'R');

  const alignmentNeeded = (config.target === 'D' || config.target === 'V') ? 8
    : (opcode.includes('W') ? 4 : (opcode.includes('H') ? 2 : 1));

  if (offset % alignmentNeeded !== 0)
    console.warn(`Aviso en línea ${line}: El desplazamiento #${offset} no está alineado para una operación ${opcode}.`);

  return { offset, base: baseReg };
}
