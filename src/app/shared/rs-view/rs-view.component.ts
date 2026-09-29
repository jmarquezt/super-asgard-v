import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslocoDirective } from '@jsverse/transloco';
import { ROBTag } from '../../core/models/superscalar/rob';
import { RSEntry } from '../../core/models/superscalar/rs';
import { AsgSuperscalarProcessorService } from '../../core/services/processor/asg.superscalar.processor';

@Component({
  selector: 'app-rs-view',
  standalone: true,
  imports: [CommonModule, TranslocoDirective],
  templateUrl: './rs-view.component.html',
  styleUrls: ['./rs-view.component.scss']
})
export class RsViewComponent {
  private processor = inject(AsgSuperscalarProcessorService);

  // Depend on cycle signal to trigger re-evaluation each cycle
  entries = computed(() => {
    this.processor.cycle();
    return this.processor.getRSEntries();
  });

  // Obtiene información de utilización por tipo
  utilization = computed(() => {
    this.processor.cycle();
    return this.processor.getRSUtilizationByType();
  });

  // Agrupa RS por tipo de unidad funcional con información de ocupación
  groupedEntries = computed(() => {
    const entries = this.entries();
    const util = this.utilization();
    const groups = new Map<string, { entries: RSEntry[], occupied: number, total: number }>();

    // Primero agrupar las entradas ocupadas
    for (const entry of entries) {
      const type = entry.fuType;
      if (!groups.has(type)) {
        const info = util.get(type) || { occupied: 0, total: 0 };
        groups.set(type, { entries: [], occupied: info.occupied, total: info.total });
      }
      groups.get(type)!.entries.push(entry);
    }

    // Solo retornar grupos que tienen entradas ocupadas
    return Array.from(groups.entries())
      .filter(([_, data]) => data.occupied > 0)
      .map(([type, data]) => ({
        type,
        entries: data.entries,
        occupied: data.occupied,
        total: data.total
      }));
  });

  getStateClass(entry: RSEntry): string {
    if (!entry.ocupada) return 'state-empty';
    if (entry.lista) return 'state-ready';
    return 'state-waiting';
  }

  formatOperand(value: number | null, tag: ROBTag | null): string {
    if (tag !== null) return `ROB[${tag.slot}]`;
    if (value === null) return '-';
    return value.toString();
  }

  isReady(entry: RSEntry): boolean {
    return entry.ocupada && entry.lista;
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
