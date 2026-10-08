import { Component, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { TranslocoDirective } from '@jsverse/transloco';
import { AsgProcessorFactoryService } from '../../core/services/processor/asg.processor-factory';
import { AsgPipelinedProcessorService } from '../../core/services/processor/asg.pipelined.processor';
import { AsgNonPipelinedProcessorService } from '../../core/services/processor/asg.non-pipelined.processor';

@Component({
  selector: 'app-stats-view',
  templateUrl: './stats-view.component.html',
  imports: [
    MatIcon,
    MatProgressBar,
    TranslocoDirective
  ],
  styleUrl: './stats-view.component.scss'
})
export class StatsViewComponent {

  private processorFactory = inject(AsgProcessorFactoryService);

  /** Returns the correct scalar processor */
  public get processor(): AsgPipelinedProcessorService | AsgNonPipelinedProcessorService {
    const proc = this.processorFactory.getProcessor();

    return this.processorFactory.isNonPipelined() ? proc as AsgNonPipelinedProcessorService : proc as AsgPipelinedProcessorService;
  }

  getBranchHitRateClass(rate: number): string {
    if (rate >= 90) return 'success-theme';
    if (rate >= 70) return 'warning-theme';
    return 'danger-theme';
  }
}
