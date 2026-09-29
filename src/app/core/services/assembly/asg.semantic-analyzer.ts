import { AssemblerError, CODE_BASE, DEFAULT_HANDLER_ADDR, DEFAULT_HANDLER_LABEL, HANDLER_LABELS, InterruptVector, VECTOR_ENTRY_SIZE, VECTOR_TABLE_ENTRIES } from '../../models/asg.exceptions';
import { SymbolTable } from '../../models/asg.symbol-table';
import { Token, TokenType } from '../../models/asg.models';
import { AsgInstruction } from '../../models/instructions/asg.instruction';
import { AsgInstructionFactoryService } from './asg.instruction-factory';

/**
 * Analizador semántico del lenguaje. Recibe como entrada un conjunto de tokens ya parseados por el analizador léxico y se encarga de realizar las comprobaciones semanticas del lengiaje
 */
export class AsgSemanticAnalyzerService {
  private tokens: Token[];
  private cursor = 0;

  // Punteros de segmento
  private codePtr = CODE_BASE; // Después de la tabla de vectores
  private dataPtr = 0;
  private hasTextSegment = false;
  private currentSegment: 'TEXT' | 'DATA' | 'NONE' = 'NONE';

  // Control de Memoria Fija y Solapamientos
  private readonly MEMORY_SIZE: number;
  private dataRanges: { start: number; end: number }[] = [];
  private textRanges: { start: number; end: number }[] = [];
  private initialCodePtr = CODE_BASE; // Dirección de inicio del programa

  // Resultados
  private instructions: AsgInstruction[] = [];
  private dataBuffer: Uint8Array;

  constructor(tokens: Token[], memorySize: number = 4096) {
    this.tokens = tokens;
    this.MEMORY_SIZE = memorySize;
    this.dataBuffer = new Uint8Array(memorySize);
  }

  /**
   * Ejecuta el análisis completo en dos pasadas
   */
  analyze(): { instructions: AsgInstruction[], dataBuffer: Uint8Array, initialCodePtr: number } {
    // 0. Limpiar estado previo
    SymbolTable.clear();
    this.instructions = [];
    this.hasTextSegment = false;
    this.dataRanges = [];
    this.textRanges = [];
    this.initialCodePtr = CODE_BASE;
    this.dataBuffer.fill(0); // Limpiar memoria de simulaciones anteriores

    // Registrar etiquetas predefinidas de manejadores de excepción
    // Todas apuntan al default handler inicialmente; el usuario puede sobrescribirlas en su código (se actualizaran los punteros en la segunda pasada)
    this.registerDefaultHandlers();

    // Primera Pasada: Calcular direcciones y validar memoria
    this.firstPass();

    // Generar la tabla de vectores (después de resolver etiquetas del usuario)
    this.generateVectorTable();

    // Segunda Pasada: Generar instrucciones del programa del usuario
    this.resetForSecondPass();
    this.secondPass();

    return {
      instructions: this.instructions,
      dataBuffer: this.dataBuffer,
      initialCodePtr: this.initialCodePtr
    };
  }

  /**
   * Registra las etiquetas de los manejadores de excepción con valor por defecto.
   * El usuario puede sobrescribirlas definiendo etiquetas con el mismo nombre.
   */
  private registerDefaultHandlers() {
    // Registrar el default handler (TRAP 6)
    SymbolTable.add(DEFAULT_HANDLER_LABEL, DEFAULT_HANDLER_ADDR, 'TEXT');

    // Registrar cada manejador de excepción apuntando al default handler
    for (const vector of Object.values(InterruptVector)) {
      if (typeof vector === 'number') {
        const label = HANDLER_LABELS[vector as InterruptVector];
        if (label) {
          SymbolTable.add(label, DEFAULT_HANDLER_ADDR, 'TEXT');
        }
      }
    }
  }

  /**
   * Genera la tabla de vectores de interrupción (instrucciones J) y el default handler.
   * Se ejecuta después de firstPass para que las etiquetas del usuario ya estén resueltas.
   */
  private generateVectorTable() {
    // Generar instrucciones J para cada vector (direcciones 0x00-0x5C)
    for (let i = 0; i < VECTOR_TABLE_ENTRIES; i++) {
      const pc = i * VECTOR_ENTRY_SIZE;
      const baseLabel = HANDLER_LABELS[i as InterruptVector] ?? DEFAULT_HANDLER_LABEL;

      // Buscar si el usuario definió este handler (con prefijo de módulo)
      // Las etiquetas del usuario tienen formato: __m0____mem_align_handler
      let handlerLabel = baseLabel;
      const userHandler = this.findHandlerWithModulePrefix(baseLabel);
      if (userHandler) {
        handlerLabel = userHandler;
      }

      // Crear instrucción J que salta al manejador (usando el nombre de la etiqueta)
      const instr = AsgInstructionFactoryService.encode('J', [handlerLabel], { pc, lineNum: 0 });
      this.instructions.push(instr);
    }

    // Generar el default handler: TRAP 6 (parada) en dirección 0x60 (96)
    const defaultInstr = AsgInstructionFactoryService.encode('TRAP', ['6'], { pc: DEFAULT_HANDLER_ADDR, lineNum: 0 });
    this.instructions.push(defaultInstr);
  }

