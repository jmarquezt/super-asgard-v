import { Component, ElementRef, effect, inject, computed, viewChild } from '@angular/core';
import { MatCard, MatCardContent, MatCardHeader, MatCardTitle } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';

import { TranslocoDirective } from '@jsverse/transloco';
import { AsgConfigService } from '../../core/services/asg.config';
import { exportCronogramaCSV, exportCronogramaPNG } from '../../core/services/utils/asg.exporter';
import { AsgProcessorService } from '../../core/services/processor/asg.processor';
import { AsgProcessorFactoryService } from '../../core/services/processor/asg.processor-factory';

@Component({
  selector: 'app-timeline-view',
  imports: [MatCard, MatCardContent, MatCardHeader, MatCardTitle, MatIcon, MatIconButton, MatTooltip, TranslocoDirective],
  templateUrl: './timeline-view.component.html',
  styleUrl: './timeline-view.component.scss'
})
export class TimelineViewComponent {

  private processorFactory = inject(AsgProcessorFactoryService);
  private configService = inject(AsgConfigService);

  private readonly viewportRef = viewChild<ElementRef<HTMLDivElement>>('viewport');

  protected get processor(): AsgProcessorService {
    return this.processorFactory.getProcessor();
  }

  protected timelineMode = computed(() => this.configService.getCurrentConfig().timelineMode);

  protected displayTimeline = computed(() => {
    const mode = this.timelineMode();
    const finished = this.processor.finished();

    if (mode === 'disabled') return [];
    if (mode === 'on-finish' && !finished) return [];

    return this.processor.timeline();
  });

  protected displayCycles = computed(() => {
    const mode = this.timelineMode();
    const finished = this.processor.finished();

    if (mode === 'disabled') return [];
    if (mode === 'on-finish' && !finished) return [];

    return Array.from({ length: this.processor.cycle() }, (_, i) => i + 1);
  });

  protected hasData = computed(() => {
    return this.processor.cycle() > 0;
  });

  protected showLiveOff = computed(() => {
    const mode = this.timelineMode();
    return mode === 'on-finish' && !this.processor.finished() && this.processor.cycle() > 0;
  });

  protected showDisabled = computed(() => {
    const mode = this.timelineMode();
    return mode === 'disabled' && this.processor.cycle() > 0;
  });

  constructor() {
    effect(() => {
      const cycle    = this.processor.cycle();
      const finished = this.processor.finished();
      if (cycle > 0 && !finished && this.timelineMode() === 'live') {
        setTimeout(() => {
          const vp = this.viewportRef()?.nativeElement;
          if (vp) { vp.scrollLeft = vp.scrollWidth; vp.scrollTop = vp.scrollHeight; }
        }, 0);
      }
    });
  }

  protected cellClass(stage: string | undefined): string {
    if (!stage) return 'cell';

    // Fases vectoriales: Init[n], Proc[n], Wait[n], WaitFU, End[n]
    if (stage.startsWith('Init[')) {
      return 'cell EX vector-init';
    }
    if (stage.startsWith('Proc[')) {
      return 'cell EX vector-processing';
    }
    if (stage.startsWith('Wait[')) {
      return 'cell EX vector-wait';
    }
    if (stage === 'WaitFU') {
      return 'cell EX vector-wait-fu';
    }
    if (stage.startsWith('End[')) {
      return 'cell EX vector-end';
    }

    // Latencia inicial: EX[3] o MEM[2]
    if (stage.includes('[')) {
      const name = stage.split('[')[0].trim();
      return `cell ${name} latency`;
    }
    // Procesando elementos: EX(0) o MEM(1) (legacy scalar)
    if (stage.includes('(')) {
      const name = stage.split('(')[0].trim();
      return `cell ${name} vector`;
    }
    return `cell ${stage}`;
  }

  /** Devuelve true si la celda es un ciclo de stall:
   *  - La instrucción en ID permanece bloqueada (RAW hazard).
   *  - La instrucción en IF no puede avanzar porque ID está bloqueado. */
  protected isStallCell(row: any, cycle: number): boolean {
    const cur  = row.stages[cycle];
    const prev = row.stages[cycle - 1];
    return (cur === 'ID' || cur === 'IF') && cur === prev;
  }

  protected onExportCSV(): void {
    exportCronogramaCSV(this.processor.timeline(),
      Array.from({ length: this.processor.cycle() }, (_, i) => i + 1));
  }

  protected onExportPNG(): void {
    exportCronogramaPNG(this.processor.timeline(),
      Array.from({ length: this.processor.cycle() }, (_, i) => i + 1));
  }

  trackByCycle(_: number, c: number): number { return c; }
  trackByRow  (_: number, row: any): number   { return row.id; }
}
