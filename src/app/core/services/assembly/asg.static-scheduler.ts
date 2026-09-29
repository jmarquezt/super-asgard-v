import { inject, Injectable } from '@angular/core';
import { Token, TokenType } from '../../models/asg.models';
import { getConfiguredLatency } from '../../models/asg.config';
import { getFunctionalUnitType } from '../../models/superscalar/fu';
import { ASG_MAP, FunctionalUnitType } from '../../models/asg.map';
import { AsgConfigService } from '../asg.config';
import { AsgLexerService } from './asg.lexer';
import { AsgProcessorFactoryService } from '../processor/asg.processor-factory';

/** Estructura para agrupar tokens por línea */
interface TokenLine {
  tokens: Token[];
  originalText: string;
  isInstruction: boolean;
  opcode?: string;
  rd?: string;
  sources: string[];
  isJump?: boolean;
  label?: string;
  isModified?: boolean;
  /** Propiedades para análisis de dependencias de memoria */
  memBase?: string;
  memOffset?: number;
  /** Line was synthesised by the scheduler (e.g. NOP for delay-slot filling) */
  isInserted?: boolean;
}

/** Status of a line in the optimized output relative to the original source */
export type LineStatus = 'unchanged' | 'reordered' | 'new';

export interface AnnotatedLine {
  text: string;
  status: LineStatus;
}

export interface OptimizeResult {
  code: string;
  lines: AnnotatedLine[];
  reorderedCount: number;
  insertedCount: number;
  error?: string;
  unrollWarning?: string;
}

/** Configuración de optimización */
export interface StaticSchedulerConfig {
  enableScheduling: boolean;
  enableUnrolling: boolean;
  unrollFactor: number;
  enableRegisterRenaming: boolean;
  enableDelayedBranch: boolean;
}


@Injectable({
  providedIn: 'root'
})
export class AsgStaticSchedulerService {
  private configService = inject(AsgConfigService);
  private processorFactory = inject(AsgProcessorFactoryService);
  private lastUnrollWarning: string | null = null;

  /**
   * Obtiene la latencia real de una instrucción considerando la configuración del usuario
   */
  private getInstructionLatency(opcode: string): number {
    const instrConfig = ASG_MAP[opcode.toUpperCase()];
    if (!instrConfig) return 1;

    // 1. Intentar obtener latencia personalizada de los ajustes
    const cfgLatency = getConfiguredLatency(opcode, this.configService.getCurrentConfig().latencies);

    // 2. Si existe (>0), la usamos. Si no, usamos la de ASG_MAP
    return cfgLatency || instrConfig.cycles || 1;
  }

  /**
   * Obtiene el número de unidades funcionales disponibles según el modo de ejecución
   *
   * MODO ESCALAR (pipelined):
   *   - 1 unidad MEM para loads/stores escalares
   *   - 1 unidad EX para todas las operaciones escalares (INT, FP, BRANCH)
   *   - 1 unidad VEC_MEM para loads/stores vectoriales
   *   - 1 unidad VEC_EX para operaciones vectoriales
   *
   * MODO SUPERESCALAR:
   *   - Múltiples unidades según configuración del usuario
   */
  private getAvailableFunctionalUnits(): Map<FunctionalUnitType, number> {
    const units = new Map<FunctionalUnitType, number>();

    if (this.processorFactory.isSuperscalar()) {
      // Modo Superescalar: usar configuración completa
      const config = this.configService.getCurrentConfig().superscalar;

      units.set('INT_ALU', config.intALUs);
      units.set('INT_MUL', config.intMulUnits);
      units.set('INT_DIV', config.intDivUnits);
      units.set('FP_ADD', config.fpAddUnits);
      units.set('FP_MUL', config.fpMulUnits);
      units.set('FP_DIV', config.fpDivUnits);
      units.set('MEM', config.memUnits);
      units.set('BRANCH', config.branchUnits);
      units.set('VEC_MEM', config.vecMemUnits);
      units.set('VEC_INT', config.vecIntUnits);
      units.set('VEC_MUL', config.vecMulUnits);
      units.set('VEC_DIV', config.vecDivUnits);
    } else {
      // Modo Escalar: hardware limitado
      // Una unidad EX compartida para todas las operaciones escalares
      units.set('INT_ALU', 1);
      units.set('INT_MUL', 1);  // Comparte con EX
      units.set('INT_DIV', 1);  // Comparte con EX
      units.set('FP_ADD', 1);   // Comparte con EX
      units.set('FP_MUL', 1);   // Comparte con EX
      units.set('FP_DIV', 1);   // Comparte con EX
      units.set('BRANCH', 1);   // Comparte con EX
      units.set('MEM', 1);      // Unidad de memoria escalar dedicada

      // Unidades vectoriales dedicadas
      units.set('VEC_MEM', 1);
      units.set('VEC_INT', 1);  // Comparte con VEC_EX
      units.set('VEC_MUL', 1);  // Comparte con VEC_EX
      units.set('VEC_DIV', 1);  // Comparte con VEC_EX
    }

    return units;
  }