  /**
   * Busca si existe una etiqueta con prefijo de módulo para un handler.
   * Ejemplo: para "__mem_align_handler" busca "__m0____mem_align_handler", "__m1____mem_align_handler", etc.
   */
  private findHandlerWithModulePrefix(baseLabel: string): string | null {
    // Buscar en la SymbolTable por etiquetas que terminen con el handler name
    const allSymbols = SymbolTable.getAll();
    for (const [name, entry] of allSymbols) {
      // Las etiquetas del usuario tienen formato __mN__LABEL
      // Verificar si termina con el label base (ej: __m0____mem_align_handler termina con __mem_align_handler)
      if (name.endsWith(baseLabel) && name !== baseLabel && entry.segment === 'TEXT') {
        return name; // Devolver el nombre completo con prefijo
      }
    }
    return null; // No encontrado con prefijo, usar el por defecto
  }

  /**
   * Primera pasada, validacion de bloques directivas y rangos de las etiqutas dentro de las directivas encontradas
   * @private
   */
  private firstPass() {
    let startOfCurrentBlock = -1;

    while (!this.isAtEnd()) {
      const token = this.peek();

      if (token.type === TokenType.DIRECTIVE) {
        const dir = token.value.toLowerCase();

        if (dir === '.text' || dir === '.data') {
          // Guardar el bloque anterior antes de cambiar de segmento/offset
          this.saveCurrentRange(startOfCurrentBlock);
          startOfCurrentBlock = this.handleSegmentDirective(token, true);
        } else {
          this.handleDirectivePass1(token);
        }

      } else if (token.type === TokenType.LABEL_DEF) {
        if (this.currentSegment === 'NONE')
          throw new AssemblerError(`Línea ${token.line}: Etiqueta definida sin segmento (.text / .data)`, token.line);

        const addr = this.currentSegment === 'TEXT' ? this.codePtr : this.dataPtr;
        SymbolTable.add(token.value, addr, this.currentSegment);
        this.advance();

      } else if (token.type === TokenType.INSTRUCTION) {
        if (this.currentSegment !== 'TEXT')
          throw new AssemblerError(`Línea ${token.line}: Instrucción encontrada fuera del segmento .text`, token.line);

        if (this.codePtr + 4 > this.MEMORY_SIZE)
          throw new AssemblerError(`Línea ${token.line}: Desbordamiento de memoria de instrucciones.`, token.line);

        this.codePtr += 4; // ASG: 4 bytes por instrucción
        this.consumeUntilNextLine();
      } else {
        // AHORA SÍ: Cualquier otra cosa suelta es un error
        throw new AssemblerError(`Línea ${token.line}: Sintaxis inválida. Token inesperado '${SymbolTable.cleanName(token.value)}'. Si intentas definir un dato, te falta la directiva (ej. .word, .float).`, token.line);
      }
    }

    // Guardar el último bloque al finalizar
    this.saveCurrentRange(startOfCurrentBlock);

    if (!this.hasTextSegment)
      throw new Error("Error Semántico: El programa debe incluir obligatoriamente la directiva '.text'.");
  }

  private handleDirectivePass1(token: Token) {
    const dir = token.value.toLowerCase();
    this.advance(); // Consumir directiva

    switch (dir) {
      case '.align':
        if (this.currentSegment === 'NONE') throw new AssemblerError(`Línea ${token.line}: .align fuera de segmento`, token.line);
        const n = this.parseImmediateValue(this.consume(TokenType.INT, "Se esperaba exponente").value);
        this.align(n, this.currentSegment);
        break;
      case '.byte':
        this.checkDataSegment(token);
        do {
          this.consume(TokenType.INT, "Se esperaba un valor byte");
          this.dataPtr += 1;
        } while (this.match(TokenType.COMMA));
        break;
      case '.ascii':
      case '.asciiz':
        this.checkDataSegment(token);
        do {
          const strToken = this.consume(TokenType.STRING, "Se esperaba cadena");
          const rawStr = this.unescapeString(strToken.value.slice(1, -1));
          this.dataPtr += rawStr.length + (dir === '.asciiz' ? 1 : 0);
        } while (this.match(TokenType.COMMA));
        break;
      case '.word':
      case '.float':
        this.checkDataSegment(token);
        do {
          if (this.peek().type === TokenType.INT || this.peek().type === TokenType.FLOAT || this.peek().type === TokenType.SYMBOL) {
            this.advance();
            this.dataPtr += 4;
          } else {
            throw new AssemblerError(`Línea ${token.line}: Se esperaba valor numérico o símbolo`, token.line);
          }
        } while (this.match(TokenType.COMMA));
        break;
      case '.double':
        this.checkDataSegment(token);
        do {
          this.advance();
          this.dataPtr += 8;
        } while (this.match(TokenType.COMMA));
        break;
      case '.space':
        this.checkDataSegment(token);
        const size = this.parseImmediateValue(this.consume(TokenType.INT, "Se esperaba tamaño").value);
        this.dataPtr += size;
        break;
      case '.global':
        // Declara un símbolo como visible globalmente entre módulos. Solo consumimos el argumento, ya que la tabla es la misma para todos los simbolos
        this.consume(TokenType.SYMBOL, "Se esperaba nombre de símbolo tras .global");
        break;
    }

    if (this.dataPtr > this.MEMORY_SIZE)
      throw new AssemblerError(`Línea ${token.line}: Desbordamiento de memoria de datos (Max: ${this.MEMORY_SIZE} bytes)`, token.line);
  }

