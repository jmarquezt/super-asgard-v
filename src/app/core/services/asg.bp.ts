import {BranchPredictionStrategy} from '../models/asg.config';

export interface PredictResult {
  taken: boolean;
  target: number;
  ghrSnapshot: number;
  /** Solo híbrido: predicción del componente local en el momento de IF */
  localTaken: boolean;
  /** Solo híbrido: predicción del componente global (gshare) en el momento de IF */
  globalTaken: boolean;
}

/**
 * Servicio de prediccion de saltos para los procesadores. Implementa varias estrategias configurables en interfaz
 */
export class AsgBranchPredictorService {
  // BTB: PC → dirección destino del salto
  private btb = new Map<number, number>();

  // BHT local: PC → contador saturante 2 bits (predictor local, igual que 2-bit Smith)
  private bht = new Map<number, number>();

  // BHT global: (PC ^ GHR) → contador saturante 2 bits (componente GShare del híbrido)
  private globalBht = new Map<number, number>();

  /**
   * Tabla selectora del predictor híbrido (tournament).
   * PC → contador saturante 2 bits.
   *   0–1 → usar predictor LOCAL
   *   2–3 → usar predictor GLOBAL
   * Valor por defecto: 1 (ligeramente hacia local, sin sesgo claro).
   */
  private selectorTable = new Map<number, number>();

  // Global History Register
  private ghr = 0;
  private ghrBits = 2;

  /**
   * Return Address Stack — pila circular de tamaño RAS_SIZE.
   * Push en JAL/JALR (call), pop en JR (return).
   */
  private readonly RAS_SIZE = 8;
  private rasStack: number[] = [];

  constructor(public strategy: BranchPredictionStrategy = 'none') {}

  setStrategy(strategy: BranchPredictionStrategy, bits: number) {
    this.strategy = strategy;
    this.ghrBits = bits;
    this.reset();
  }

  /** Se llama en IF: actualiza el GHR asumiendo que la predicción es correcta. */
  updateGHRSpeculative(taken: boolean): void {
    if (this.strategy === 'gshare' || this.strategy === 'hybrid')
      this.ghr = ((this.ghr << 1) | (taken ? 1 : 0)) & this.ghrMask;
  }

  /**
   * Se llama en EX si hubo fallo: restaura el GHR al estado correcto
   * usando el snapshot tomado en IF, deshaciendo todas las actualizaciones
   * especulativas apiladas desde entonces.
   */
  rollbackGHR(ghrSnapshot: number, actuallyTaken: boolean): void {
    if (this.strategy === 'gshare' || this.strategy === 'hybrid')
      this.ghr = ((ghrSnapshot << 1) | (actuallyTaken ? 1 : 0)) & this.ghrMask;
  }

  /**
   * Predice si un branch será tomado y su target.
   * @param pc     Dirección del branch
   * @param opcode Codigo de la instrucción (requerido para RAS: JAL/JALR/JR)
   */
  predict(pc: number, opcode?: string): PredictResult {
    // Capturamos el GHR ANTES de cualquier actualización especulativa
    const ghrSnapshot = this.ghr;

    // Usar BTB si tiene entrada, sino fallback a pc+4
    const target = this.btb.get(pc) ?? (pc + 4);

    let taken = false;
    let localTaken = false;
    let globalTaken = false;

    switch (this.strategy) {
      case 'none':
        break;

      case 'always-taken':
        taken = true;
        break;

      case 'btfn':
        // Backward Taken, Forward Not-taken
        // Si el destino del salto es menor que PC (salto hacia atrás), predecir tomado
        // Esto es útil para loops donde el salto hacia atrás suele tomarse
        taken = target < pc;
        break;

      case '1-bit': {
        const state = this.bht.get(pc) ?? 0;
        taken = state === 1;
        break;
      }

      case '2-bit': {
        const state = this.bht.get(pc) ?? 0;
        taken = state >= 2;
        break;
      }

      case 'gshare': {
        const state = this.bht.get(this.gshareIndex(pc, ghrSnapshot)) ?? 0;
        taken = state >= 2;
        break;
      }

      case 'hybrid': {
        // Componente local (2-bit Smith indexado por PC)
        const localState = this.bht.get(pc) ?? 0;
        localTaken = localState >= 2;

        // Componente global (GShare: 2-bit indexado por PC ^ GHR)
        const globalState = this.globalBht.get(this.gshareIndex(pc, ghrSnapshot)) ?? 0;
        globalTaken = globalState >= 2;

        // Selector: 0-1 → confiar en local; 2-3 → confiar en global
        const sel = this.selectorTable.get(pc) ?? 1;
        taken = sel >= 2 ? globalTaken : localTaken;
        break;
      }

      case 'ras': {
        const op = (opcode ?? '').toUpperCase();

        if (op === 'JAL' || op === 'JALR') {
          // Call: push return address and predict taken (target from BTB or first-time PC+8)
          const retAddr = pc + 4;
          if (this.rasStack.length >= this.RAS_SIZE) this.rasStack.shift();
          this.rasStack.push(retAddr);
          taken = true;
          // target comes from BTB (learned after first call) or PC+4 fallback
          return { taken, target, ghrSnapshot, localTaken: false, globalTaken: false };
        }

        if (op === 'JR') {
          // Return: pop from RAS and use as predicted target
          if (this.rasStack.length > 0) {
            const rasTarget = this.rasStack.pop()!;
            return { taken: true, target: rasTarget, ghrSnapshot, localTaken: false, globalTaken: false };
          }
          // RAS empty: fall back to BTB
          taken = this.btb.has(pc);
          break;
        }

        // Conditional branches and J: use 2-bit predictor
        const state = this.bht.get(pc) ?? 0;
        taken = state >= 2;
        break;
      }
    }

    return { taken, target, ghrSnapshot, localTaken, globalTaken };
  }

