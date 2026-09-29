import { Component, inject } from '@angular/core';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { TranslocoDirective } from '@jsverse/transloco';
import { ThemeService } from '../../services/theme';

@Component({
  selector: 'app-loader',
  standalone: true,
  imports: [MatProgressSpinner, TranslocoDirective],
  template: `
    <ng-container *transloco="let t">
      <div class="loading-overlay" [class.dark-theme]="themeService.isDark()">
        <div class="loading-content">
          <mat-progress-spinner
            mode="indeterminate"
            diameter="60"
            color="primary">
          </mat-progress-spinner>
          <p class="loading-text">{{ t('COMMON.LOADING') }}</p>
        </div>
      </div>
    </ng-container>
  `,
  styles: [`
    .loading-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: var(--mat-sys-background);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      transition: background-color 0.3s ease;
    }

    .loading-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      animation: fadeIn 0.3s ease-in-out;
    }

    .loading-text {
      margin: 0;
      font-size: 1rem;
      font-weight: 500;
      color: var(--mat-sys-on-surface);
      letter-spacing: 0.5px;
      transition: color 0.3s ease;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    /* Estilos específicos para modo oscuro */
    .loading-overlay.dark-theme {
      background: var(--mat-sys-surface-dim);
    }
  `]
})
export class LoaderComponent {
  protected themeService = inject(ThemeService);
}
