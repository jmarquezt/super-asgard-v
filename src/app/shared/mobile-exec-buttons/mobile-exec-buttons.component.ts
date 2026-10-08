import { Component, inject, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { TranslocoDirective } from '@jsverse/transloco';
import { AsgProcessorFactoryService } from '../../core/services/processor/asg.processor-factory';
import { EditorComponent } from '../editor/editor.component';

/**
 * Barra de controles de ejecución flotante para el layout móvil.
 *
 */
@Component({
  selector: 'app-mobile-exec-buttons',
  imports: [MatIcon, MatIconButton, MatTooltip, MatSlider, MatSliderThumb, TranslocoDirective],
  templateUrl: './mobile-exec-buttons.component.html',
  styleUrl: './mobile-exec-buttons.component.scss',
})
export class MobileExecButtonsComponent {
  //instancia del editor que se ha caragado en el layout movil
  readonly editor = input.required<EditorComponent>();

  private processorFactory = inject(AsgProcessorFactoryService);

  protected get processor() {
    return this.processorFactory.getProcessor();
  }

  //boton play / pause unificado en uno para ahorrar espacio en la interfaz
  togglePlayPause() {
    if (this.processor.isRunning()) {
      this.processor.pause();
    } else {
      this.editor().onRun();
    }
  }

  stop() {
    this.editor().onStop();
  }

  step() {
    this.editor().onStep();
  }

  runToBreakpoint() {
    this.editor().onRunToBreakpoint();
  }

  toggleTurbo() {
    this.editor().togglePerformanceMode();
  }

  reset() {
    this.processor.reset();
  }

  formatLabel(value: number): string {
    return `${value}ms`;
  }

  onSpeedChange(value: number) {
    this.processor.updateSpeed(value);
  }
}
