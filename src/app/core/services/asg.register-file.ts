/**
 * Banco de registros unificado para todos los procesadores ASG
 *
 * Contiene:
 * - Registros enteros, flotantes y vectoriales (signals)
 * - Propiedades auxiliares (tipos de float, último modificado, etc.)
 * - Funcionalidad RRF opcional para renombramiento (superescalar)
 * - Métodos de acceso y manipulación
 *
 * Esta clase unifica el estado de registros que antes estaba acoplado en cada clase procesador
 */

import { signal, WritableSignal } from '@angular/core';
import { RegisterType } from '../models/asg.models';
import { RRF } from '../models/superscalar/rrf';
import { ROBTag } from '../models/superscalar/rob';


export class RegisterAlignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegisterAlignmentError';
  }
}

/**
 * Configuración para inicializar el banco de registros
 */
export interface RegisterFileConfig {
  /** Longitud máxima de vectores (MVL) */
  mvl: number;
  /** Habilitar funcionalidad RRF para renombramiento (solo superescalar) */
  enableRRF?: boolean;
}

/**
 * Información del último registro modificado
 */
export interface LastModifiedRegister {
  type: 'R' | 'F' | 'D' | 'V';
  index: number;
}

/**
 * Estado de tracking de registro vectorial para chaining
 */
export interface VectorRegisterStatus {
  /** ID de la instrucción que está escribiendo este registro */
  instrId: number;
  /** Último elemento del vector que está listo */
  lastElementReady: number;
}

/**
 * Banco de registros unificado
 */
export class AsgRegisterFileService {
  /** Registros enteros R0-R31 (32 bits cada uno) */
  public readonly registers: WritableSignal<Int32Array>;

  /** Registros flotantes F0-F31 (32 bits cada uno, pero pueden almacenar doubles en pares) */
  public readonly floatRegisters: WritableSignal<Float32Array>;

  /** Bit de condición FPU (para BFPT/BFPF) */
  public readonly fpConditionBit: WritableSignal<number>;

  /** Banco de registros vectoriales V0-V7 (cada uno con MVL elementos de 64 bits) */
  public readonly vectorRegisters: WritableSignal<Float64Array[]>;

  /** Máscara para conocer qué registro float es single ('S') o double ('D') precision */
  public readonly floatRegisterTypes: WritableSignal<('S' | 'D')[]>;

  /** Último registro modificado (para resaltar en la UI) */
  public readonly lastModifiedReg: WritableSignal<LastModifiedRegister | null>;

  /** Vector Length (VL): cuántos elementos procesar (máximo MVL) */
  public readonly vl: WritableSignal<number>;

  /** Máscara vectorial: 1 = procesar, 0 = saltar */
  public readonly vectorMask: WritableSignal<Float64Array>;

  /**
   * Tracking de elementos disponibles para cada registro vectorial (para chaining)
   * Mapa: número de registro → estado de tracking
   */
  private readonly vRegisterStatus: Map<number, VectorRegisterStatus>;

  /** RRF para renombramiento de registros (solo si enableRRF=true) */
  private readonly rrf?: RRF;

  private readonly mvl: number;

  constructor(config: RegisterFileConfig) {
    this.mvl = config.mvl;

    // Inicializar registros
    this.registers = signal(new Int32Array(32));
    this.floatRegisters = signal(new Float32Array(32));
    this.fpConditionBit = signal(0);
    this.vectorRegisters = signal(
      Array.from({ length: 8 }, () => new Float64Array(config.mvl))
    );

    // Inicializar propiedades auxiliares
    this.floatRegisterTypes = signal(new Array(32).fill('S') as ('S' | 'D')[]);
    this.lastModifiedReg = signal(null);
    this.vl = signal(config.mvl);
    this.vectorMask = signal(new Float64Array(config.mvl).fill(1));

    // Inicializar tracking de chaining vectorial
    this.vRegisterStatus = new Map();

    // Inicializar RRF si está habilitado
    if (config.enableRRF) {
      this.rrf = new RRF();
    }
  }

  /**
   * Resetea todos los registros a su estado inicial
   */
  reset(): void {
    // Resetear registros enteros
    this.registers.set(new Int32Array(32));

    // Resetear registros flotantes
    this.floatRegisters.set(new Float32Array(32));
    this.floatRegisterTypes.set(new Array(32).fill('S') as ('S' | 'D')[]);
    this.fpConditionBit.set(0);

    // Resetear registros vectoriales
    this.vectorRegisters.set(
      Array.from({ length: 8 }, () => new Float64Array(this.mvl))
    );
    this.vl.set(this.mvl);
    this.vectorMask.set(new Float64Array(this.mvl).fill(1));

    // Resetear último modificado
    this.lastModifiedReg.set(null);

    // Resetear tracking de chaining
    this.vRegisterStatus.clear();

    // Resetear RRF si existe
    if (this.rrf) {
      this.rrf.reset();
    }
  }

