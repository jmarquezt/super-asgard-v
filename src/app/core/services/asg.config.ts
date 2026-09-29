import {Injectable, signal} from '@angular/core';
import {
  LogLevel,
  ProcessorType,
  SuperscalarConfig,
  DEFAULT_SUPERSCALAR_CONFIG,
  RSType,
  IssueWidth,
  AsgConfig, DEFAULT_LATENCIES
} from '../models/asg.config';

@Injectable({
  providedIn: 'root'
})
export class AsgConfigService {
  private readonly STORAGE_KEY = 'asg_config';

  // Valores por defecto
  private readonly DEFAULT_CONFIG: AsgConfig = {
    processorType: 'pipelined',
    memorySize: 4096,
    enableForwarding: true,
    enableVectorChaining: true,
    enableBranchDelaySlot: false,
    aluLanes: 4,
    memLanes: 4,
    mvl: 64,
    branchPredictionStrategy: 'none',
    ghrBits: 2,
    loggingEnabled: true,
    logLevel: 'relevant',
    timelineMode: 'live',
    latencies: { ...DEFAULT_LATENCIES },
    superscalar: { ...DEFAULT_SUPERSCALAR_CONFIG },
  };

  // Definimos la Signal privada con el valor inicial
  private _config = signal<AsgConfig>(this.loadFromStorage());

  constructor() {}

  // Méto do para actualizar la configuración, llamado en el callback de la interfaz
  updateConfig(newConfig: Partial<AsgConfig>) {
    this._config.update(current => {
      const updated = { ...current, ...newConfig };
      this.saveToStorage(updated);
      return updated;
    });
  }

  /**
   * Carga la configuración desde LocalStorage o devuelve la de por defecto
   */
  private loadFromStorage(): AsgConfig {
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (!saved) return this.DEFAULT_CONFIG;

    try {
      const parsed = JSON.parse(saved);

      return {
        ...this.DEFAULT_CONFIG,
        ...parsed,
        // Merge profundo para que campos nuevos de latencias tengan su default
        latencies: { ...DEFAULT_LATENCIES, ...(parsed.latencies ?? {}) },
        // Merge profundo para configuración superescalar
        superscalar: {
          ...DEFAULT_SUPERSCALAR_CONFIG,
          ...(parsed.superscalar ?? {}),
          // Merge profundo para rsClusterSizes
          rsClusterSizes: {
            ...DEFAULT_SUPERSCALAR_CONFIG.rsClusterSizes,
            ...(parsed.superscalar?.rsClusterSizes ?? {})
          }
        },
      };
    } catch (e) {
      console.error('Error cargando configuración, usando valores por defecto', e);
      return this.DEFAULT_CONFIG;
    }
  }

  private saveToStorage(config: AsgConfig) {
    localStorage.setItem('asg_config', JSON.stringify(config));
  }

  /**
   * Devuelve el valor actual de la configuración (sincrónico)
   */
  getCurrentConfig(): AsgConfig {
    // versión de solo lectura para los componentes/servicios
    return this._config();
  }

}
