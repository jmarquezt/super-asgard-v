import { Component, ElementRef, AfterViewChecked, inject, signal, computed, ChangeDetectionStrategy, viewChild } from '@angular/core';
import {MatIcon} from '@angular/material/icon';
import {NgClass} from '@angular/common';
import {TranslocoDirective} from '@jsverse/transloco';
import {MatIconButton} from '@angular/material/button';
import {MatTooltip} from '@angular/material/tooltip';
import {LogService} from '../../services/log';

@Component({
  selector: 'app-event-view',
  templateUrl: './event-view.component.html',
  imports: [
    MatIcon,
    NgClass,
    TranslocoDirective,
    MatIconButton,
    MatTooltip
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./event-view.component.scss']
})
export class EventViewComponent implements AfterViewChecked {
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

  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    try {
      this.scrollContainer().nativeElement.scrollTop = 0;
    } catch(err) {}
  }
}