  update(pc: number, actuallyTaken: boolean, actualTarget: number, ghrSnapshot: number = this.ghr, localTaken: boolean = false, globalTaken: boolean = false): void {
    if (this.strategy === 'none') return;

    // El BTB solo aprende el destino cuando el salto se toma realmente
    // (almacenar pc+4 para saltos no-taken corrompe predicciones futuras)
    if (actuallyTaken) {
      this.btb.set(pc, actualTarget);
    }

    switch (this.strategy) {
      case 'always-taken':
      case 'btfn':
        // Predictores estáticos: solo actualizan BTB
        break;

      case '1-bit':
        this.bht.set(pc, actuallyTaken ? 1 : 0);
        break;

      case '2-bit':
        this.bht.set(pc, this.saturate(this.bht.get(pc) ?? 0, actuallyTaken));
        break;

      case 'gshare': {
        const idx = this.gshareIndex(pc, ghrSnapshot);
        this.bht.set(idx, this.saturate(this.bht.get(idx) ?? 0, actuallyTaken));
        break;
      }

      case 'hybrid': {
        // Actualizar BHT local
        this.bht.set(pc, this.saturate(this.bht.get(pc) ?? 0, actuallyTaken));

        // Actualizar BHT global
        const idx = this.gshareIndex(pc, ghrSnapshot);
        this.globalBht.set(idx, this.saturate(this.globalBht.get(idx) ?? 0, actuallyTaken));

        // Actualizar selector: solo cambia cuando los dos predictores discrepan
        const localCorrect  = localTaken  === actuallyTaken;
        const globalCorrect = globalTaken === actuallyTaken;
        if (globalCorrect !== localCorrect) {
          const sel = this.selectorTable.get(pc) ?? 1;
          // Si global acertó y local falló → incrementar (hacia global, 2-3)
          // Si local acertó y global falló → decrementar (hacia local, 0-1)
          this.selectorTable.set(pc, this.saturate(sel, globalCorrect));
        }
        break;
      }

      case 'ras':
        // Calls (JAL/JALR) and returns (JR) are handled speculatively in predict().
        // Update the BHT for conditional branches so they benefit from learning.
        this.bht.set(pc, this.saturate(this.bht.get(pc) ?? 0, actuallyTaken));
        break;
    }
  }

  /** Índice XOR para GShare: PC ^ (GHR & máscara). */
  private gshareIndex(pc: number, ghr: number): number {
    return pc ^ (ghr & this.ghrMask);
  }

  /** Contador saturante de 2 bits (0–3). */
  private saturate(state: number, increment: boolean): number {
    if (increment) return state < 3 ? state + 1 : 3;
    return state > 0 ? state - 1 : 0;
  }

  private get ghrMask(): number {
    return (1 << this.ghrBits) - 1;
  }

  reset(): void {
    this.btb.clear();
    this.bht.clear();
    this.globalBht.clear();
    this.selectorTable.clear();
    this.ghr = 0;
    this.rasStack = [];
  }

  public getBHT()          { return this.bht; }
  public getGlobalBHT()    { return this.globalBht; }
  public getSelectorTable(){ return this.selectorTable; }
  public getBTB()          { return this.btb; }
  public getGHR()          { return this.ghr; }
  public getRAS()          { return [...this.rasStack]; }
}
