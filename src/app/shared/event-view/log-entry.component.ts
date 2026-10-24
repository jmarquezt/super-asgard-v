import { Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { LogEntry } from '../../core/models/asg.models';

/**
 * Entrada del registro de eventos. Como componente propio, añadir una entrada nueva al log no
 * vuelve a evaluar las ya pintadas: sus inputs no cambian y Angular no las revisa.
 */
@Component({
  selector: 'div[appLogEntry]',
  imports: [MatIcon],
  host: { '[class]': 'entry().type' },
  template: `
    <span class="cycle-badge">{{ cycleLabel() }} {{ entry().cycle }}</span>
    <span class="message">{{ entry().message }}</span>
    <mat-icon class="status-icon">{{ icon() }}</mat-icon>
  `,
  styleUrl: './log-entry.component.scss',
})
export class LogEntryComponent {
  readonly entry = input.required<LogEntry>();
  readonly cycleLabel = input.required<string>();

  protected readonly icon = computed(() => {
    const type = this.entry().type;
    return type === 'success' ? 'check_circle' : type === 'warning' ? 'error_outline' : 'info';
  });
}
