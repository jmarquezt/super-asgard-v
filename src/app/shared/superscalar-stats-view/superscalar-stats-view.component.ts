import { Component, inject, computed } from '@angular/core';
import { CommonModule, DecimalPipe, NgClass } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { TranslocoDirective } from '@jsverse/transloco';
import { AsgSuperscalarProcessorService } from '../../core/services/processor/asg.superscalar.processor';

@Component({
  selector: 'app-superscalar-stats-view',
  standalone: true,
  imports: [CommonModule, TranslocoDirective, DecimalPipe, NgClass, MatIcon, MatProgressBar],
  templateUrl: './superscalar-stats-view.component.html',
  styleUrls: ['./superscalar-stats-view.component.scss']
})
export class SuperscalarStatsViewComponent {
  private processor = inject(AsgSuperscalarProcessorService);

  cycle = computed(() => this.processor.cycle());

  // Depend on cycle signal to trigger re-evaluation each cycle
  stats = computed(() => {
    this.cycle();
    return this.processor.getStats();
  });

  ipc = computed(() => {
    const s = this.stats();
    return s.ipc.toFixed(3);
  });

  branchAccuracy = computed(() => {
    const s = this.stats();
    if (s.branchPredictions === 0) return 100;
    return s.branchAccuracy * 100;
  });

  stallBreakdown = computed(() => {
    const s = this.stats();
    const total = s.fetchStalls + s.robFullStalls + s.rsFullStalls + s.structuralStalls;
    return {
      fetch: s.fetchStalls,
      rob: s.robFullStalls,
      rs: s.rsFullStalls,
      structural: s.structuralStalls,
      total
    };
  });

  getBranchAccuracyClass(rate: number): string {
    if (rate >= 90) return 'success';
    if (rate >= 70) return 'warning';
    return 'danger';
  }
}
