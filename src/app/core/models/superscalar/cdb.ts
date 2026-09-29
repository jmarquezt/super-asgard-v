/**
 * Common Data Bus (CDB) - Bus de resultados
 * Basado en el modelo del libro propuesto por el libro de la asignatura
 *
 * El CDB permite que las UFs publiquen sus resultados para que:
 * - Las RS actualicen los operandos pendientes
 * - El ROB marque la instrucción como finalizada
 *
 * El ancho del CDB (número de resultados por ciclo) limita el ILP.
 */

import { ROBTag, robTagEquals } from './rob';
import { FunctionalUnitType } from './fu';

/**
 * Resultado transmitido por el CDB
 */
export interface CDBResult {
  /** Tag ROB del productor con generación */
  robTag: ROBTag;
  /** Valor producido */
  value: number;
  /** Valor vectorial (si aplica) */
  vectorValue: Float64Array | null;
  /** Tipo de UF que lo produjo */
  fuType: FunctionalUnitType;
  /** Ciclo en que se publicó */
  cycle: number;
}

export class CDB {
  private readonly width: number;
  private currentCycleResults: CDBResult[];
  private pendingResults: CDBResult[];  // Cola de resultados que no cupieron en el ciclo actual

  constructor(width: number) {
    this.width = width;
    this.currentCycleResults = [];
    this.pendingResults = [];
  }

  /**
   * Resetea el CDB
   */
  reset(): void {
    this.currentCycleResults = [];
    this.pendingResults = [];
  }

  /**
   * Inicia un nuevo ciclo (limpia resultados del ciclo anterior)
   */
  startCycle(): void {
    this.currentCycleResults = [];

    // Mover resultados pendientes al ciclo actual (con límite de ancho)
    while (this.pendingResults.length > 0 && this.currentCycleResults.length < this.width) {
      this.currentCycleResults.push(this.pendingResults.shift()!);
    }
  }

  /**
   * Verifica si el CDB puede aceptar más resultados este ciclo
   */
  canAccept(): boolean {
    return this.currentCycleResults.length < this.width;
  }

  /**
   * Número de slots disponibles este ciclo
   */
  availableSlots(): number {
    return this.width - this.currentCycleResults.length;
  }

  /**
   * Publica un resultado en el CDB
   * @returns true si se publicó, false si se encoló para el siguiente ciclo
   */
  publish(robTag: ROBTag, value: number, vectorValue: Float64Array | null, fuType: FunctionalUnitType, cycle: number): boolean {
    const result: CDBResult = { robTag, value, vectorValue, fuType, cycle };

    if (this.canAccept()) {
      this.currentCycleResults.push(result);
      return true;
    } else {
      // Encolar para siguiente ciclo
      this.pendingResults.push(result);
      return false;
    }
  }

  /**
   * Obtiene todos los resultados publicados este ciclo
   */
  getResults(): CDBResult[] {
    return [...this.currentCycleResults];
  }

  /**
   * Verifica si hay un resultado para un tag específico
   */
  hasResult(robTag: ROBTag): CDBResult | null {
    return this.currentCycleResults.find(r => robTagEquals(r.robTag, robTag)) ?? null;
  }

  /**
   * Cuenta resultados pendientes (para estadísticas de contención)
   */
  getPendingCount(): number {
    return this.pendingResults.length;
  }

  /**
   * Obtiene el ancho del CDB
   */
  getWidth(): number {
    return this.width;
  }

  /**
   * Calcula utilización del CDB este ciclo
   */
  getUtilization(): number {
    return this.currentCycleResults.length / this.width;
  }

  /**
   * Estadísticas del CDB (para visualización)
   */
  getStats(): { used: number; width: number; pending: number } {
    return {
      used: this.currentCycleResults.length,
      width: this.width,
      pending: this.pendingResults.length
    };
  }

  /**
   * Obtiene los robTags de resultados pendientes (antes de startCycle)
   * Usado para procesar resultados que serán promovidos
   */
  getPendingTags(): ROBTag[] {
    return this.pendingResults.slice(0, Math.min(this.pendingResults.length, this.width)).map(r => r.robTag);
  }
}
