import {ASG_MAP} from '../models/asg.map';

/**
 * Definicion del lenguaje ASG para el editor Monaco, le pasamos el listado de instrucciones y creamos los tokens
 */
export const asgLanguageTokens: any = {
  ignoreCase: true,
  defaultToken: '',
  instructions: Object.keys(ASG_MAP),
  tokenizer: {
    root: [
      // Comentarios (Los ponemos primero para que se ignore el resto de la linea)
      [/[;].*/, 'comment'],
      // Directivas del lenguaje (ej: .text, .data, .asciiz, .align)
      [/\.[a-zA-Z_]\w*/, 'keyword.directive'],
      // Etiquetas (ej: LOOP:, NOMBRE:)
      [/[a-zA-Z_]\w*:/, 'metatag'],
      // Instrucciones e identificadores
      [/[a-zA-Z_]\w*/, {
        cases: {
          '@instructions': 'keyword', // Si coincide con ASG_MAP, es instrucción
          '@default': 'identifier'    // Si no, es un identificador normal
        }
      }],
      // Registros (R0-R31, F0-F31, V0-V7)
      [/\b([RF])([0-9]|[12][0-9]|3[01])\b|\bV([0-7])\b/, 'variable.predefined'],
      // Registros de sistema (ej: VM, VLR)
      [/FPBC|IAR|VM|VLR/i, 'variable.predefined'],
      // Números
      [/-?#?0x[0-9a-fA-F]+/, 'number.hex'], // Ej: 0xABC, -0x12, #0xABC
      [/-?\d+\.\d+/, 'number.float'],           // Ej: 3.1415, -0.5 (Para .float / .double)
      [/-?#?\d+/, 'number'],                    // Ej: 50, #10, -5
      // Cadenas de texto (Para .ascii y .asciiz)
      [/"([^"\\]|\\.)*"/, 'string'],
      // Símbolos y delimitadores
      [/[(),]/, 'delimiter'],
      // Espacios en blanco
      { include: '@whitespace' },
    ],
    whitespace: [
      [/[ \t\r\n]+/, 'white'],
    ],
  }
};

export const asgLanguageConfig: any = {
  comments: {
    lineComment: ';',
  },
  brackets: [
    ['(', ')'],
    ['[', ']']
  ],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '"', close: '"' }
  ],
  surroundingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '"', close: '"' }
  ]
};