  /**
   * Determina si dos instrucciones comparten la misma unidad funcional en modo escalar
   * En modo escalar, todas las operaciones escalares comparten la unidad EX,
   * y todas las operaciones vectoriales comparten la unidad VEC_EX
   */
  private sharesFunctionalUnit(fuType1: FunctionalUnitType, fuType2: FunctionalUnitType): boolean {
    if (this.processorFactory.isSuperscalar()) {
      // En superescalar, solo comparten si son del mismo tipo exacto
      return fuType1 === fuType2;
    }

    // En escalar, verificar si comparten unidad EX o VEC_EX
    const scalarExUnits: FunctionalUnitType[] = ['INT_ALU', 'INT_MUL', 'INT_DIV', 'FP_ADD', 'FP_MUL', 'FP_DIV', 'BRANCH'];
    const vectorExUnits: FunctionalUnitType[] = ['VEC_INT', 'VEC_MUL', 'VEC_DIV'];

    const type1IsScalarEx = scalarExUnits.includes(fuType1);
    const type2IsScalarEx = scalarExUnits.includes(fuType2);

    if (type1IsScalarEx && type2IsScalarEx) return true;

    const type1IsVectorEx = vectorExUnits.includes(fuType1);
    const type2IsVectorEx = vectorExUnits.includes(fuType2);

    if (type1IsVectorEx && type2IsVectorEx) return true;

    return fuType1 === fuType2;
  }

  /**
   * Determina si una unidad funcional es pipelined (puede aceptar una nueva instrucción cada ciclo)
   * o no-pipelined (ocupada durante toda su latencia)
   *
   * Generalmente:
   * - Pipelined: ALU, MUL, ADD, MEM
   * - No-Pipelined: DIV (muy compleja, ocupa la unidad durante toda la operación)
   */
  private isPipelinedUnit(fuType: FunctionalUnitType): boolean {
    // Las divisiones típicamente NO son pipelined
    const nonPipelinedUnits: FunctionalUnitType[] = ['INT_DIV', 'FP_DIV', 'VEC_DIV'];
    return !nonPipelinedUnits.includes(fuType);
  }

  /**
   * Calcula cuántos ciclos una unidad funcional está ocupada después de emitir una instrucción
   * - Pipelined: 1 ciclo (solo el ciclo de issue)
   * - No-Pipelined: latencia completa
   */
  private getFUOccupancyCycles(fuType: FunctionalUnitType, latency: number): number {
    return this.isPipelinedUnit(fuType) ? 1 : latency;
  }

