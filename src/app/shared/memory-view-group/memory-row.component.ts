import { Component, computed, input } from '@angular/core';
import { NumberFormatPipe } from '../pipes/number-format.pipe';
import { AsgMemoryService } from '../../core/services/asg.memory';

const sameBytes = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/**
 * Fila (palabra de 4 bytes) de la vista de memoria. Cada fila lee solo sus propios bytes, de modo que
 * una escritura en memoria únicamente vuelve a pintar la fila de la palabra modificada.
 */
@Component({
  selector: 'div[appMemoryRow]',
  imports: [NumberFormatPipe],
  host: { '[class.last-access]': 'isLastAccess()' },
  template: `
    <div class="cell address">{{ address() | numberFormat:(mode() === 'ascii' ? 'dec' : mode()) }}</div>
    <div class="cell content">
      @if (mode() === 'hex' || mode() === 'dec') {
        @for (i of byteOffsets; track i) {
          {{ bytes()[i] | numberFormat:mode() }}{{ i < 3 ? ' ' : '' }}
        }
      } @else {
        {{ value() | numberFormat:mode() }}
      }
    </div>
  `,
  styleUrl: './memory-row.component.scss',
})
export class MemoryRowComponent {
  readonly memory = input.required<AsgMemoryService>();
  readonly address = input.required<number>();
  readonly mode = input.required<'hex' | 'dec' | 'bin' | 'ascii'>();

  protected readonly byteOffsets = [0, 1, 2, 3];

  protected readonly bytes = computed(() => {
    const mem = this.memory().get();
    const a = this.address();
    return [mem[a], mem[a + 1], mem[a + 2], mem[a + 3]];
  }, { equal: sameBytes });

  // Palabra con signo en big endian, igual que memory.read(address, 4, true)
  protected readonly value = computed(() => {
    const [b0, b1, b2, b3] = this.bytes();
    return (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
  });

  protected readonly isLastAccess = computed(() => this.memory().getLastAccess() === this.address() / 4);
}
