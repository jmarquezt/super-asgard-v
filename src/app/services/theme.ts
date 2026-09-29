import { inject, Injectable, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);

  readonly isDark = signal<boolean>(false);

  constructor() {
    const saved = localStorage.getItem('darkMode') === 'true';
    this.isDark.set(saved);
    this.doc.body.classList.toggle('dark-theme', saved);
  }

  toggle(): void {
    const next = !this.isDark();
    this.isDark.set(next);
    this.doc.body.classList.toggle('dark-theme', next);
    localStorage.setItem('darkMode', String(next));
  }
}
