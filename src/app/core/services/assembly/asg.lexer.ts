import {Token, TokenType} from '../../models/asg.models';
import {ASG_MAP} from '../../models/asg.map';

/**
 * Analizador léxico del compilador. Tokeniza el programa introducido en el editor de texto
 *
 * TODO: traducir con transloco los errores léxicos
 */
export class AsgLexerService {
  private source: string;
  private tokens: Token[] = [];
  private cursor = 0;
  private line = 1;
  private column = 1;

  // 1. Obtenemos todas las claves y las unimos con el operador OR (|)
  private instructionNames = Object.keys(ASG_MAP).sort((a, b) => b.length - a.length).join('|');
// Quedará algo como: "ADD|SUB|CVTF2D|MOVI2FP|J|..." creando la expresión regular dinámicamente.
// Usamos ^ para el inicio y \b (word boundary) para asegurar que es la palabra completa.
  private instructionRegex = new RegExp(`^(${this.instructionNames})\\b`, 'i'); // Agregado \b (word boundary)

  // Mapa de expresiones regulares (El orden importa)
  private readonly rules = [
    { type: TokenType.DIRECTIVE,   regex: /^\.[a-z]+/i },
    // LABEL_DEF debe ser muy específico para no pisar a INSTRUCTION
    { type: TokenType.LABEL_DEF,    regex: /^[a-z_][a-z0-9_]*:/i },
    { type: TokenType.REGISTER,     regex: /^[RVF]\d+/i },
    // Movido IMMEDIATE arriba para que el prefijo # tenga prioridad sobre SYMBOL
    // Capturo float primero
    {
      type: TokenType.FLOAT,
      regex: /^#?-?\d+\.\d+/
    },
    // Luego el entero (Decimal o Hex)
    {
      type: TokenType.INT,
      regex: /^#?(-?0x[0-9a-f]+|-?\d+)/i
    },
    { type: TokenType.INSTRUCTION,  regex: this.instructionRegex },
    { type: TokenType.STRING,       regex: /^"[^"]*"/ },
    { type: TokenType.COMMA,        regex: /^,/ },
    { type: TokenType.PAREN_L,      regex: /^\(/ },
    { type: TokenType.PAREN_R,      regex: /^\)/ },
    { type: TokenType.SYMBOL,       regex: /^[a-z_][a-z0-9_]*/i },
  ];

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    while (!this.isAtEnd()) {
      const char = this.peek();

      // Ignorar espacios y comentarios
      if (/\s/.test(char)) {
        this.handleWhitespace(char);
        continue;
      }
      if (char === ';') {
        this.skipComment();
        continue;
      }

      // Matcheo de reglas del lenguaje
      let matched = false;
      const remainingSource = this.source.slice(this.cursor);

      for (const { type, regex } of this.rules) {
        const match = remainingSource.match(regex);
        if (match) {
          const value = match[0];
          this.tokens.push({
            type,
            value: type === TokenType.LABEL_DEF ? value.slice(0, -1) : value, // Quitar el ':'
            line: this.line,
            column: this.column
          });

          this.advance(value.length);
          matched = true;
          break;
        }
      }

      if (!matched) {
        throw new Error(`Error Léxico: Carácter inesperado '${char}' en línea ${this.line}, col ${this.column}`);
      }
    }

    this.tokens.push({ type: TokenType.EOF, value: '', line: this.line, column: this.column });
    return this.tokens;
  }

  private advance(n: number = 1) {
    this.cursor += n;
    this.column += n;
  }

  private peek(): string {
    return this.source[this.cursor];
  }

  private isAtEnd(): boolean {
    return this.cursor >= this.source.length;
  }

  private handleWhitespace(char: string) {
    if (char === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    this.cursor++;
  }

  private skipComment() {
    while (!this.isAtEnd() && this.peek() !== '\n') {
      this.cursor++;
    }
  }
}
