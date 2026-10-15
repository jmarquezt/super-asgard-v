import { Component, OnInit, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoDirective } from '@jsverse/transloco';

import { AsgConfig, LogLevel, DEFAULT_LATENCIES, DEFAULT_SUPERSCALAR_CONFIG, SUPERSCALAR_PRESETS } from '../../core/models/asg.config';
import { MatOption, MatSelect } from '@angular/material/select';

@Component({
  selector: 'app-settings',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatSliderModule,
    MatIconModule,
    TranslocoDirective,
    MatSelect,
    MatOption
],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit {
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);
  dialogRef = inject<MatDialogRef<SettingsComponent>>(MatDialogRef);
  data = inject<AsgConfig>(MAT_DIALOG_DATA);

  settingsForm!: FormGroup;

  readonly LIMITS = {
    aluLanes:   { min: 1,  max: 64   },
    memLanes:   { min: 1,  max: 64   },
    mvl:        { min: 8,  max: 256  },
    memorySize: { min: 1024, max: 65536 },
    ghrBits:    { min: 2,  max: 12   },
    latency:    { min: 1,  max: 256  },
    // Superscalar limits
    robSize:    { min: 16, max: 256  },
    cdbWidth:   { min: 1,  max: 16   },
    rsSize:     { min: 4,  max: 64   },
    fuCount:    { min: 1,  max: 8    },
  };

  readonly DEFAULT_LATENCIES = DEFAULT_LATENCIES;

  ngOnInit(): void {
    this.settingsForm = this.fb.group({
      processorType: [this.data?.processorType || 'pipelined'],
      memorySize: [this.data?.memorySize || this.LIMITS.memorySize.min, [Validators.required, Validators.min(this.LIMITS.memorySize.min), Validators.max(this.LIMITS.memorySize.max), this.isPowerOfTwo ]],
      enableForwarding: [this.data?.enableForwarding ?? true],
      enableVectorChaining: [this.data?.enableVectorChaining ?? true],
      enableBranchDelaySlot: [this.data?.enableBranchDelaySlot ?? false],
      aluLanes: [this.data?.aluLanes || this.LIMITS.aluLanes.min, [Validators.required, Validators.min(this.LIMITS.aluLanes.min), Validators.max(this.LIMITS.aluLanes.max)]],
      memLanes: [this.data?.memLanes || this.LIMITS.memLanes.min, [Validators.required, Validators.min(this.LIMITS.memLanes.min), Validators.max(this.LIMITS.memLanes.max)]],
      mvl: [this.data?.mvl || 64, [Validators.required, Validators.min(this.LIMITS.mvl.min), Validators.max(this.LIMITS.mvl.max), this.isPowerOfTwo]],
      branchPredictionStrategy: [this.data?.branchPredictionStrategy || 'none'],
      ghrBits: [this.data?.ghrBits || this.LIMITS.ghrBits.min, [Validators.required, Validators.min(this.LIMITS.ghrBits.min), Validators.max(this.LIMITS.ghrBits.max)]],
      loggingEnabled: [this.data?.loggingEnabled ?? true],
      logLevel: [this.data?.logLevel ?? 'relevant' as LogLevel],
      timelineMode: [this.data?.timelineMode ?? 'live'],
      latencies: this.fb.group({
        intMul:  [this.data?.latencies?.intMul  ?? DEFAULT_LATENCIES.intMul,  [Validators.required, Validators.min(this.LIMITS.latency.min), Validators.max(this.LIMITS.latency.max)]],
        intDiv:  [this.data?.latencies?.intDiv  ?? DEFAULT_LATENCIES.intDiv,  [Validators.required, Validators.min(this.LIMITS.latency.min), Validators.max(this.LIMITS.latency.max)]],
        fpAdd:   [this.data?.latencies?.fpAdd   ?? DEFAULT_LATENCIES.fpAdd,   [Validators.required, Validators.min(this.LIMITS.latency.min), Validators.max(this.LIMITS.latency.max)]],
        fpMul:   [this.data?.latencies?.fpMul   ?? DEFAULT_LATENCIES.fpMul,   [Validators.required, Validators.min(this.LIMITS.latency.min), Validators.max(this.LIMITS.latency.max)]],
        fpDiv:   [this.data?.latencies?.fpDiv   ?? DEFAULT_LATENCIES.fpDiv,   [Validators.required, Validators.min(this.LIMITS.latency.min), Validators.max(this.LIMITS.latency.max)]],
        fpAddD:  [this.data?.latencies?.fpAddD  ?? DEFAULT_LATENCIES.fpAddD,  [Validators.required, Validators.min(this.LIMITS.latency.min), Validators.max(this.LIMITS.latency.max)]],
        fpMulD:  [this.data?.latencies?.fpMulD  ?? DEFAULT_LATENCIES.fpMulD,  [Validators.required, Validators.min(this.LIMITS.latency.min), Validators.max(this.LIMITS.latency.max)]],
        fpDivD:  [this.data?.latencies?.fpDivD  ?? DEFAULT_LATENCIES.fpDivD,  [Validators.required, Validators.min(this.LIMITS.latency.min), Validators.max(this.LIMITS.latency.max)]],
        vecMem:  [this.data?.latencies?.vecMem  ?? DEFAULT_LATENCIES.vecMem,  [Validators.required, Validators.min(this.LIMITS.latency.min), Validators.max(this.LIMITS.latency.max)]],
        vecAdd:  [this.data?.latencies?.vecAdd  ?? DEFAULT_LATENCIES.vecAdd,  [Validators.required, Validators.min(this.LIMITS.latency.min), Validators.max(this.LIMITS.latency.max)]],
        vecMul:  [this.data?.latencies?.vecMul  ?? DEFAULT_LATENCIES.vecMul,  [Validators.required, Validators.min(this.LIMITS.latency.min), Validators.max(this.LIMITS.latency.max)]],
        vecDiv:  [this.data?.latencies?.vecDiv  ?? DEFAULT_LATENCIES.vecDiv,  [Validators.required, Validators.min(this.LIMITS.latency.min), Validators.max(this.LIMITS.latency.max)]],
        vecCmp:  [this.data?.latencies?.vecCmp  ?? DEFAULT_LATENCIES.vecCmp,  [Validators.required, Validators.min(this.LIMITS.latency.min), Validators.max(this.LIMITS.latency.max)]],
      }),
      // --- Configuración Superescalar ---
      superscalar: this.fb.group({
        rsType: [this.data?.superscalar?.rsType ?? DEFAULT_SUPERSCALAR_CONFIG.rsType],
        issueWidth: [this.data?.superscalar?.issueWidth ?? DEFAULT_SUPERSCALAR_CONFIG.issueWidth],
        robSize: [this.data?.superscalar?.robSize ?? DEFAULT_SUPERSCALAR_CONFIG.robSize, [Validators.required, Validators.min(this.LIMITS.robSize.min), Validators.max(this.LIMITS.robSize.max)]],
        cdbWidth: [this.data?.superscalar?.cdbWidth ?? DEFAULT_SUPERSCALAR_CONFIG.cdbWidth, [Validators.required, Validators.min(this.LIMITS.cdbWidth.min), Validators.max(this.LIMITS.cdbWidth.max)]],
        // Tamaños RS
        rsCentralizedSize: [this.data?.superscalar?.rsCentralizedSize ?? DEFAULT_SUPERSCALAR_CONFIG.rsCentralizedSize],
        rsPerUnitSize: [this.data?.superscalar?.rsPerUnitSize ?? DEFAULT_SUPERSCALAR_CONFIG.rsPerUnitSize],
        rsClusterSizes: this.fb.group({
          intCluster: [this.data?.superscalar?.rsClusterSizes?.intCluster ?? DEFAULT_SUPERSCALAR_CONFIG.rsClusterSizes.intCluster],
          fpCluster: [this.data?.superscalar?.rsClusterSizes?.fpCluster ?? DEFAULT_SUPERSCALAR_CONFIG.rsClusterSizes.fpCluster],
          memCluster: [this.data?.superscalar?.rsClusterSizes?.memCluster ?? DEFAULT_SUPERSCALAR_CONFIG.rsClusterSizes.memCluster],
          vecCluster: [this.data?.superscalar?.rsClusterSizes?.vecCluster ?? DEFAULT_SUPERSCALAR_CONFIG.rsClusterSizes.vecCluster],
        }),
        // Unidades funcionales
        intALUs: [this.data?.superscalar?.intALUs ?? DEFAULT_SUPERSCALAR_CONFIG.intALUs, [Validators.min(this.LIMITS.fuCount.min), Validators.max(this.LIMITS.fuCount.max)]],
        intMulUnits: [this.data?.superscalar?.intMulUnits ?? DEFAULT_SUPERSCALAR_CONFIG.intMulUnits, [Validators.min(this.LIMITS.fuCount.min), Validators.max(this.LIMITS.fuCount.max)]],
        intDivUnits: [this.data?.superscalar?.intDivUnits ?? DEFAULT_SUPERSCALAR_CONFIG.intDivUnits, [Validators.min(this.LIMITS.fuCount.min), Validators.max(this.LIMITS.fuCount.max)]],
        fpAddUnits: [this.data?.superscalar?.fpAddUnits ?? DEFAULT_SUPERSCALAR_CONFIG.fpAddUnits, [Validators.min(this.LIMITS.fuCount.min), Validators.max(this.LIMITS.fuCount.max)]],
        fpMulUnits: [this.data?.superscalar?.fpMulUnits ?? DEFAULT_SUPERSCALAR_CONFIG.fpMulUnits, [Validators.min(this.LIMITS.fuCount.min), Validators.max(this.LIMITS.fuCount.max)]],
        fpDivUnits: [this.data?.superscalar?.fpDivUnits ?? DEFAULT_SUPERSCALAR_CONFIG.fpDivUnits, [Validators.min(this.LIMITS.fuCount.min), Validators.max(this.LIMITS.fuCount.max)]],
        memUnits: [this.data?.superscalar?.memUnits ?? DEFAULT_SUPERSCALAR_CONFIG.memUnits, [Validators.min(this.LIMITS.fuCount.min), Validators.max(this.LIMITS.fuCount.max)]],
        branchUnits: [this.data?.superscalar?.branchUnits ?? DEFAULT_SUPERSCALAR_CONFIG.branchUnits, [Validators.min(this.LIMITS.fuCount.min), Validators.max(this.LIMITS.fuCount.max)]],
        vecMemUnits: [this.data?.superscalar?.vecMemUnits ?? DEFAULT_SUPERSCALAR_CONFIG.vecMemUnits, [Validators.min(this.LIMITS.fuCount.min), Validators.max(this.LIMITS.fuCount.max)]],
        vecIntUnits: [this.data?.superscalar?.vecIntUnits ?? DEFAULT_SUPERSCALAR_CONFIG.vecIntUnits, [Validators.min(this.LIMITS.fuCount.min), Validators.max(this.LIMITS.fuCount.max)]],
        vecMulUnits: [this.data?.superscalar?.vecMulUnits ?? DEFAULT_SUPERSCALAR_CONFIG.vecMulUnits, [Validators.min(this.LIMITS.fuCount.min), Validators.max(this.LIMITS.fuCount.max)]],
        vecDivUnits: [this.data?.superscalar?.vecDivUnits ?? DEFAULT_SUPERSCALAR_CONFIG.vecDivUnits, [Validators.min(this.LIMITS.fuCount.min), Validators.max(this.LIMITS.fuCount.max)]],
        enableVectorInitOverlap: [this.data?.superscalar?.enableVectorInitOverlap ?? DEFAULT_SUPERSCALAR_CONFIG.enableVectorInitOverlap]
      }),
    });

    // Estado inicial: aplicar disable según los valores cargados
    this.applyGhrBitsState(this.settingsForm.get('branchPredictionStrategy')!.value);
    this.applyLogLevelState(this.settingsForm.get('loggingEnabled')!.value);
    this.applyNonPipelinedState(this.settingsForm.get('processorType')!.value);

    // Escuchar cambios para activar/desactivar controles dependientes
    this.settingsForm.get('branchPredictionStrategy')!.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(v => this.applyGhrBitsState(v));
    this.settingsForm.get('loggingEnabled')!.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(v => this.applyLogLevelState(v));
    this.settingsForm.get('processorType')!.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(v => this.applyNonPipelinedState(v));
  }

  private applyGhrBitsState(strategy: string): void {
    const ctrl = this.settingsForm.get('ghrBits')!;
    ['gshare', 'hybrid'].includes(strategy) ? ctrl.enable({ emitEvent: false }) : ctrl.disable({ emitEvent: false });
  }

  private applyLogLevelState(enabled: boolean): void {
    const ctrl = this.settingsForm.get('logLevel')!;
    enabled ? ctrl.enable({ emitEvent: false }) : ctrl.disable({ emitEvent: false });
  }

  private applyNonPipelinedState(processorType: string): void {
    const forwarding      = this.settingsForm.get('enableForwarding')!;
    const chaining        = this.settingsForm.get('enableVectorChaining')!;
    const branchPrediction = this.settingsForm.get('branchPredictionStrategy')!;
    const delaySlot       = this.settingsForm.get('enableBranchDelaySlot')!;

    if (processorType === 'pipelined') {
      forwarding.enable({ emitEvent: false });
      chaining.enable({ emitEvent: false });
      branchPrediction.enable({ emitEvent: false });
      delaySlot.enable({ emitEvent: false });
    } else if (processorType === 'non-pipelined') {
      forwarding.disable({ emitEvent: false });
      chaining.disable({ emitEvent: false });
      branchPrediction.disable({ emitEvent: false });
      delaySlot.disable({ emitEvent: false });
    } else if (processorType === 'superscalar') {
      forwarding.disable({ emitEvent: false });
      chaining.enable({ emitEvent: false });
      branchPrediction.enable({ emitEvent: false });
      delaySlot.disable({ emitEvent: false });
    }
  }

  /**
   * Cierra el diálogo enviando los nuevos datos si el formulario es válido.
   * getRawValue() incluye los controles deshabilitados.
   */
  save(): void {
    if (this.settingsForm.valid) {
      this.dialogRef.close(this.settingsForm.getRawValue());
    }
  }

  /**
   * Cierra el diálogo sin aplicar cambios.
   */
  onCancel(): void {
    this.dialogRef.close();
  }

  get memSizeControl() {
    return this.settingsForm.get('memorySize');
  }

  get latenciesGroup() {
    return this.settingsForm.get('latencies') as FormGroup;
  }

  resetLatencies(): void {
    this.latenciesGroup.patchValue(DEFAULT_LATENCIES);
  }

  get superscalarGroup(): FormGroup {
    return this.settingsForm.get('superscalar') as FormGroup;
  }

  get isSuperscalar(): boolean {
    return this.settingsForm.get('processorType')?.value === 'superscalar';
  }

  get isNonPipelined(): boolean {
    return this.settingsForm.get('processorType')?.value === 'non-pipelined';
  }

  get rsType(): string {
    return this.superscalarGroup.get('rsType')?.value;
  }

  applyPreset(presetName: string): void {
    const preset = SUPERSCALAR_PRESETS[presetName];
    if (preset) {
      this.superscalarGroup.patchValue({
        ...DEFAULT_SUPERSCALAR_CONFIG,
        ...preset
      });
    }
  }

  resetSuperscalar(): void {
    this.superscalarGroup.patchValue(DEFAULT_SUPERSCALAR_CONFIG);
  }

// Opcional: Un validador que asegure que la memoria es potencia de 2 (muy común en hardware)
  private isPowerOfTwo(control: any) {
    const v = control.value;
    return (v & (v - 1)) === 0 && v > 0 ? null : { notPowerOfTwo: true };
  }

  protected readonly Math = Math;
}
