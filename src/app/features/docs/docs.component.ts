import { Component, signal, computed, inject } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { DOC_SECTIONS, DocSection, DocCategory, DocEntry } from './docs.data';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

@Component({
  selector: 'app-docs',
  imports: [MatIconModule, TranslocoDirective],
  templateUrl: './docs.component.html',
  styleUrl: './docs.component.scss',
})
export class DocsComponent {
  private transloco = inject(TranslocoService);
  private breakpointObserver = inject(BreakpointObserver);

  protected sections = DOC_SECTIONS;
  // Ruta relativa para que respete el base-href
  protected readonly manualPdfUrl = 'assets/docs/manual-usuario.pdf';

  protected selected = signal<DocEntry | null>(null);
  protected openCategories = signal<Set<string>>(new Set());
  protected searchQuery = signal('');

  /**
   * detecta cuando se carga desde un dispositivo movil
   * @protected
   */
  protected isMobile = toSignal(
    this.breakpointObserver.observe(Breakpoints.Handset).pipe(map(result => result.matches)),
    { initialValue: this.breakpointObserver.isMatched(Breakpoints.Handset) },
  );

  // Inicializar con la primera sección expandida
  constructor() {
    this.openCategories.set(new Set(DOC_SECTIONS[0].categories.map(c => c.id)));
  }

  protected filteredSections = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.sections;

    return this.sections
      .map(section => ({
        ...section,
        categories: section.categories.map(cat => ({
          ...cat,
          entries: cat.entries.filter(e => {
            const name = e.name.toLowerCase();
            const desc = this.translate(e.description).toLowerCase();
            const syntax = e.syntax.toLowerCase();
            return name.includes(q) || desc.includes(q) || syntax.includes(q);
          }),
        })).filter(cat => cat.entries.length > 0)
      }))
      .filter(section => section.categories.length > 0);
  });

  select(entry: DocEntry) {
    this.selected.set(entry);
  }

  // en movil vuelve del detalle de articulo al menu listado
  backToList() {
    this.selected.set(null);
  }

  toggleCategory(id: string) {
    this.openCategories.update(set => {
      const next = new Set(set);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  isOpen(id: string) {
    return this.openCategories().has(id);
  }

  onSearch(event: Event) {
    const q = (event.target as HTMLInputElement).value;
    this.searchQuery.set(q);
    if (q) {
      // Abrir todas las categorías si hay búsqueda
      const allIds = this.sections.flatMap(s => s.categories.map(c => c.id));
      this.openCategories.set(new Set(allIds));
    }
  }

  translate(key: string): string {
    if (!key) return '';
    if (key.startsWith('DOCS.')) {
      return this.transloco.translate(key);
    }
    return key;
  }

  formatDescription(text: string): string[] {
    const translated = this.translate(text);
    return translated.split('\n');
  }
}
