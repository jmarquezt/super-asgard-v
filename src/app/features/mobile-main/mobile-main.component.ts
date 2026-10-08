import { Component, inject, signal, viewChild } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { MatIcon } from '@angular/material/icon';
import { RegistersViewComponent } from '../../shared/registers-view/registers-view.component';
import { PipelineViewComponent } from '../../shared/pipeline-view/pipeline-view.component';
import { SuperscalarPipelineViewComponent } from '../../shared/superscalar-pipeline-view/superscalar-pipeline-view.component';
import { EventViewComponent } from '../../shared/event-view/event-view.component';
import { StatsViewComponent } from '../../shared/stats-view/stats-view.component';
import { SuperscalarStatsViewComponent } from '../../shared/superscalar-stats-view/superscalar-stats-view.component';
import { TimelineViewComponent } from '../../shared/timeline-view/timeline-view.component';
import { EditorComponent } from '../../shared/editor/editor.component';
import { ConsoleViewComponent } from '../../shared/console-view/console-view.component';
import { RobViewComponent } from '../../shared/rob-view/rob-view.component';
import { RsViewComponent } from '../../shared/rs-view/rs-view.component';
import { CdbViewComponent } from '../../shared/cdb-view/cdb-view.component';
import { MemoryViewGroupComponent } from '../../shared/memory-view-group/memory-view-group.component';
import { MobileExecButtonsComponent } from '../../shared/mobile-exec-buttons/mobile-exec-buttons.component';
import { AsgProcessorFactoryService } from '../../core/services/processor/asg.processor-factory';

type MobileTab = 'editor' | 'execution' | 'registers' | 'stats';

/**
 * Layout especifico para dispositivos móviles. Se activa con CDK al detectar dispositivo movil.
 * Navegación inferior por pestañas y controles de ejecución flotantes. Mismos componentes que la interfaz escritorio pero reubicados
 */
@Component({
  selector: 'app-mobile-main',
  imports: [
    TranslocoDirective,
    MatIcon,
    RegistersViewComponent,
    PipelineViewComponent,
    SuperscalarPipelineViewComponent,
    EventViewComponent,
    StatsViewComponent,
    SuperscalarStatsViewComponent,
    TimelineViewComponent,
    EditorComponent,
    ConsoleViewComponent,
    RobViewComponent,
    RsViewComponent,
    CdbViewComponent,
    MemoryViewGroupComponent,
    MobileExecButtonsComponent,
  ],
  templateUrl: './mobile-main.component.html',
  styleUrl: './mobile-main.component.scss',
})
export class MobileMainComponent {
  private processorFactory = inject(AsgProcessorFactoryService);

  protected editor = viewChild(EditorComponent);

  protected activeTab = signal<MobileTab>('editor');

  protected get memories() {
    const processor = this.processorFactory.getProcessor();
    return [processor.dataMemory, processor.instructionsMemory];
  }

  protected get isSuperscalar() {
    return this.processorFactory.isSuperscalar();
  }

  selectTab(tab: MobileTab) {
    this.activeTab.set(tab);
  }
}
