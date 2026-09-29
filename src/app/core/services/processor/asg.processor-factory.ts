/**
 * Factory para instanciar el procesador correcto según la configuración
 *
 * Permite intercambiar entre el procesador segmentado, el monociclo y el superescalar sin modificar los componentes que consumen el procesador.
 */

import { Injectable, inject } from '@angular/core';
import { ProcessorType } from '../../models/asg.config';
import { AsgConfigService } from '../asg.config';
import { AsgSuperscalarProcessorService } from './asg.superscalar.processor';
import { AsgNonPipelinedProcessorService } from './asg.non-pipelined.processor';
import { AsgPipelinedProcessorService } from './asg.pipelined.processor';
import { AsgProcessorService } from './asg.processor';

@Injectable({ providedIn: 'root' })
export class AsgProcessorFactoryService {
  private configService = inject(AsgConfigService);
  private pipelinedProcessor = inject(AsgPipelinedProcessorService);
  private nonPipelinedProcessor = inject(AsgNonPipelinedProcessorService);
  private superscalarProcessor = inject(AsgSuperscalarProcessorService);

  /**
   * Obtiene el procesador actual según la configuración
   */
  getProcessor(): AsgProcessorService {
    const config = this.configService.getCurrentConfig();

    switch (config.processorType) {
      case 'superscalar':
        return this.superscalarProcessor;
      case 'non-pipelined':
        return this.nonPipelinedProcessor;
      case 'pipelined':
      default:
        return this.pipelinedProcessor;
    }
  }

  /**
   * Obtiene el tipo de procesador actual
   */
  getCurrentType(): ProcessorType {
    return this.configService.getCurrentConfig().processorType;
  }

  /**
   * Verifica si el procesador actual es superescalar
   */
  isSuperscalar(): boolean {
    return this.getCurrentType() === 'superscalar';
  }

  /**
   * Verifica si el procesador actual es no-segmentado
   */
  isNonPipelined(): boolean {
    return this.getCurrentType() === 'non-pipelined';
  }

}