  private resetForSecondPass() {
    this.cursor = 0;
    this.codePtr = CODE_BASE;
    this.dataPtr = 0;
    this.currentSegment = 'NONE';
  }

  /**
   * Segunda pasada, procesar instrucciones y directivas
   * @private
   */
  private secondPass() {
    while (!this.isAtEnd()) {
      const token = this.peek();

      if (token.type === TokenType.DIRECTIVE) {
        const dir = token.value.toLowerCase();

        if (dir === '.text' || dir === '.data') {
          // Sincronizar offsets y segmentos tal cual se hizo en Pass 1
          this.handleSegmentDirective(token, false);
        } else {
          this.handleDirectivePass2(token);
        }

      } else if (token.type === TokenType.INSTRUCTION) {
        this.processInstruction(token);
        // Debemos ignorar explícitamente las etiquetas en la pasada 2
      } else if (token.type === TokenType.LABEL_DEF) {
        this.advance();

      } else if (token.type === TokenType.EOF) {
        break; // Fin del archivo

      } else {
        // Si llega aquí es un error claro
        throw new AssemblerError(`Línea ${token.line}: Token inesperado '${SymbolTable.cleanName(token.value)}'.`, token.line);
      }
    }
  }

  private handleDirectivePass2(token: Token) {
    const dir = token.value.toLowerCase();
    const view = new DataView(this.dataBuffer.buffer);
    this.advance();

    switch (dir) {
      case '.align':
        const n = this.parseImmediateValue(this.advance().value);
        this.align(n, this.currentSegment);
        break;
      case '.byte':
        do {
          const val = this.parseImmediateValue(this.advance().value);
          this.dataBuffer[this.dataPtr++] = val & 0xFF;
        } while (this.match(TokenType.COMMA));
        break;
      case '.ascii':
      case '.asciiz':
        do {
          const s = this.unescapeString(this.consume(TokenType.STRING, "Se esperaba cadena").value.slice(1, -1));
          for (let i = 0; i < s.length; i++) {
            this.dataBuffer[this.dataPtr++] = s.charCodeAt(i);
          }
          if (dir === '.asciiz') this.dataBuffer[this.dataPtr++] = 0;
        } while (this.match(TokenType.COMMA));
        break;
      case '.float':
        do {
          const val = parseFloat(this.advance().value.replace('#', ''));
          view.setFloat32(this.dataPtr, val, false); // Big Endian
          this.dataPtr += 4;
        } while (this.match(TokenType.COMMA));
        break;
      case '.double':
        do {
          const val = parseFloat(this.advance().value.replace('#', ''));
          view.setFloat64(this.dataPtr, val, false);
          this.dataPtr += 8;
        } while (this.match(TokenType.COMMA));
        break;
      case '.word':
        do {
          const valToken = this.advance();
          let value = (valToken.type === TokenType.SYMBOL)
            ? SymbolTable.getAddress(valToken.value)
            : this.parseImmediateValue(valToken.value);

          view.setInt32(this.dataPtr, value, false);
          this.dataPtr += 4;
        } while (this.match(TokenType.COMMA));
        break;
      case '.space':
        const size = this.parseImmediateValue(this.consume(TokenType.INT, "Se esperaba tamaño").value);
        this.dataPtr += size;
        break;
      case '.global':
        this.consume(TokenType.SYMBOL, "Se esperaba nombre de símbolo tras .global");
        break;
    }
  }