  /**
   * Lee un registro entero
   * R0 siempre devuelve 0
   */
  readIntRegister(index: number): number {
    if (index === 0) return 0;
    if (index < 0 || index >= 32) return 0;
    return this.registers()[index];
  }

  /**
   * Escribe en un registro entero
   * R0 no se puede modificar
   */
  writeIntRegister(index: number, value: number): void {
    if (index === 0) return; // R0 es inmutable
    if (index < 0 || index >= 32) return;

    this.registers.update(r => { const n = new Int32Array(r); n[index] = value; return n; });
    this.lastModifiedReg.set({ type: 'R', index });
  }

  // Leer un registro flotante (S o D)
  getFloatRegister(index: number, isDouble: boolean): number {
    const buffer = this.floatRegisters().buffer;
    const view = new DataView(buffer);

    if (isDouble) {
      // ASG exige que para Doble Precisión el índice sea PAR (F0, F2...)
      if (index % 2 !== 0)
        throw new RegisterAlignmentError(`EXCEPCIÓN: Registro desalineado. F${index} no es par.`);
      // Leemos 8 bytes (64 bits) empezando en la posición del registro
      return view.getFloat64(index * 4, false); // false = Big-Endian
    } else {
      // Simple precisión: 4 bytes
      return view.getFloat32(index * 4, false);
    }
  }

// Escribir en un registro flotante (S o D)
  writeFloatRegister(index: number, value: number, isDouble: boolean) {
    this.floatRegisters.update(regs => {
      const newRegs = new Float32Array(regs.buffer);
      const view = new DataView(newRegs.buffer);

      if (isDouble) {
        if (index % 2 !== 0)
          throw new RegisterAlignmentError(`EXCEPCIÓN: Registro desalineado. F${index} no es par.`);
        view.setFloat64(index * 4, value, false);
      } else {
        view.setFloat32(index * 4, value, false);
      }
      return new Float32Array(view.buffer);
    });
    //actualizo la mascara
    this.floatRegisterTypes.update(types => {
      const newTypes = [...types];
      if (isDouble) {
        newTypes[index] = 'D';     // El par es el inicio del Double
        newTypes[index + 1] = 'D'; // El impar es la "extensión"
      } else {
        newTypes[index] = 'S';     // Single precision
      }
      return newTypes;
    });

    this.lastModifiedReg.set({type: isDouble ? 'D' : 'F', index: index});
  }

  // Helper para actualizar el bit de condición de la FPU (usado por BFPT/BFPF)
  setFPCondition(condition: boolean): number {
    this.fpConditionBit.set(condition ? 1 : 0);
    return condition ? 1 : 0;
  };

  isFloatRegisterDouble(index: number): boolean {
    return this.floatRegisterTypes()[index] === 'D';
  }

  /**
   * Lee un elemento de un registro vectorial
   */
  readVectorElement(regIndex: number, elementIndex: number): number {
    if (regIndex < 0 || regIndex >= 8) return 0;
    if (elementIndex < 0 || elementIndex >= this.mvl) return 0;
    return this.vectorRegisters()[regIndex][elementIndex];
  }

  /**
   * Escribe un elemento en un registro vectorial
   */
  writeVectorElement(regIndex: number, elementIndex: number, value: number): void {
    if (regIndex < 0 || regIndex >= 8) return;
    if (elementIndex < 0 || elementIndex >= this.mvl) return;

    const regs = this.vectorRegisters();
    regs[regIndex][elementIndex] = value;
    this.vectorRegisters.set(regs);
    this.lastModifiedReg.set({ type: 'V', index: regIndex });
  }

  /**
   * Lee un registro vectorial completo
   */
  readVectorRegister(index: number): Float64Array {
    if (index < 0 || index >= 8) return new Float64Array(this.mvl);
    return this.vectorRegisters()[index];
  }

  /**
   * Escribe un registro vectorial completo
   */
  writeVectorRegister(index: number, value: Float64Array): void {
    if (index < 0 || index >= 8) return;

    this.vectorRegisters.update(vRegs => {
      const newRegs = [...vRegs]; // Copia superficial de los arrays
      // Copiamos el resultado final al registro correspondiente
      newRegs[index] = new Float64Array(value);
      return newRegs;
    });

    this.lastModifiedReg.set({type: 'V', index: index});
  }

  setVectorMask(value: number): number {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, value, false);
    const bits = new DataView(buf).getInt32(0, false);
    this.vectorMask.update(vm => {
      const next = new Float64Array(this.mvl);
      // Un float de 32 bits solo puede representar 32 bits, resto a 0
      for (let i = 0; i < this.mvl; i++) { next[i] = i < 32 ? (bits >>> i) & 1 : 0; }
      return next;
    });

