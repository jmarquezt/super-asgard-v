/**
 * Extensión del ARF (Architectural Register File) para renombramiento
 * Basado en el modelo de la Figura 2.40 del libro de la asignatura
 *
 * NOTA: El ARF real de los procesadores esta en la clase RegisterFile.
 * Esta clase solo gestiona los campos adicionales de renombramiento: Ocupado | Índice, siguiendo el modelo de extension del buffer de reordenamiento
 *
 * Estructura completa del RRF según Figura 2.40:
 * - Datos: Valor committed (gestionado por el propio ROB)
 * - Ocupado: Si hay un renombramiento activo (gestionado aquí)
 * - Índice: Apunta al ROB donde está el valor pendiente (gestionado aquí)
 */

import { RegisterType } from '../asg.models';
import { ROBTag, robTagEquals } from './rob';

/**
 * Estado de renombramiento de un registro en el ARF
 */
export interface ARFRenameState {
  /** Ocupado - Indica si hay un renombramiento activo (instrucción pendiente que escribirá) */
  ocupado: boolean;
  /** Índice - Apunta al ROB donde está el valor pendiente (null si no ocupado) */
  indice: ROBTag | null;
}

/**
 * Resultado de consulta de renombramiento
 */
export type RRFLookupResult =
  | { ocupado: false }
  | { ocupado: true; robTag: ROBTag };

/**
 * Gestiona el estado de renombramiento del ARF (campos Ocupado e Índice)
 * Los valores (campo Datos) se gestionan en el propio ROB y en RegisterFile
 */
export class RRF {
  /** Estado de renombramiento para registros enteros R0-R31 */
  private intRegs: ARFRenameState[];
  /** Estado de renombramiento para registros flotantes F0-F31 */
  private floatRegs: ARFRenameState[];
  /** Estado de renombramiento para registros vectoriales V0-V7 */
  private vectorRegs: ARFRenameState[];
  /** Estado de renombramiento para bit de condición FP (FPBC) */
  private fpbcRegs: ARFRenameState[];
  /** Estado de renombramiento para Vector Length Register (VLR) */
  private vlrRegs: ARFRenameState[];
  /** Estado de renombramiento para Vector Mask (VM) - nota: VM es un vector, pero aquí manejamos su "generación" como un solo estado */
  private vmRegs: ARFRenameState[];

  constructor() {
    this.intRegs = this.createBank(32);
    this.floatRegs = this.createBank(32);
    this.vectorRegs = this.createBank(8);
    this.fpbcRegs = this.createBank(1);
    this.vlrRegs = this.createBank(1);
    this.vmRegs = this.createBank(1);
  }

  private createBank(size: number): ARFRenameState[] {
    return Array(size).fill(null).map(() => ({
      ocupado: false,
      indice: null
    }));
  }

  /**
   * Resetea el estado de renombramiento (todos los registros disponibles)
   */
  reset(): void {
    this.intRegs = this.createBank(32);
    this.floatRegs = this.createBank(32);
    this.vectorRegs = this.createBank(8);
    this.fpbcRegs = this.createBank(1);
    this.vlrRegs = this.createBank(1);
    this.vmRegs = this.createBank(1);
  }

  /**
   * Obtiene el banco según el tipo
   */
  private getBank(type: RegisterType): ARFRenameState[] {
    switch (type) {
      case 'R': return this.intRegs;
      case 'F': return this.floatRegs;
      case 'V': return this.vectorRegs;
      case 'FPBC': return this.fpbcRegs;
      case 'VLR': return this.vlrRegs;
      case 'VM': return this.vmRegs;
    }
  }

  /**
   * Consulta si un registro tiene renombramiento activo
   * @returns { ocupado: false } si el valor está en el registro arquitectónico
   * @returns { ocupado: true, robTag } si hay que leer del ROB
   */
  lookup(type: RegisterType, regNum: number): RRFLookupResult {
    // R0 siempre es 0, nunca tiene renombramiento
    if (type === 'R' && regNum === 0)
      return { ocupado: false };

    // VLR y VM siempre usan regNum=0 (son registros únicos)
    if ((type === 'VLR' || type === 'VM') && regNum !== 0)
      regNum = 0;

    const bank = this.getBank(type);
    if (regNum < 0 || regNum >= bank.length)
      return { ocupado: false };

    const entry = bank[regNum];
    if (entry.ocupado && entry.indice !== null)
      return { ocupado: true, robTag: entry.indice };

    return { ocupado: false };
  }

  /**
   * Renombra un registro: marca Ocupado=1 e Índice=robTag
   * Se llama en ID cuando una instrucción va a escribir en un registro
   */
  rename(type: RegisterType, regNum: number, robTag: ROBTag): void {
    // R0 nunca se renombra
    if (type === 'R' && regNum === 0) return;

    // VLR y VM siempre usan regNum=0
    if ((type === 'VLR' || type === 'VM') && regNum !== 0)
      regNum = 0;

    const bank = this.getBank(type);
    if (regNum < 0 || regNum >= bank.length) return;

    bank[regNum].ocupado = true;
    bank[regNum].indice = robTag;
  }

