import { inject, Injectable } from '@angular/core';
import { AssemblerError } from '../../models/asg.exceptions';
import { Token, TokenType } from '../../models/asg.models';
import { AsgLexerService } from './asg.lexer';
import { AsgSemanticAnalyzerService } from './asg.semantic-analyzer';
import { AsgInstructionFactoryService } from './asg.instruction-factory';
import { AsgInstruction } from '../../models/instructions/asg.instruction';
import { AsgConfigService } from '../asg.config';

export interface SourceModule {
  name: string;
  source: string;
}

export interface AssembleResult {
  success: boolean;
  message: string;
  instructions: AsgInstruction[];
  instructionBinary: Uint8Array;
  dataBuffer: Uint8Array;
  /** Línea global que causó el error */
  errorLine: number;
  /** Índice del módulo donde ocurrió el error (-1 si no aplica). */
  errorModule: number;
  /** Dirección de inicio del segmento .text (0 si no se especificó offset). */
  initialCodePtr: number;
  /** Offset de línea para cada módulo: lineOffsets[i] es el número de línea
   *  global donde comienza el módulo i (base 0, sumado a los locales base-1). */
  lineOffsets: number[];
}

@Injectable({ providedIn: 'root' })
export class AsgAssemblerService {

  private readonly configService = inject(AsgConfigService);

  assembleProgram(modules: SourceModule[]): AssembleResult {
    const lineOffsets: number[] = [];

    try {
      const allTokens: Token[] = [];
      let lineOffset = 0;

      for (let modIdx = 0; modIdx < modules.length; modIdx++) {
        const mod = modules[modIdx];
        const lexer = new AsgLexerService(mod.source);
        const tokens = lexer.tokenize().filter(t => t.type !== TokenType.EOF);

        lineOffsets.push(lineOffset);

        // Etiquetas declaradas como .global en este módulo tienen que ser visibles en to do el programa
        const globalDecls = new Set<string>();
        for (let j = 0; j < tokens.length; j++) {
          if (tokens[j].type === TokenType.DIRECTIVE && tokens[j].value.toLowerCase() === '.global') {
            if (j + 1 < tokens.length && tokens[j + 1].type === TokenType.SYMBOL) {
              globalDecls.add(tokens[j + 1].value);
            }
          }
        }

        // Etiquetas definidas localmente (solo visibles en este modulo)
        const localDefs = new Set<string>();
        for (const t of tokens) {
          if (t.type === TokenType.LABEL_DEF && !globalDecls.has(t.value)) {
            localDefs.add(t.value);
          }
        }

        // Añadir tokens al stream global renombrando las etiquetas locales con el prefijo __m<idx>__ para evitar colisiones entre módulos.
        // Las referencias a etiquetas no definidas en este módulo se dejan sin renombrar (se resolverán como globales o darán error).
        const prefix = `__m${modIdx}__`;
        for (const t of tokens) {
          const isLocalRef = (t.type === TokenType.LABEL_DEF || t.type === TokenType.SYMBOL)
            && localDefs.has(t.value);
          allTokens.push({
            ...t,
            value: isLocalRef ? prefix + t.value : t.value,
            line: t.line + lineOffset,
          });
        }

        lineOffset += mod.source.split('\n').length;
      }

      // EOF
      allTokens.push({ type: TokenType.EOF, value: '', line: lineOffset, column: 0 });

      const memorySize = this.configService.getCurrentConfig().memorySize;
      const analyzer = new AsgSemanticAnalyzerService(allTokens, memorySize);
      const { instructions, dataBuffer, initialCodePtr } = analyzer.analyze();

      const instructionBinary = AsgInstructionFactoryService.assemble(instructions);

      return {
        success: true,
        message: '',
        errorLine: 0,
        errorModule: -1,
        initialCodePtr,
        lineOffsets,
        instructions,
        instructionBinary,
        dataBuffer,
      };

    } catch (error: any) {
      console.error('Fallo en el ensamblado:', error.message);
      const globalErrorLine = error instanceof AssemblerError ? error.line : 0;

      // busca el modulo que tiene el error
      let errorModule = 0;
      for (let i = lineOffsets.length - 1; i >= 0; i--) {
        if (i === 0 || globalErrorLine > lineOffsets[i]) {
          errorModule = i;
          break;
        }
      }
      // obtener la linea local del modulo que ha dado error
      const localLine = globalErrorLine - (lineOffsets[errorModule] ?? 0);

      // devolver la linea local en el mensaje (para mejor depuracion y marcarlo en el editor)
      let message = error.message;
      if (error instanceof Error && globalErrorLine > 0) {
        message = message.replace(`Línea ${globalErrorLine}:`, `Línea ${localLine}:`);
      }

      return {
        success: false,
        message: message,
        instructions: [],
        instructionBinary: new Uint8Array(0),
        dataBuffer: new Uint8Array(0),
        errorLine: globalErrorLine,
        errorModule,
        initialCodePtr: 0,
        lineOffsets,
      };
    }
  }
}
