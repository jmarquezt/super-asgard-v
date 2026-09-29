import { Component, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { NumberFormatPipe } from '../pipes/number-format.pipe';
import { AsgNonPipelinedProcessorService } from '../../core/services/processor/asg.non-pipelined.processor';
import { AsgProcessorFactoryService } from '../../core/services/processor/asg.processor-factory';
import { AsgPipelinedProcessorService } from '../../core/services/processor/asg.pipelined.processor';

@Component({
  selector: 'app-pipeline-view',
  templateUrl: './pipeline-view.component.html',
  imports: [
    MatIcon,
    NumberFormatPipe,
    FormsModule,
    TranslocoDirective
  ],
  styleUrls: ['./pipeline-view.component.scss']
})
export class PipelineViewComponent {
  private processorFactory = inject(AsgProcessorFactoryService);

  /** Returns the correct scalar processor */
  public get processor(): AsgPipelinedProcessorService | AsgNonPipelinedProcessorService {
    const proc = this.processorFactory.getProcessor();

    return this.processorFactory.isNonPipelined() ? proc as AsgNonPipelinedProcessorService : proc as AsgPipelinedProcessorService;
  }
}
