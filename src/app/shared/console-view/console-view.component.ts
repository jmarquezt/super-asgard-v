import { Component, inject, ElementRef, effect, computed, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AsgProcessorFactoryService } from '../../core/services/processor/asg.processor-factory';
import { TranslocoDirective } from '@jsverse/transloco';

@Component({
  selector: 'app-console-view',
  imports: [FormsModule, TranslocoDirective],
  templateUrl: './console-view.component.html',
  styleUrl: './console-view.component.scss',
})
export class ConsoleViewComponent {
  private processorFactory = inject(AsgProcessorFactoryService);
  protected inputText = '';

  private readonly terminalBody = viewChild<ElementRef<HTMLDivElement>>('terminalBody');
  private readonly stdinInput = viewChild<ElementRef<HTMLInputElement>>('stdinInput');

  protected consoleOutput = computed(() => {
    return this.processorFactory.getProcessor().consoleOutput();
  });

  protected trapStdinRequest = computed(() => {
    return this.processorFactory.getProcessor().trapStdinRequest();
  });

  constructor() {
    // Auto-scroll al fondo cuando llega nueva salida
    effect(() => {
      this.consoleOutput();
      setTimeout(() => {
        const el = this.terminalBody()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      }, 0);
    });

    // Auto-focus al input cuando el programa solicita stdin
    effect(() => {
      const req = this.trapStdinRequest();
      if (req) {
        setTimeout(() => this.stdinInput()?.nativeElement?.focus(), 30);
      }
    });
  }

  get fullOutput(): string {
    return this.consoleOutput().join('');
  }

  submitInput(): void {
    const text = this.inputText;
    const processor = this.processorFactory.getProcessor();

    processor.consoleOutput.update(lines => [...lines, text + '\n']);
    processor.resolveTrapStdin(text + '\n');
    this.inputText = '';
  }

  clear(): void {
    this.processorFactory.getProcessor().consoleOutput.set([]);
  }
}