    return bits;
  }

  writeVectorMask(value: Float64Array): void {
    this.vectorMask.set(value);
  }

  resetVectorMask(): void {
    this.vectorMask.set(new Float64Array(this.mvl).fill(1));
  }

  isVectorMaskElementActive(index: number): boolean {
    return this.vectorMask()[index] === 1;
  }

  /**
   * Indica si la funcionalidad RRF está habilitada
   */
  hasRRF(): boolean {
    return this.rrf !== undefined;
  }

  /**
   * Obtiene la instancia RRF (solo superescalar)
   * @throws Error si RRF no está habilitado
   */
  getRRF(): RRF {
    if (!this.rrf) {
      throw new Error('RRF no está habilitado en este RegisterFile');
    }
    return this.rrf;
  }

  /**
   * Consulta si un registro tiene renombramiento activo
   * (solo si RRF está habilitado)
   * Para VLR y VM, usar regNum=0
   */
  lookupRename(type: RegisterType, regNum: number) {
    if (!this.rrf) return { ocupado: false };
    return this.rrf.lookup(type, regNum);
  }

  /**
   * Consulta renombramiento de VLR (Vector Length Register)
   */
  lookupVLRRename() {
    if (!this.rrf) return { ocupado: false };
    return this.rrf.lookup('VLR', 0);
  }

  /**
   * Consulta renombramiento de VM (Vector Mask)
   */
  lookupVMRename() {
    if (!this.rrf) return { ocupado: false };
    return this.rrf.lookup('VM', 0);
  }

  /**
   * Renombra un registro: marca Ocupado=1 e Índice=robTag
   * (solo si RRF está habilitado)
   */
  rename(type: RegisterType, regNum: number, robTag: ROBTag): void {
    if (!this.rrf) return;
    this.rrf.rename(type, regNum, robTag);
  }

  /**
   * Limpia el renombramiento de un registro en commit
   * (solo si RRF está habilitado)
   */
  clearRename(type: RegisterType, regNum: number, robTag: ROBTag): void {
    if (!this.rrf) return;
    this.rrf.clearRename(type, regNum, robTag);
  }

  /**
   * Flush especulativo: limpia renombramientos con robTag >= fromTag
   * (solo si RRF está habilitado)
   */
  flushRenamesFrom(fromTag: number, robHead: number, robSize: number): void {
    if (!this.rrf) return;
    this.rrf.flushFrom(fromTag, robHead, robSize);
  }

  /**
   * Crea un snapshot del estado de renombramiento
   * (solo si RRF está habilitado)
   */
  snapshotRRF() {
    if (!this.rrf) return null;
    return this.rrf.snapshot();
  }

  /**
   * Restaura desde un snapshot de RRF
   * (solo si RRF está habilitado)
   */
  restoreRRF(snapshot: ReturnType<RRF['snapshot']>): void {
    if (!this.rrf || !snapshot) return;
    this.rrf.restore(snapshot);
  }

  /**
   * Obtiene el estado de renombramiento (para visualización)
   * (solo si RRF está habilitado)
   */
  getRRFState() {
    if (!this.rrf) return null;
    return this.rrf.getState();
  }

  /**
   * Cuenta registros con renombramiento activo
   * (solo si RRF está habilitado)
   */
  countRenamed() {
    if (!this.rrf) return { int: 0, float: 0, vector: 0, fcc: 0, vlr: 0, vm: 0 };
    return this.rrf.countRenamed();
  }

  /**
   * Renombra VLR (Vector Length Register)
   */
  renameVLR(robTag: ROBTag): void {
    if (!this.rrf) return;
    this.rrf.rename('VLR', 0, robTag);
  }

  /**
   * Renombra VM (Vector Mask)
   */
  renameVM(robTag: ROBTag): void {
    if (!this.rrf) return;
    this.rrf.rename('VM', 0, robTag);
  }

  /**
   * Limpia el renombramiento de VLR en commit
   */
  clearVLRRename(robTag: ROBTag): void {
    if (!this.rrf) return;
    this.rrf.clearRename('VLR', 0, robTag);
  }

  /**
   * Limpia el renombramiento de VM en commit
   */
  clearVMRename(robTag: ROBTag): void {
    if (!this.rrf) return;
    this.rrf.clearRename('VM', 0, robTag);
  }

  /**
   * Obtiene el estado de tracking de un registro vectorial
   */
  getVectorRegisterStatus(regIndex: number): VectorRegisterStatus | undefined {
    return this.vRegisterStatus.get(regIndex);
  }

  /**
   * Establece el estado de tracking de un registro vectorial
   */
  setVectorRegisterStatus(regIndex: number, status: VectorRegisterStatus): void {
    this.vRegisterStatus.set(regIndex, status);
  }

  /**
   * Elimina el estado de tracking de un registro vectorial
   */
  deleteVectorRegisterStatus(regIndex: number): void {
    this.vRegisterStatus.delete(regIndex);
  }

  /**
   * Limpia to do el estado de tracking de registros vectoriales
   */
  clearVectorRegisterStatus(): void {
    this.vRegisterStatus.clear();
  }

  /**
   * Verifica si un registro vectorial tiene tracking activo
   */
  hasVectorRegisterStatus(regIndex: number): boolean {
    return this.vRegisterStatus.has(regIndex);
  }
}
