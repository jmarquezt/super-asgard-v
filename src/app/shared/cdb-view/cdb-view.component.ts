import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';

import { TranslocoDirective } from '@jsverse/transloco';
import { AsgSuperscalarProcessorService } from '../../core/services/processor/asg.superscalar.processor';

@Component({
  selector: 'app-cdb-view',
  standalone: true,
  imports: [TranslocoDirective],
  templateUrl: './cdb-view.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./cdb-view.component.scss']
})
export class CdbViewComponent {
  private processor = inject(AsgSuperscalarProcessorService);

  // Depend on cycle signal to trigger re-evaluation each cycle
  results = computed(() => {
    this.processor.cycle();
    return this.processor.getCDBResults();
  });

  hasResults = computed(() => this.results().length > 0);

  formatValue(value: number): string {
    return value.toString();
  }

  getFuTypeColor(type: string): string {
    const colors: Record<string, string> = {
      'INT_ALU': '#4caf50',
      'INT_MUL': '#8bc34a',
      'INT_DIV': '#cddc39',
      'FP_ADD': '#03a9f4',
      'FP_MUL': '#00bcd4',
      'FP_DIV': '#009688',
      'MEM': '#ff9800',
      'BRANCH': '#9c27b0',
      'VEC_MEM': '#ff5722',
      'VEC_INT': '#e91e63',
      'VEC_MUL': '#f06292',
      'VEC_DIV': '#ba68c8'
    };
    return colors[type] || '#9e9e9e';
  }
}
