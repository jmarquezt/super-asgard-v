import { Component, inject } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatToolbar } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { MatTooltip } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { SettingsComponent } from '../settings/settings.component';
import { AsgConfig } from '../../core/models/asg.config';
import { AsgConfigService } from '../../core/services/asg.config';
import { ThemeService } from '../../services/theme';

@Component({
  selector: 'app-full-page-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatToolbar, MatIconModule, MatButtonModule, MatMenuModule, UpperCasePipe, TranslocoDirective, MatTooltip],
  templateUrl: './full-page.component.html',
  styleUrl: './full-page.component.scss',
})
export class FullPageComponent {
  protected themeService   = inject(ThemeService);
  private translocoService = inject(TranslocoService);
  private dialog           = inject(MatDialog);
  private configService    = inject(AsgConfigService);

  activeLang = toSignal(this.translocoService.langChanges$, {
    initialValue: this.translocoService.getActiveLang(),
  });

  openSettings() {
    const dialogRef = this.dialog.open(SettingsComponent, {
      width: '400px',
      data: this.configService.getCurrentConfig(),
      panelClass: 'asgard-dialog'
    });

    dialogRef.afterClosed().subscribe((newConfig: AsgConfig) => {
      if (newConfig) this.configService.updateConfig(newConfig);
    });
  }

  toggleTheme() {
    this.themeService.toggle();
  }

  changeLang(lang: string) {
    this.translocoService.setActiveLang(lang);
  }
}
