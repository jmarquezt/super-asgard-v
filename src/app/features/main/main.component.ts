import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { map } from 'rxjs';
import { MobileMainComponent } from '../mobile-main/mobile-main.component';
import { RegistersViewComponent } from '../../shared/registers-view/registers-view.component';
import { PipelineViewComponent } from '../../shared/pipeline-view/pipeline-view.component';
import { EventViewComponent } from '../../shared/event-view/event-view.component';
import { StatsViewComponent } from '../../shared/stats-view/stats-view.component';
import { TimelineViewComponent } from '../../shared/timeline-view/timeline-view.component';
import { EditorComponent } from '../../shared/editor/editor.component';
import { ConsoleViewComponent } from '../../shared/console-view/console-view.component';
import { AsgProcessorFactoryService } from '../../core/services/processor/asg.processor-factory';
import { RobViewComponent } from '../../shared/rob-view/rob-view.component';
import { RsViewComponent } from '../../shared/rs-view/rs-view.component';
import { CdbViewComponent } from '../../shared/cdb-view/cdb-view.component';
import { SuperscalarStatsViewComponent } from '../../shared/superscalar-stats-view/superscalar-stats-view.component';
import { SuperscalarPipelineViewComponent } from '../../shared/superscalar-pipeline-view/superscalar-pipeline-view.component';
import { MemoryViewGroupComponent } from '../../shared/memory-view-group/memory-view-group.component';

@Component({
  selector: 'app-main',
  standalone: true,
  imports: [
    RegistersViewComponent,
    PipelineViewComponent,
    SuperscalarPipelineViewComponent,
    EventViewComponent,
    StatsViewComponent,
    TimelineViewComponent,
    EditorComponent,
    ConsoleViewComponent,
    RobViewComponent,
    RsViewComponent,
    CdbViewComponent,
    SuperscalarStatsViewComponent,
    MemoryViewGroupComponent,
    MobileMainComponent
],
  templateUrl: './main.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./main.component.scss'],
})
export class MainComponent {
  private processorFactory = inject(AsgProcessorFactoryService);
  private breakpointObserver = inject(BreakpointObserver);

  /**
   * true en dispositivos movil (CDK Breakpoints.Handset, ambas orientaciones).
   * Controla qué layout se instancia si el de movil o el de escritorio
   */
  protected isMobile = toSignal(
    this.breakpointObserver.observe(Breakpoints.Handset).pipe(map(result => result.matches)),
    { initialValue: this.breakpointObserver.isMatched(Breakpoints.Handset) },
  );

  /** obtengo las memorias del procesador (datos | instrucciones) */
  protected get memories() {
    const processor = this.processorFactory.getProcessor();

    return [processor.dataMemory, processor.instructionsMemory];
  }

  protected get isSuperscalar() {
    return this.processorFactory.isSuperscalar();
  }
}