  /**
   * Limpia el renombramiento de un registro en commit
   * Solo limpia si el Índice coincide (evita limpiar renombramientos más recientes)
   */
  clearRename(type: RegisterType, regNum: number, robTag: ROBTag): void {
    // R0 nunca tiene renombramiento
    if (type === 'R' && regNum === 0) return;

    // VLR y VM siempre usan regNum=0
    if ((type === 'VLR' || type === 'VM') && regNum !== 0)
      regNum = 0;

    const bank = this.getBank(type);
    if (regNum < 0 || regNum >= bank.length) return;

    const entry = bank[regNum];
    if (robTagEquals(entry.indice, robTag)) {
      entry.ocupado = false;
      entry.indice = null;
    }
  }

  /**
   * Flush especulativo: limpia renombramientos con robTag >= fromTag
   * Usa comparación circular del ROB para determinar qué entradas limpiar
   */
  flushFrom(fromTag: number, robHead: number, robSize: number): void {
    const posFrom = (fromTag - robHead + robSize) % robSize;

    const banks = [this.intRegs, this.floatRegs, this.vectorRegs, this.fpbcRegs, this.vlrRegs, this.vmRegs];

    for (const bank of banks) {
      for (const entry of bank) {
        if (entry.ocupado && entry.indice !== null) {
          const posEntry = (entry.indice.slot - robHead + robSize) % robSize;
          if (posEntry >= posFrom) {
            entry.ocupado = false;
            entry.indice = null;
          }
        }
      }
    }
  }

  /**
   * Crea un snapshot del estado de renombramiento
   */
  snapshot(): { int: ARFRenameState[]; float: ARFRenameState[]; vector: ARFRenameState[]; fpbc: ARFRenameState[]; vlr: ARFRenameState[]; vm: ARFRenameState[] } {
    return {
      int: this.intRegs.map(e => ({ ...e })),
      float: this.floatRegs.map(e => ({ ...e })),
      vector: this.vectorRegs.map(e => ({ ...e })),
      fpbc: this.fpbcRegs.map(e => ({ ...e })),
      vlr: this.vlrRegs.map(e => ({ ...e })),
      vm: this.vmRegs.map(e => ({ ...e }))
    };
  }

  /**
   * Restaura desde un snapshot
   */
  restore(snap: { int: ARFRenameState[]; float: ARFRenameState[]; vector: ARFRenameState[]; fpbc: ARFRenameState[]; vlr: ARFRenameState[]; vm: ARFRenameState[] }): void {
    for (let i = 0; i < this.intRegs.length && i < snap.int.length; i++) {
      this.intRegs[i] = { ...snap.int[i] };
    }
    for (let i = 0; i < this.floatRegs.length && i < snap.float.length; i++) {
      this.floatRegs[i] = { ...snap.float[i] };
    }
    for (let i = 0; i < this.vectorRegs.length && i < snap.vector.length; i++) {
      this.vectorRegs[i] = { ...snap.vector[i] };
    }
    for (let i = 0; i < this.fpbcRegs.length && i < snap.fpbc.length; i++) {
      this.fpbcRegs[i] = { ...snap.fpbc[i] };
    }
    for (let i = 0; i < this.vlrRegs.length && i < snap.vlr.length; i++) {
      this.vlrRegs[i] = { ...snap.vlr[i] };
    }
    for (let i = 0; i < this.vmRegs.length && i < snap.vm.length; i++) {
      this.vmRegs[i] = { ...snap.vm[i] };
    }
  }

  /**
   * Obtiene el estado de renombramiento (para visualización)
   */
  getState(): { intRegs: ARFRenameState[]; floatRegs: ARFRenameState[]; vectorRegs: ARFRenameState[]; fpbcRegs: ARFRenameState[]; vlrRegs: ARFRenameState[]; vmRegs: ARFRenameState[]; } {
    return {
      intRegs: this.intRegs,
      floatRegs: this.floatRegs,
      vectorRegs: this.vectorRegs,
      fpbcRegs: this.fpbcRegs,
      vlrRegs: this.vlrRegs,
      vmRegs: this.vmRegs
    };
  }

  /**
   * Cuenta registros con renombramiento activo
   */
  countRenamed(): { int: number; float: number; vector: number; fpbc: number; vlr: number; vm: number } {
    return {
      int: this.intRegs.filter(e => e.ocupado).length,
      float: this.floatRegs.filter(e => e.ocupado).length,
      vector: this.vectorRegs.filter(e => e.ocupado).length,
      fpbc: this.fpbcRegs.filter(e => e.ocupado).length,
      vlr: this.vlrRegs.filter(e => e.ocupado).length,
      vm: this.vmRegs.filter(e => e.ocupado).length
    };
  }
}