  public optimize(source: string, config: StaticSchedulerConfig): OptimizeResult {
    this.lastUnrollWarning = null;
    try {
      const lexer = new AsgLexerService(source);
      const tokens = lexer.tokenize();
      let lines = this.groupTokensByLine(tokens, source);

      if (config.enableUnrolling) {
        lines = this.applyLoopUnrolling(lines, config.unrollFactor);
      }

      if (config.enableRegisterRenaming) {
        lines = this.applyRegisterRenaming(lines);
      }

      if (config.enableScheduling) {
        lines = this.applyScheduling(lines);
      }

      if (config.enableDelayedBranch) {
        lines = this.applyDelayedBranchFilling(lines);
      }

      const result = this.reconstructAnnotated(lines);
      if (this.lastUnrollWarning) result.unrollWarning = this.lastUnrollWarning;
      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        code: source,
        lines: source.split('\n').map(text => ({ text, status: 'unchanged' as LineStatus })),
        reorderedCount: 0,
        insertedCount: 0,
        error: errorMessage,
      };
    }
  }

  private groupTokensByLine(tokens: Token[], source: string): TokenLine[] {
    const lines: TokenLine[] = [];
    const sourceLines = source.split('\n');
    let tokensByLine: Record<number, Token[]> = {};

    tokens.forEach(t => {
      if (!tokensByLine[t.line]) tokensByLine[t.line] = [];
      tokensByLine[t.line].push(t);
    });

    for (let i = 1; i <= sourceLines.length; i++) {
      lines.push(this.analyzeLine(tokensByLine[i] || [], sourceLines[i - 1]));
    }
    return lines;
  }

  private analyzeLine(tokens: Token[], text: string): TokenLine {
    const line: TokenLine = { tokens, originalText: text, isInstruction: false, sources: [] };
    if (tokens.length === 0) return line;

    if (tokens[0].type === TokenType.LABEL_DEF) {
      line.label = tokens[0].value.replace(':', '');
    }

    const opcodeToken = tokens.find(t =>
      (t.type === TokenType.INSTRUCTION || t.type === TokenType.SYMBOL) && ASG_MAP[t.value.toUpperCase()]
    );

    if (opcodeToken) {
      line.isInstruction = true;
      line.opcode = opcodeToken.value.toUpperCase();
      line.isJump = ['J', 'JAL', 'JR', 'JALR', 'BEQZ', 'BNEZ', 'BGTZ', 'BLTZ', 'BFPT', 'BFPF', 'TRAP', 'RFE'].includes(line.opcode);

      const registerTokens = tokens.filter(t => t.type === TokenType.REGISTER);
      if (registerTokens.length > 0) {
        const isStore = ['SW', 'SD', 'SF', 'SB', 'SH', 'SV', 'SVI', 'SVWS'].includes(line.opcode);
        if (isStore || line.isJump) {
          line.sources = registerTokens.map(t => t.value.toUpperCase());
        } else {
          line.rd = registerTokens[0].value.toUpperCase();
          line.sources = registerTokens.slice(1).map(t => t.value.toUpperCase());
        }
      }

      // --- Análisis de Memoria para Scheduling ---
      const pi = tokens.findIndex(t => t.type === TokenType.PAREN_L);
      if (pi !== -1 && tokens[pi + 1]?.type === TokenType.REGISTER) {
        line.memBase = tokens[pi + 1].value.toUpperCase();
        const immIdx = pi - 1;
        if (immIdx >= 0 && tokens[immIdx].type === TokenType.INT) {
          line.memOffset = parseInt(tokens[immIdx].value.replace('#', '')) || 0;
        } else {
          line.memOffset = 0;
        }
      }

      // --- Dependencias Implícitas ---
      // 1. Bit de condición de punto flotante (FPCC)
      const writesFPCC = line.opcode.startsWith('EQ') || line.opcode.startsWith('NE') ||
                        line.opcode.startsWith('LT') || line.opcode.startsWith('GT') ||
                        line.opcode.startsWith('LE') || line.opcode.startsWith('GE') ||
                        line.opcode.startsWith('SLT') || line.opcode.startsWith('SGT') ||
                        line.opcode.startsWith('SLE') || line.opcode.startsWith('SGE');
      if (writesFPCC && (line.opcode.endsWith('F') || line.opcode.endsWith('D'))) {
        line.rd = line.rd ? `${line.rd},%FPCC` : '%FPCC';
      }
      if (line.opcode === 'BFPT' || line.opcode === 'BFPF') {
        line.sources.push('%FPCC');
      }

      // 2. Máscara vectorial (VM)
      const isVector = ASG_MAP[line.opcode]?.type === 'V' || ASG_MAP[line.opcode]?.target === 'V';
      const writesVM = line.opcode.startsWith('SEQV') || line.opcode.startsWith('SNEV') ||
                      line.opcode.startsWith('SGTV') || line.opcode.startsWith('SLTV') ||
                      line.opcode.startsWith('SGEV') || line.opcode.startsWith('SLEV') ||
                      line.opcode === 'CVM';
      if (writesVM) line.rd = line.rd ? `${line.rd},%VM` : '%VM';
      if (isVector && !writesVM && line.opcode !== 'CVI') {
        line.sources.push('%VM');
      }
    }
    return line;
  }

  private applyScheduling(lines: TokenLine[]): TokenLine[] {
    const result: TokenLine[] = [];
    let currentBlock: TokenLine[] = [];

    const flushBlock = () => {
      if (currentBlock.length > 0) {
        result.push(...this.scheduleBasicBlock(currentBlock));
        currentBlock = [];
      }
    };

    for (const line of lines) {
      // Si la línea tiene etiqueta, es un punto de entrada.
      // Cerramos el bloque anterior para que nada suba ni baje a través de ella.
      if (line.label && currentBlock.length > 0) {
        flushBlock();
      }

      if (line.isJump) {
        currentBlock.push(line);
        flushBlock();
      } else if (!line.isInstruction) {
        // Comentarios y directivas fuera del bloque de ejecución
        if (currentBlock.some(l => l.isInstruction)) {
          currentBlock.push(line);
        } else {
          result.push(line);
        }
      } else {
        currentBlock.push(line);
      }
    }
    flushBlock();

    return result;
  }


  /**
   * List Scheduling Algorithm - Schedules a basic block to minimize stalls
   *
   * Algorithm:
   * 1. Build dependency graph (already done via hasDependency)
   * 2. Calculate priority for each instruction (critical path ranking)
   * 3. Maintain ready list - instructions whose dependencies are satisfied
   * 4. Each cycle, select highest priority ready instruction that:
   *    - Has all data dependencies satisfied (ready times)
   *    - Has all structural dependencies satisfied (memory order, control)
   *    - Has a functional unit available
   * 5. Track when each register will be ready (write time + latency)
   * 6. Track functional unit availability (respects hardware constraints)
   */
  private scheduleBasicBlock(block: TokenLine[]): TokenLine[] {
    const instructions = block.filter(l => l.isInstruction);
    const nonInstructions = block.filter(l => !l.isInstruction);
    if (instructions.length <= 1) return block;

    const n = instructions.length;
    const ranks = this.calculateRanks(instructions);

    // Build local dependency graph for the block
    const predecessors = new Array(n).fill(0).map(() => new Set<number>());
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (this.hasDependency(instructions[i], instructions[j])) {
          predecessors[j].add(i);
        }
      }
    }

    const scheduled: Array<{ instr: TokenLine; cycle: number; fuType: FunctionalUnitType }> = [];
    const remaining = new Set<number>(instructions.map((_, i) => i));
    const registerReadyTime = new Map<string, number>();
    const availableFUs = this.getAvailableFunctionalUnits();

    // Ancho de despacho según configuración
    const isSuperscalar = this.processorFactory.isSuperscalar();
    const issueWidth = isSuperscalar ? (this.configService.getCurrentConfig().superscalar.issueWidth || 2) : 1;

    let currentCycle = 0;
    while (remaining.size > 0 && currentCycle < n * 50) {
      let issuedThisCycleCount = 0;
      let issuedAnyInIteration = false;

      do {
        issuedAnyInIteration = false;
        if (issuedThisCycleCount >= issueWidth) break;

        // Identificar candidatos listos
        const candidates: number[] = [];
        for (const idx of remaining) {
           // 1. Dependencias de orden satisfechas
           let predsDone = true;
           for (const pIdx of predecessors[idx]) {
             if (remaining.has(pIdx)) { predsDone = false; break; }
           }
           if (!predsDone) continue;

           const instr = instructions[idx];

           // --- BARRERA DE SALTO (TERMINADOR) ---
           // Un salto o branch SIEMPRE debe ser la última instrucción del bloque.
           // No permitimos elegirlo si quedan otras instrucciones por planificar.
           if (instr.isJump && remaining.size > 1) continue;

           // --- BARRERA DE ETIQUETA ---
           // Una instrucción con etiqueta NO puede moverse hacia arriba.
           if (instr.label) {
              let olderInstructionRemaining = false;
              for (const otherIdx of remaining) {
                if (otherIdx < idx) { olderInstructionRemaining = true; break; }
              }
              if (olderInstructionRemaining) continue;
           }

           // 2. Disponibilidad de Datos (RAW)
           let dataReady = true;
           for (const src of instr.sources) {
             for (const reg of src.split(',')) {
               if ((registerReadyTime.get(reg) ?? 0) > currentCycle) { dataReady = false; break; }
             }
             if (!dataReady) break;
           }
           if (!dataReady) continue;

           // 3. Unidad funcional libre
           const fuType = getFunctionalUnitType(instr.opcode ?? 'NOP');
           const maxFUs = availableFUs.get(fuType) ?? 1;
           let busyCount = 0;
           for (const s of scheduled) {
             const lat = this.getInstructionLatency(s.instr.opcode ?? 'NOP');
             const occupancy = this.getFUOccupancyCycles(s.fuType, lat);
             if (currentCycle >= s.cycle && currentCycle < s.cycle + occupancy) {
               if (this.sharesFunctionalUnit(fuType, s.fuType)) busyCount++;
             }
           }
           if (busyCount >= maxFUs) continue;

           candidates.push(idx);
        }

        if (candidates.length > 0) {
          // Ordenar por RANK (Ruta Crítica)
          candidates.sort((a, b) => ranks[b] - ranks[a] || a - b);

          const chosen = candidates[0];
          const instr = instructions[chosen];
          const fuType = getFunctionalUnitType(instr.opcode ?? 'NOP');

          // Latencia de planificación: forzamos 2 para Loads
          let lat = this.getInstructionLatency(instr.opcode ?? 'NOP');
          if (['LD','LW','LF','LB','LH','LD'].includes(instr.opcode ?? '')) lat = Math.max(lat, 2);

          scheduled.push({ instr, cycle: currentCycle, fuType });
          if (instr.rd) {
            instr.rd.split(',').forEach(r => registerReadyTime.set(r, currentCycle + lat));
          }

          remaining.delete(chosen);
          issuedThisCycleCount++;
          issuedAnyInIteration = true;
        }
      } while (issuedAnyInIteration && remaining.size > 0 && issuedThisCycleCount < issueWidth);

      currentCycle++;
    }

    // Marcar instrucciones reordenadas
    scheduled.forEach(({ instr }, outputIdx) => {
      if (instr !== instructions[outputIdx]) instr.isModified = true;
    });

    return [...scheduled.map(s => s.instr), ...nonInstructions];
  }

  /**
   * Calcula el Rank (Ruta Crítica) para cada instrucción.
   * Rank = Latencia propia + Máximo Rank de sus dependientes.
   */
  private calculateRanks(instructions: TokenLine[]): number[] {
    const n = instructions.length;
    const ranks = new Array(n).fill(0);
    const dependents = new Array(n).fill(0).map(() => [] as number[]);

    // 1. Construir grafo de dependencias (solo las que existen en la traza/bloque)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (this.hasDependency(instructions[i], instructions[j])) {
          dependents[i].push(j);
        }
      }
    }

    // 2. Calcular Ranks recursivamente (de atrás hacia adelante)
    const getRank = (idx: number): number => {
      if (ranks[idx] !== 0) return ranks[idx];

      let maxChildRank = 0;
      for (const child of dependents[idx]) {
        maxChildRank = Math.max(maxChildRank, getRank(child));
      }

      const latency = this.getInstructionLatency(instructions[idx].opcode ?? 'ADD');
      ranks[idx] = latency + maxChildRank;
      return ranks[idx];
    };

    for (let i = n - 1; i >= 0; i--) {
      getRank(i);
    }
    return ranks;
  }

  /**
   * Determina si existe una dependencia (RAW, WAR, WAW o Memoria) entre a (anterior) y b (posterior).
   */
  private hasDependency(a: TokenLine, b: TokenLine): boolean {
    const rdA = (a.rd ?? '').split(',').filter(r => r !== '');
    const rdB = (b.rd ?? '').split(',').filter(r => r !== '');
    const srcA = a.sources;
    const srcB = b.sources;

    // RAW: b lee lo que a escribe
    if (rdA.some(r => srcB.includes(r))) return true;

    // WAR: b escribe lo que a lee
    if (rdB.some(r => srcA.includes(r))) return true;

    // WAW: ambos escriben lo mismo
    if (rdA.some(r => rdB.includes(r))) return true;

    // Dependencia de Memoria (Disambiguation):
    const isMemA = ASG_MAP[a.opcode ?? '']?.type === 'M';
    const isMemB = ASG_MAP[b.opcode ?? '']?.type === 'M';

    if (isMemA && isMemB) {
      const isStoreA = ['SW','SD','SF','SB','SH','SV','SVI','SVWS'].includes(a.opcode ?? '');
      const isStoreB = ['SW','SD','SF','SB','SH','SV','SVI','SVWS'].includes(b.opcode ?? '');

      // Si ambos son Loads, son independientes (pueden reordenarse libremente)
      if (!isStoreA && !isStoreB) return false;

      // Si hay al menos un Store, comprobamos si apuntan a la misma dirección
      // REGLA 1: Si los registros base son distintos, asumimos que no hay alias (optimista)
      if (a.memBase && b.memBase && a.memBase !== b.memBase) return false;

      // REGLA 2: Si el registro base es el mismo, pero los offsets son constantes y distintos
      if (a.memBase && b.memBase && a.memBase === b.memBase) {
        if (a.memOffset !== undefined && b.memOffset !== undefined && a.memOffset !== b.memOffset) {
          return false;
        }
      }

      // En cualquier otro caso de duda (ej: registros base iguales con offsets variables), dependemos
      return true;
    }

    return false;
  }

  private applyLoopUnrolling(lines: TokenLine[], factor: number): TokenLine[] {
    if (factor <= 1) return lines;

    const MEM_OPCODES = new Set(['LW','LH','LB','LF','LD','LHU','LBU','SW','SH','SB','SF','SD']);
    const result: TokenLine[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.label) { result.push(line); continue; }

      // Buscar el salto de retroceso que cierra el bucle
      let loopEnd = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].isJump && lines[j].tokens.some(t => t.value === line.label)) {
          loopEnd = j;
          break;
        }
      }
      if (loopEnd === -1) { result.push(line); continue; }

      const loopBody = lines.slice(i, loopEnd);
      const jumpLine  = lines[loopEnd];

      // Detectar el registro puntero: el que aparece tras PAREN_L en instrucciones de memoria
      let ptrReg: string | null = null;
      for (const l of loopBody) {
        if (!l.isInstruction || !MEM_OPCODES.has(l.opcode ?? '')) continue;
        const pi = l.tokens.findIndex(t => t.type === TokenType.PAREN_L);
        if (pi !== -1 && l.tokens[pi + 1]?.type === TokenType.REGISTER) {
          ptrReg = l.tokens[pi + 1].value.toUpperCase();
          break;
        }
      }

      // Detectar stride y dirección: ADD/SUB/ADDI/SUBI que actualiza el registro puntero
      let stride = 8; // fallback
      let isDecrement = false;
      let ptrUpdateLine: TokenLine | null = null;
      for (const l of loopBody) {
        const isUpdateOp = l.opcode === 'ADDI' || l.opcode === 'SUBI' ||
                          l.opcode === 'ADD' || l.opcode === 'SUB';
        if (isUpdateOp && l.rd === ptrReg) {
          ptrUpdateLine = l;
          isDecrement = l.opcode === 'SUBI' || l.opcode === 'SUB';
          const immTok = l.tokens.find(t => t.type === TokenType.INT);
          if (immTok) {
            stride = Math.abs(parseInt(immTok.value.replace('#', '')) || 8);
          }
          break;
        }
      }

      // Instrucción de control del contador (ADD/SUB/ADDI/SUBI que NO es el puntero)
      const counterLine = loopBody.find(l => {
        const isUpdateOp = l.opcode === 'ADDI' || l.opcode === 'SUBI' ||
                          l.opcode === 'ADD' || l.opcode === 'SUB';
        return isUpdateOp && l !== ptrUpdateLine;
      }) ?? null;

      // --- COMPROBACIÓN DE SEGURIDAD: Detectar límite y ajustar factor ---
      const controlReg = counterLine ? counterLine.rd : ptrReg;
      let maxIterations = Infinity;

      if (controlReg) {
        for (let k = i - 1; k >= 0; k--) {
          const l = lines[k];
          if (l.label) break; // No saltar a otros bloques básicos
          if (l.rd === controlReg && (l.opcode === 'ADDI' || l.opcode === 'ORI' || l.opcode === 'LI' || l.opcode === 'ADD')) {
            const immTok = l.tokens.find(t => t.type === TokenType.INT);
            if (immTok) {
              const startVal = Math.abs(parseInt(immTok.value.replace('#', '')) || 0);
              // Solo detectamos si el bucle es "limpio" (termina exactamente en 0)
              if (stride > 0 && (startVal % stride === 0)) {
                maxIterations = Math.floor(startVal / stride);
              }
              break;
            }
          }
        }
      }

      // Elegir el factor más alto que sea divisor de las iteraciones totales (para evitar crash)
      let actualFactor = factor;
      if (maxIterations !== Infinity && (maxIterations % factor !== 0)) {
        let bestDivisor = 1;
        // Buscamos el mejor divisor cercano al factor pedido
        for (let d = 1; d <= Math.min(maxIterations, factor + 4); d++) {
          if (maxIterations % d === 0) {
            if (d <= factor) bestDivisor = d;
            else if (bestDivisor === 1) bestDivisor = d; // si no hay nada debajo, cogemos el primero arriba
          }
        }
        actualFactor = bestDivisor;
      } else if (maxIterations !== Infinity) {
        actualFactor = Math.min(factor, maxIterations);
      }

      if (actualFactor !== factor) {
        this.lastUnrollWarning = 'STATIC_SCHEDULER.UNROLL_ADJUSTED';
      }

      // Recolectar registros escritos en el bucle que son candidatos para renombrado
      // Un registro solo es candidato si es un "temporal puro": se escribe antes de leerse
      const writtenRegs = new Set<string>();
      const loopCarriedRegs = new Set<string>();

      for (const l of loopBody) {
        if (!l.isInstruction) continue;

        // 1. Verificar si los registros fuente ya han sido escritos en este bucle
        for (const s of l.sources) {
          const reg = s.toUpperCase();
          if (!writtenRegs.has(reg) && reg !== 'R0') {
            loopCarriedRegs.add(reg);
          }
        }

        // 2. Registrar la escritura (si no es el puntero o contador)
        if (l.rd && l !== ptrUpdateLine && l !== counterLine) {
          writtenRegs.add(l.rd.toUpperCase());
        }
      }

      // Los candidatos finales son los que se escriben pero NUNCA se leyeron antes de escribirse
      const renameCandidates = new Set<string>();
      for (const reg of writtenRegs) {
        if (!loopCarriedRegs.has(reg)) {
          renameCandidates.add(reg);
        }
      }

      // Ordenar para que el mapeo sea consistente
      const sortedCandidates = Array.from(renameCandidates).sort((a, b) => {
        if (a[0] !== b[0]) return a.localeCompare(b);
        return parseInt(a.substring(1)) - parseInt(b.substring(1));
      });

      // 1. Encontrar el registro más alto utilizado de cada tipo (para evitar colisiones)
      let maxR = -1, maxF = -1, maxV = -1;
      for (const l of loopBody) {
        if (!l.isInstruction) continue;
        const allRegs = [l.rd, ...l.sources].filter(r => !!r) as string[];
        for (const r of allRegs) {
          const type = r[0].toUpperCase();
          const num = parseInt(r.substring(1));
          if (isNaN(num)) continue;
          if (type === 'R') maxR = Math.max(maxR, num);
          else if (type === 'F') maxF = Math.max(maxF, num);
          else if (type === 'V') maxV = Math.max(maxV, num);
        }
      }

      // Mapa de renombrado de registros para cada iteración
      const registerMap = new Map<string, string>();

      // Emitir factor copias del cuerpo ajustando offsets y renombrando registros
      for (let f = 0; f < actualFactor; f++) {
        registerMap.clear();

        // En f > 0, crear un mapeo inteligente y compacto
        if (f > 0) {
          let nextR = maxR + 1;
          let nextV = maxV + 1;
          let nextF = (maxF % 2 === 0) ? maxF + 2 : maxF + 1;

          sortedCandidates.forEach((originalReg) => {
            const type = originalReg[0];
            if (type === 'R') {
              const count = sortedCandidates.filter(r => r[0] === 'R').indexOf(originalReg);
              const newNum = (nextR + (f - 1) * sortedCandidates.filter(r => r[0] === 'R').length + count) % 32;
              registerMap.set(originalReg, `R${newNum}`);
            } else if (type === 'V') {
              const count = sortedCandidates.filter(r => r[0] === 'V').indexOf(originalReg);
              const newNum = (nextV + (f - 1) * sortedCandidates.filter(r => r[0] === 'V').length + count) % 8;
              registerMap.set(originalReg, `V${newNum}`);
            } else if (type === 'F') {
              const count = sortedCandidates.filter(r => r[0] === 'F').indexOf(originalReg);
              const newNum = (nextF + (f - 1) * sortedCandidates.filter(r => r[0] === 'F').length * 2 + count * 2) % 32;
              registerMap.set(originalReg, `F${newNum}`);
            }
          });
        }

        let passedUpdate = false;
        loopBody.forEach((l, idx) => {
          if (l === ptrUpdateLine) { passedUpdate = true; return; }
          if (l === counterLine || l.isJump) return; // saltar control
          if (!l.isInstruction) { if (f === 0) result.push(l); return; }   // no-instrucciones una vez

          // Para iteraciones f>0, eliminar la etiqueta de la primera línea
          let lineToProcess = l;
          if (idx === 0 && f > 0 && l.label) {
            lineToProcess = {
              ...l,
              label: undefined,
              tokens: l.tokens.filter(t => t.type !== TokenType.LABEL_DEF),
            };
          }

          // Ajuste de offset de memoria
          let memOffset = isDecrement ? -(f * stride) : (f * stride);
          if (passedUpdate) {
            memOffset += isDecrement ? -stride : stride;
          }

          // Clonar y ajustar la instrucción
          const cloned = this.cloneAndAdjustMemOffset(lineToProcess, memOffset);

          // Renombrar registros si es f > 0
          if (f > 0) {
            this.applyCompactRenaming(cloned, registerMap);
          }

          result.push(cloned);
        });
      }

      // Emitir actualizaciones de control ajustadas por factor
      if (ptrUpdateLine) result.push(this.cloneAndAdjustImm(ptrUpdateLine, actualFactor));
      if (counterLine)   result.push(this.cloneAndAdjustImm(counterLine, actualFactor));
      result.push({ ...jumpLine, isModified: true });

      i = loopEnd;
    }
    return result;
  }

  /**
   * Aplica el mapeo de registros ya calculado a una línea.
   */
  private applyCompactRenaming(line: TokenLine, registerMap: Map<string, string>): void {
    line.tokens = line.tokens.map(t => {
      if (t.type !== TokenType.REGISTER) return t;
      const reg = t.value.toUpperCase();
      if (registerMap.has(reg)) {
        return { ...t, value: registerMap.get(reg)! };
      }
      return t;
    });

    if (line.rd && registerMap.has(line.rd.toUpperCase())) {
      line.rd = registerMap.get(line.rd.toUpperCase())!;
    }
    line.sources = line.sources.map(s =>
      registerMap.has(s.toUpperCase()) ? registerMap.get(s.toUpperCase())! : s
    );
  }

  /** Ajusta el offset inmediato de una instrucción de memoria (el INT antes del PAREN_L). */
  private cloneAndAdjustMemOffset(line: TokenLine, offsetDelta: number): TokenLine {
    const newTokens = line.tokens.map((t, idx) => {
      const next = line.tokens[idx + 1];
      if (t.type === TokenType.INT && next?.type === TokenType.PAREN_L) {
        const base = parseInt(t.value.replace('#', '')) || 0;
        const newVal = base + offsetDelta;
        return { ...t, value: `${newVal}` };
      }
      return { ...t };
    });
    const newLine = this.analyzeLine(newTokens, '');
    if (offsetDelta !== 0) newLine.isModified = true;
    return newLine;
  }

  private cloneAndAdjustImm(line: TokenLine, factor: number): TokenLine {
    const newTokens = line.tokens.map(t => {
      if (t.type === TokenType.INT) {
        const val = parseInt(t.value.replace('#', ''));
        return { ...t, value: `#${val * factor}` };
      }
      return { ...t };
    });
    const newLine = this.analyzeLine(newTokens, '');
    newLine.isModified = true;
    return newLine;
  }

  /**
   * Static register renaming — eliminates WAR (anti) hazards within each basic block.
   *
   * For each instruction that writes register D, if any earlier instruction in the
   * same block reads D (creating a WAR ordering constraint that limits scheduling),
   * D is renamed to a free architectural register.  All uses of D in the renamed
   * def's live range are updated accordingly.  Only registers not mentioned anywhere
   * in the block are used as rename targets, so the transformation is always safe.
   */
  private applyRegisterRenaming(lines: TokenLine[]): TokenLine[] {
    const result: TokenLine[] = [];
    let currentBlock: TokenLine[] = [];

    const flushBlock = () => {
      if (currentBlock.length > 0) {
        result.push(...this.renameRegistersInBlock(currentBlock));
        currentBlock = [];
      }
    };

    for (const line of lines) {
      if (line.isJump) {
        flushBlock();
        result.push(line);
      } else if (!line.isInstruction) {
        if (currentBlock.some(l => l.isInstruction)) currentBlock.push(line);
        else result.push(line);
      } else {
        if (line.label && currentBlock.some(l => l.isInstruction)) flushBlock();
        currentBlock.push(line);
      }
    }
    flushBlock();

    return result;
  }

  private renameRegistersInBlock(block: TokenLine[]): TokenLine[] {
    // Shallow-clone every line so originals are unmodified
    const work: TokenLine[] = block.map(l => ({
      ...l,
      tokens:  l.tokens.map(t => ({ ...t })),
      sources: [...l.sources],
    }));

    // Indices of instruction lines inside work[]
    const instrIdx = work.reduce<number[]>((acc, l, i) => {
      if (l.isInstruction) acc.push(i);
      return acc;
    }, []);

    if (instrIdx.length < 2) return block;

    // Collect every register name mentioned in the block
    const usedRegs = new Set<string>();
    for (const l of work) {
      if (l.rd) usedRegs.add(l.rd.toUpperCase());
      for (const s of l.sources) usedRegs.add(s.toUpperCase());
    }

    // Free architectural registers (not mentioned in the block)
    const freeInt   = this.buildFreeRegPool('R', 1, 32, usedRegs, false);
    const freeFloat = this.buildFreeRegPool('F', 0, 32, usedRegs, true); // Paridad para F
    const freeVec   = this.buildFreeRegPool('V', 0, 8, usedRegs, false); // Límite 8 para V

    for (let ii = 0; ii < instrIdx.length; ii++) {
      const I = work[instrIdx[ii]];
      if (!I.rd) continue;

      const D = I.rd.toUpperCase();
      if (D === 'R0') continue; // R0 is hardwired to zero

      // Find the previous definition of D in this block (index in instrIdx)
      let prevDefIi = -1;
      for (let k = ii - 1; k >= 0; k--) {
        if (work[instrIdx[k]].rd?.toUpperCase() === D) { prevDefIi = k; break; }
      }

      // WAR exists if any instruction between [prevDef+1, ii) reads D as a source
      let warExists = false;
      for (let k = prevDefIi + 1; k < ii; k++) {
        if (work[instrIdx[k]].sources.some(s => s.toUpperCase() === D)) { warExists = true; break; }
      }
      if (!warExists) continue;

      // Select a free register from the same file
      const pool = D.startsWith('F') ? freeFloat : D.startsWith('V') ? freeVec : freeInt;
      if (pool.length === 0) continue;

      const newReg = pool.shift()!;
      usedRegs.add(newReg);

      // Rename I's destination token and field
      this.replaceDestReg(I, D, newReg);

      // Find the next definition of D after ii (live-range boundary)
      let nextDefIi = instrIdx.length;
      for (let k = ii + 1; k < instrIdx.length; k++) {
        if (work[instrIdx[k]].rd?.toUpperCase() === D) { nextDefIi = k; break; }
      }

      // Propagate: update source references D → newReg through the live range
      for (let k = ii + 1; k <= nextDefIi && k < instrIdx.length; k++) {
        const J = work[instrIdx[k]];
        const jWritesD = J.rd?.toUpperCase() === D;
        if (J.sources.some(s => s.toUpperCase() === D)) {
          this.replaceSourceReg(J, D, newReg, jWritesD);
        }
        if (jWritesD) break;
      }
    }

    return work;
  }

  /** Architectural register names in [prefix+from, prefix+to) that are not in usedRegs. */
  private buildFreeRegPool(prefix: string, from: number, to: number, used: Set<string>, forceEven: boolean): string[] {
    const pool: string[] = [];
    for (let i = from; i < to; i++) {
      if (forceEven && i % 2 !== 0) continue;
      const r = `${prefix}${i}`;
      if (!used.has(r)) pool.push(r);
    }
    return pool;
  }

  /** Replace the FIRST register token matching oldReg with newReg (destination slot). */
  private replaceDestReg(line: TokenLine, oldReg: string, newReg: string): void {
    const old = oldReg.toUpperCase();
    let done = false;
    line.tokens = line.tokens.map(t => {
      if (done || t.type !== TokenType.REGISTER || t.value.toUpperCase() !== old) return t;
      done = true;
      return { ...t, value: newReg };
    });
    if (done) { line.rd = newReg; line.isModified = true; }
  }

  /**
   * Replace register tokens matching oldReg in source positions with newReg.
   * When skipFirstDest is true the instruction's own destination token (the
   * first REGISTER token) is skipped so only true source occurrences are renamed.
   */
  private replaceSourceReg(line: TokenLine, oldReg: string, newReg: string, skipFirstDest: boolean): void {
    const old = oldReg.toUpperCase();
    let skipped = false;
    let changed = false;
    line.tokens = line.tokens.map(t => {
      if (t.type !== TokenType.REGISTER || t.value.toUpperCase() !== old) return t;
      if (skipFirstDest && !skipped) { skipped = true; return t; }
      changed = true;
      return { ...t, value: newReg };
    });
    if (changed) {
      line.sources = line.sources.map(s => s.toUpperCase() === old ? newReg : s);
      line.isModified = true;
    }
  }

  private applyDelayedBranchFilling(lines: TokenLine[]): TokenLine[] {
    const result: TokenLine[] = [...lines];
    // Buscamos candidatos hasta 4 instrucciones atrás
    const LOOK_BACK = 4;

    for (let i = 0; i < result.length; i++) {
      if (!result[i].isJump) continue;

      const branch = result[i];
      // Si el salto ya tiene algo en su delay slot (ej: tras un movimiento previo), no lo tocamos
      if (result[i + 1]?.isInserted) continue;

      let filled = false;

      // Buscamos un candidato hacia atrás
      for (let j = 1; j <= LOOK_BACK; j++) {
        const candIdx = i - j;
        if (candIdx < 0) break;

        const cand = result[candIdx];
        if (!cand.isInstruction || cand.isJump || cand.label) continue;

        // --- COMPROBACIÓN DE SEGURIDAD TOTAL ---
        // Para mover cand desde candIdx a i+1 (delay slot), debe ser independiente
        // de todas las instrucciones que "salta", incluyendo el branch.
        let safeToMove = true;
        for (let k = candIdx + 1; k <= i; k++) {
          const mid = result[k];
          // cand no puede depender de mid, ni mid de cand
          if (this.hasDependency(cand, mid) || this.hasDependency(mid, cand)) {
            safeToMove = false;
            break;
          }
        }

        if (safeToMove) {
          // Realizar el movimiento: extraer cand y ponerlo tras el branch
          const extracted = result.splice(candIdx, 1)[0];
          // Al quitar una línea, el índice del branch ha bajado 1
          const newBranchIdx = i - 1;
          result.splice(newBranchIdx + 1, 0, { ...extracted, isInserted: true, isModified: true });

          filled = true;
          i++; // Saltamos el delay slot recién rellenado
          break;
        }
      }

      if (!filled) {
        // No se encontró candidato: insertar NOP explícito en el delay slot
        const nop: TokenLine = {
          tokens: [{ type: TokenType.INSTRUCTION, value: 'NOP', line: 0, column: 0 }],
          originalText: '      NOP',
          isInstruction: true,
          opcode: 'NOP',
          sources: [],
          isInserted: true
        };
        result.splice(i + 1, 0, nop);
        i++; // skip delay slot
      }
    }

    return result;
  }

  private reconstructLineText(l: TokenLine): string {
    let text = l.label ? `${l.label}: ` : '      ';
    const instrTokens = l.label ? l.tokens.slice(1) : l.tokens;
    text += instrTokens.map((t, idx) => {
      const next = instrTokens[idx + 1];
      if (next && (next.type === TokenType.COMMA || next.type === TokenType.PAREN_R)) return t.value;
      if (next && next.type === TokenType.PAREN_L) return t.value;
      if (t.type === TokenType.PAREN_L || t.type === TokenType.PAREN_R) return t.value;
      if (t.type === TokenType.COMMA) return t.value + ' ';
      return t.value + ' ';
    }).join('').trim();
    return text;
  }

  private reconstructAnnotated(lines: TokenLine[]): OptimizeResult {
    const annotatedLines: AnnotatedLine[] = lines.map(l => {
      const text = l.tokens.length === 0
        ? l.originalText
        : (l.isModified || l.originalText === '' ? this.reconstructLineText(l) : l.originalText);

      const status: LineStatus = l.isInserted ? 'new' : l.isModified ? 'reordered' : 'unchanged';
      return { text, status };
    });

    return {
      code: annotatedLines.map(l => l.text).join('\n'),
      lines: annotatedLines,
      reorderedCount: annotatedLines.filter(l => l.status === 'reordered').length,
      insertedCount:  annotatedLines.filter(l => l.status === 'new').length,
    };
  }
}
