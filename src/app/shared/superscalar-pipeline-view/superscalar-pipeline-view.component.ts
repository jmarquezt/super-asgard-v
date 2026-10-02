import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';

import { MatIcon } from '@angular/material/icon';
import { TranslocoDirective } from '@jsverse/transloco';
import { AsgSuperscalarProcessorService } from '../../core/services/processor/asg.superscalar.processor';

@Component({
  selector: 'app-superscalar-pipeline-view',
  standalone: true,
  templateUrl: './superscalar-pipeline-view.component.html',
  styleUrls: ['./superscalar-pipeline-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    MatIcon,
    TranslocoDirective
]
})
export class SuperscalarPipelineViewComponent {
  public processor = inject(AsgSuperscalarProcessorService);

  /** Agrupa las instrucciones en vuelo por su etapa actual */
  public stages = computed(() => {
    // Forzamos dependencia del signal 'cycle'
    const currentCycle = this.processor.cycle();
    const isFinished = this.processor.finished();

    const inFlight = Array.from(this.processor.inFlight.values());

    return {
      IF: inFlight.filter(i => i.state === 'FETCHED'),
      ID: inFlight.filter(i => i.state === 'DECODED'),
      II: inFlight.filter(i => i.state === 'DISPATCHED' || i.state === 'ISSUED'),
      // EX: Instrucciones ejecutándose o que terminaron pero aún no publicaron resultado
      EX: inFlight.filter(i =>
        i.state === 'EXECUTING' ||
        (i.state === 'FINISHED' && i.cycleWR === null)
      ),
      // WR: Instrucciones que ya publicaron en CDB (cycleWR está definido)
      WR: inFlight.filter(i =>
        i.state === 'FINISHED' &&
        i.cycleWR !== null
      ),
      // RI: instrucciones retiradas este ciclo
      // Limpiar si el programa terminó para evitar que se quede la última instrucción
      RI: isFinished ? [] : this.processor.lastRetiredInFlight
    };
  });
}
