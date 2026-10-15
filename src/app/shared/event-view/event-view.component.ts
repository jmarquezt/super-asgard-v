import { Component, ElementRef, afterRenderEffect, inject, signal, computed, viewChild } from '@angular/core';
import {MatIcon} from '@angular/material/icon';
import {TranslocoDirective} from '@jsverse/transloco';
import {MatIconButton} from '@angular/material/button';
import {MatTooltip} from '@angular/material/tooltip';
import {LogService} from '../../services/log';

@Component({
  selector: 'app-event-view',
  templateUrl: './event-view.component.html',
  imports: [
    MatIcon,
    TranslocoDirective,
    MatIconButton,
    MatTooltip
  ],
  styleUrl: './event-view.component.scss'
})
export class EventViewComponent {
  private readonly scrollContainer = viewChild.required<ElementRef>('scrollContainer');

  protected logService = inject(LogService);

  readonly searchQuery = signal('');

  readonly filteredEvents = computed(() => {
    const events = this.logService.eventLog();
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return events;
    return events.filter(e =>
      e.message.toLowerCase().includes(q) ||
      e.cycle.toString().includes(q) ||
      e.type.includes(q),
    );
  });

  constructor() {
    // Reposiciona el scroll solo cuando cambia la lista mostrada (antes se hacía en cada ciclo de CD)
    afterRenderEffect(() => {
      this.filteredEvents();
      this.scrollToBottom();
    });
  }

  private scrollToBottom(): void {
    try {
      this.scrollContainer().nativeElement.scrollTop = 0;
    } catch(err) {}
  }
}
