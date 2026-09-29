import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { TranslocoDirective } from '@jsverse/transloco';
import { ROBEntry } from '../../core/models/superscalar/rob';
import { AsgSuperscalarProcessorService } from '../../core/services/processor/asg.superscalar.processor';

@Component({
  selector: 'app-rob-view',
  standalone: true,
  imports: [CommonModule, TranslocoDirective, MatIcon],
  templateUrl: './rob-view.component.html',
  styleUrls: ['./rob-view.component.scss']
})
export class RobViewComponent {
  private processor = inject(AsgSuperscalarProcessorService);

  // Depend on cycle signal to trigger re-evaluation each cycle
  entries = computed(() => {
    this.processor.cycle(); // Subscribe to cycle changes
    return this.processor.getROBEntries();
  });

  occupancy = computed(() => {
    const entries = this.entries();
    const occupied = entries.filter(e => e.ocupada).length;
    const total = entries.length;
    return { occupied, total };
  });

  getStateClass(entry: ROBEntry): string {
    if (!entry.ocupada) return 'state-empty';
    if (entry.finalizada) return 'state-finished';
    if (entry.emitida) return 'state-issued';
    return 'state-waiting';
  }

  getStateText(entry: ROBEntry): string {
    if (!entry.ocupada) return '-';
    if (entry.finalizada) return 'F';
    if (entry.emitida) return 'E';
    return 'W';
  }

  formatValue(value: number | null): string {
    if (value === null) return '-';
    return value.toString();
  }

  formatHex(value: number | null): string {
    if (value === null) return '-';
    return '0x' + (value >>> 0).toString(16).padStart(8, '0');
  }

  getRegName(entry: ROBEntry): string {
    if (entry.regDestino === null || entry.tipoReg === null) return '-';
    return `${entry.tipoReg}${entry.regDestino}`;
  }

  isBranch(entry: ROBEntry): boolean {
    return entry.branchInfo !== null;
  }

  getBranchStatus(entry: ROBEntry): string {
    if (!entry.branchInfo) return '';
    if (entry.branchInfo.mispredicted === undefined) return 'pending';
    return entry.branchInfo.mispredicted ? 'mispredicted' : 'correct';
  }
}
