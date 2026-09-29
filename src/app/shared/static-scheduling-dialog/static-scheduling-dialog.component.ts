import { Component, Inject, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { TranslocoModule } from '@jsverse/transloco';
import { AsgStaticSchedulerService, StaticSchedulerConfig, OptimizeResult } from '../../core/services/assembly/asg.static-scheduler';

@Component({
  selector: 'app-static-scheduling-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatDividerModule,
    TranslocoModule,
  ],
  templateUrl: './static-scheduling-dialog.component.html',
  styleUrls: ['./static-scheduling-dialog.component.scss'],
})
export class StaticSchedulingDialogComponent {
  private scheduler = inject(AsgStaticSchedulerService);

  // Configuración de optimización reactiva
  config = signal<StaticSchedulerConfig>({
    enableScheduling: true,
    enableUnrolling: false,
    unrollFactor: 2,
    enableRegisterRenaming: false,
    enableDelayedBranch: false,
  });

  originalCode: string;

  optimizeResult = computed<OptimizeResult>(() =>
    this.scheduler.optimize(this.originalCode, this.config())
  );

  /** Indicates if there was an error during optimization */
  hasError = computed(() => !!this.optimizeResult().error);

  /** Original lines annotated: marks lines whose content was moved in the optimized output */
  originalAnnotatedLines = computed(() => {
    const result = this.optimizeResult();
    if (result.error) {
      return this.originalCode.split('\n').map(text => ({ text, movedOut: false }));
    }

    const movedTexts = new Set<string>();
    for (const l of result.lines) {
      if (l.status === 'reordered') {
        movedTexts.add(l.text.trim().replace(/\s+/g, ' '));
      }
    }
    return this.originalCode.split('\n').map(text => ({
      text,
      movedOut: text.trim().length > 0 && movedTexts.has(text.trim().replace(/\s+/g, ' ')),
    }));
  });

  constructor(
    public dialogRef: MatDialogRef<StaticSchedulingDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { source: string },
  ) {
    this.originalCode = data.source;
  }

  updateConfig(changes: Partial<StaticSchedulerConfig>) {
    this.config.update(c => ({ ...c, ...changes }));
  }

  apply() {
    this.dialogRef.close(this.optimizeResult().code);
  }

  cancel() {
    this.dialogRef.close(null);
  }
}