  private processInstruction(token: Token) {
    const opcode = token.value.toUpperCase();
    this.advance();

    const args: string[] = [];
    while (!this.isAtEnd() && this.peek().line === token.line) {
      const t = this.advance();
      if (t.type !== TokenType.COMMA && t.type !== TokenType.PAREN_L && t.type !== TokenType.PAREN_R) {
        args.push(t.value);
      }
    }

    const instr = AsgInstructionFactoryService.encode(opcode, args, { pc: this.codePtr, lineNum: token.line });
    this.instructions.push(instr);
    this.codePtr += 4;
  }

  private handleSegmentDirective(token: Token, isPass1: boolean): number {
    const dir = token.value.toLowerCase();
    this.advance(); // Consumir .text o .data

    let offset = -1;
    if (this.match(TokenType.INT)) {
      offset = this.parseImmediateValue(this.tokens[this.cursor - 1].value);
    }

    if (dir === '.text') {
      this.currentSegment = 'TEXT';
      // El offset es relativo a CODE_BASE (después de la tabla de vectores)
      if (offset !== -1) {
        this.codePtr = CODE_BASE + offset;
      } else if (!this.hasTextSegment) {
        // Primer .text sin offset: empezar en CODE_BASE
        this.codePtr = CODE_BASE;
      }
      // Si no hay offset y ya hubo un .text previo, continuar donde quedó codePtr

      if (isPass1 && !this.hasTextSegment) {
        this.hasTextSegment = true;
        this.initialCodePtr = this.codePtr;
      }
      return this.codePtr;
    } else {
      this.currentSegment = 'DATA';
      if (offset !== -1) this.dataPtr = offset;
      return this.dataPtr;
    }
  }

  private saveCurrentRange(startBlock: number) {
    if (startBlock === -1 || this.currentSegment === 'NONE') return;

    if (this.currentSegment === 'DATA' && this.dataPtr > startBlock) {
      this.checkOverlap(startBlock, this.dataPtr, this.dataRanges, 'Datos');
      this.dataRanges.push({ start: startBlock, end: this.dataPtr });
    } else if (this.currentSegment === 'TEXT' && this.codePtr > startBlock) {
      this.checkOverlap(startBlock, this.codePtr, this.textRanges, 'Instrucciones');
      this.textRanges.push({ start: startBlock, end: this.codePtr });
    }
  }

  private checkOverlap(start: number, end: number, ranges: { start: number, end: number }[], type: string) {
    for (const range of ranges) {
      if (start < range.end && end > range.start) {
        throw new Error(`Solapamiento detectado en ${type}. Rango [0x${start.toString(16)}-0x${end.toString(16)}] colisiona con [0x${range.start.toString(16)}-0x${range.end.toString(16)}].`);
      }
    }
  }

  private align(n: number, segment: 'TEXT' | 'DATA' | 'NONE') {
    const bytes = Math.pow(2, n);
    if (segment === 'DATA') {
      const remainder = this.dataPtr % bytes;
      if (remainder !== 0) this.dataPtr += (bytes - remainder);
    } else if (segment === 'TEXT') {
      const remainder = this.codePtr % bytes;
      if (remainder !== 0) this.codePtr += (bytes - remainder);
    }
  }

  private parseImmediateValue(val: string): number {
    const clean = val.replace('#', '').trim();
    const parsed = clean.startsWith('0x') || clean.startsWith('-0x')
      ? parseInt(clean.replace('0x', ''), 16)
      : parseInt(clean, 10);

    if (isNaN(parsed)) throw new Error(`Valor inmediato inválido: ${val}`);
    return parsed >>> 0; // Forzar a 32 bits (Two's Complement para negativos)
  }

  private isAtEnd(): boolean {
    return this.cursor >= this.tokens.length || this.peek().type === TokenType.EOF;
  }

  private peek(): Token {
    return this.tokens[this.cursor];
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.cursor++;
    return this.tokens[this.cursor - 1];
  }

  private match(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    if (this.peek().type === type) {
      this.advance();
      return true;
    }
    return false;
  }

  private consume(type: TokenType, message: string): Token {
    if (this.peek().type === type) return this.advance();
    throw new AssemblerError(`Error en línea ${this.peek().line}: ${message}`, this.peek().line);
  }

  private consumeUntilNextLine() {
    const currentLine = this.peek().line;
    while (!this.isAtEnd() && this.peek().line === currentLine) {
      this.advance();
    }
  }

  private checkDataSegment(token: Token) {
    if (this.currentSegment !== 'DATA') {
      throw new AssemblerError(`Error en línea ${token.line}: Directiva '${token.value}' solo permitida en .data`, token.line);
    }
  }

  private unescapeString(s: string): string {
    return s.replace(/\\(.)/g, (_, c) => {
      switch (c) {
        case 'n':  return '\n';
        case 't':  return '\t';
        case 'r':  return '\r';
        case '0':  return '\0';
        case '\\': return '\\';
        case '"':  return '"';
        default:   return c;
      }
    });
  }
}
