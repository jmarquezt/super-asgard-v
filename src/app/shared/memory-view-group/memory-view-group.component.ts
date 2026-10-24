import {Component, computed, signal, input} from '@angular/core';
import {MatIcon} from '@angular/material/icon';
import {MatButtonToggle, MatButtonToggleGroup} from '@angular/material/button-toggle';
import {FormsModule} from '@angular/forms';
import {AsgMemoryService} from '../../core/services/asg.memory';
import {TranslocoDirective} from '@jsverse/transloco';
import {MatTab, MatTabGroup} from '@angular/material/tabs';
import {MemoryRowComponent} from './memory-row.component';

@Component({
  selector: 'app-memory-view-group',
  templateUrl: './memory-view-group.component.html',
  imports: [
    MatIcon,
    MemoryRowComponent,
    MatButtonToggle,
    MatButtonToggleGroup,
    FormsModule,
    TranslocoDirective,
    MatTabGroup,
    MatTab
  ],
  styleUrl: './memory-view-group.component.scss'
})
export class MemoryViewGroupComponent {

  readonly memories = input.required<AsgMemoryService[]>();

  readonly displayMode = signal<'hex' | 'dec' | 'bin' | 'ascii'>('dec');
  readonly searchQuery = signal('');
  readonly activeTabIndex = signal(0);

  readonly activeMemory = computed(() => {
    const index = this.activeTabIndex();
    return this.memories()[index];
  });

  // Solo depende del tamaño de la memoria (no de su contenido): escribir en memoria no rehace la lista,
  // cada fila (MemoryRowComponent) se actualiza por su cuenta cuando cambian sus bytes
  private readonly activeMemorySize = computed(() => this.activeMemory()?.get().length ?? 0);

  readonly memoryWords = computed(() => {
    const size = this.activeMemorySize();
    const words: { address: number }[] = [];
    for (let i = 0; i < size; i += 4) {
      words.push({ address: i });
    }
    return words;
  });

  readonly filteredWords = computed(() => {
    const words = this.memoryWords();
    const raw = this.searchQuery().trim().toLowerCase();
    if (!raw) return words;

    // Strip 0x prefix so "0x000000F0" and "000000F0" are treated equally
    const q = raw.startsWith('0x') ? raw.slice(2) : raw;
    if (!q) return words;

    const mode = this.displayMode();
    const memory = this.activeMemory();
    if (!memory) return words;

    const mem = memory.get();
    return words.filter(w => this.matchesQuery(w, q, mode, mem));
  });

  readonly isMemoryEmpty = computed(() => {
    const memory = this.activeMemory();
    if (!memory) return true;

    const data = memory.get();
    if (data.length === 0) return true;

    // Check if all bytes are zero
    return data.every(byte => byte === 0);
  });

  private matchesQuery(
    word: { address: number },
    q: string,
    mode: 'hex' | 'dec' | 'bin' | 'ascii',
    mem: Uint8Array,
  ): boolean {
    const bytes = [0, 1, 2, 3].map(i => mem[word.address + i]);
    switch (mode) {
      case 'hex': {
        // Display: "00 00 00 f0" — search both spaced and compact to support "000000f0"
        const spaced  = bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
        const compact = bytes.map(b => b.toString(16).padStart(2, '0')).join('');
        return spaced.includes(q) || compact.includes(q);
      }
      case 'dec': {
        // Display: "0 0 0 240"
        const spaced = bytes.map(b => b.toString(10)).join(' ');
        return spaced.includes(q);
      }
      case 'bin': {
        // Display: full 32-bit binary word
        const value = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
        return (value >>> 0).toString(2).padStart(32, '0').includes(q);
      }
      case 'ascii': {
        // Display: printable chars or '.'
        const ascii = bytes.map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');
        return ascii.toLowerCase().includes(q);
      }
    }
  }

}
