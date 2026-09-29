import { TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { SettingsComponent } from '../../src/app/layout/settings/settings.component';
import { AsgConfigService } from '../../src/app/core/services/asg.config';
import { DEFAULT_SUPERSCALAR_CONFIG } from '../../src/app/core/models/asg.config';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('SettingsComponent (integración)', () => {
  let dialogRefCloseSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    resetIntegrationEnvironment();
    dialogRefCloseSpy = vi.fn();

    // AsgConfigService.getCurrentConfig() da la forma real de AsgConfig, pero inject() la
    // instancia el TestBed por defecto — hay que resetearlo antes de poder llamar de nuevo a
    // configureTestingModule() (Angular no permite reconfigurar un TestBed ya instanciado).
    TestBed.configureTestingModule({ providers: [integrationTestProviders()] });
    const realConfig = TestBed.inject(AsgConfigService).getCurrentConfig();
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        integrationTestProviders(),
        { provide: MatDialogRef, useValue: { close: dialogRefCloseSpy } },
        { provide: MAT_DIALOG_DATA, useValue: realConfig },
      ],
    }).compileComponents();
  });

  it('se crea y construye un settingsForm válido tras ngOnInit', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component).toBeTruthy();
    expect(component.settingsForm).toBeTruthy();
    expect(component.settingsForm.valid).toBe(true);
  });

  it('onCancel() cierra el diálogo sin argumentos', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    fixture.componentInstance.onCancel();

    expect(dialogRefCloseSpy).toHaveBeenCalledWith();
  });

  it('save() cierra el diálogo con el valor bruto (getRawValue) del formulario cuando es válido', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const expectedRawValue = component.settingsForm.getRawValue();
    component.save();

    expect(dialogRefCloseSpy).toHaveBeenCalledWith(expectedRawValue);
  });

  it('save() no cierra el diálogo cuando el formulario es inválido', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.settingsForm.get('memorySize')!.setValue(-1);
    expect(component.settingsForm.invalid).toBe(true);

    component.save();

    expect(dialogRefCloseSpy).not.toHaveBeenCalled();
  });

  it('al cambiar processorType a "non-pipelined" se deshabilitan forwarding, chaining, branch prediction y delay slot', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.settingsForm.get('processorType')!.setValue('non-pipelined');

    expect(component.settingsForm.get('enableForwarding')!.disabled).toBe(true);
    expect(component.settingsForm.get('enableVectorChaining')!.disabled).toBe(true);
    expect(component.settingsForm.get('branchPredictionStrategy')!.disabled).toBe(true);
    expect(component.settingsForm.get('enableBranchDelaySlot')!.disabled).toBe(true);
  });

  it('al volver processorType a "pipelined" se rehabilitan los controles dependientes', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.settingsForm.get('processorType')!.setValue('non-pipelined');
    component.settingsForm.get('processorType')!.setValue('pipelined');

    expect(component.settingsForm.get('enableForwarding')!.disabled).toBe(false);
    expect(component.settingsForm.get('enableVectorChaining')!.disabled).toBe(false);
    expect(component.settingsForm.get('branchPredictionStrategy')!.disabled).toBe(false);
    expect(component.settingsForm.get('enableBranchDelaySlot')!.disabled).toBe(false);
  });

  it('applyPreset("aggressive") aplica los valores del preset al grupo superscalar', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.applyPreset('aggressive');

    const raw = component.superscalarGroup.getRawValue();
    expect(raw.issueWidth).toBe(8);
    expect(raw.robSize).toBe(128);
    expect(raw.rsType).toBe('clustered');
    expect(raw.intALUs).toBe(4);
    expect(raw.memUnits).toBe(3);
    expect(raw.cdbWidth).toBe(8);
    expect(raw.rsClusterSizes).toEqual({
      intCluster: 16,
      fpCluster: 12,
      memCluster: 16,
      vecCluster: 8,
    });
  });

  it('resetSuperscalar() restaura el grupo superscalar a DEFAULT_SUPERSCALAR_CONFIG', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.applyPreset('aggressive');
    component.resetSuperscalar();

    const raw = component.superscalarGroup.getRawValue();
    expect(raw.issueWidth).toBe(DEFAULT_SUPERSCALAR_CONFIG.issueWidth);
    expect(raw.robSize).toBe(DEFAULT_SUPERSCALAR_CONFIG.robSize);
    expect(raw.rsType).toBe(DEFAULT_SUPERSCALAR_CONFIG.rsType);
  });

  it('applyPreset("minimal") y applyPreset("balanced") aplican los valores de esos presets', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;

    component.applyPreset('minimal');
    let raw = component.superscalarGroup.getRawValue();
    expect(raw.issueWidth).toBe(2);
    expect(raw.robSize).toBe(32);
    expect(raw.rsType).toBe('centralized');
    expect(raw.rsCentralizedSize).toBe(16);
    expect(raw.cdbWidth).toBe(2);

    component.applyPreset('balanced');
    raw = component.superscalarGroup.getRawValue();
    expect(raw.issueWidth).toBe(4);
    expect(raw.robSize).toBe(64);
    expect(raw.rsType).toBe('distributed');
    expect(raw.rsPerUnitSize).toBe(4);
    expect(raw.cdbWidth).toBe(4);
  });

  it('applyPreset() con un nombre desconocido no modifica el grupo superscalar', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const before = component.superscalarGroup.getRawValue();
    component.applyPreset('no-existe');

    expect(component.superscalarGroup.getRawValue()).toEqual(before);
  });

  it('al cambiar processorType a "superscalar" se deshabilita forwarding y delay slot, y se habilitan chaining/branch prediction', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.settingsForm.get('processorType')!.setValue('superscalar');

    expect(component.settingsForm.get('enableForwarding')!.disabled).toBe(true);
    expect(component.settingsForm.get('enableVectorChaining')!.disabled).toBe(false);
    expect(component.settingsForm.get('branchPredictionStrategy')!.disabled).toBe(false);
    expect(component.settingsForm.get('enableBranchDelaySlot')!.disabled).toBe(true);
    expect(component.isSuperscalar).toBe(true);
    expect(component.isNonPipelined).toBe(false);
  });

  it('isNonPipelined refleja el valor actual de processorType', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.settingsForm.get('processorType')!.setValue('non-pipelined');

    expect(component.isNonPipelined).toBe(true);
    expect(component.isSuperscalar).toBe(false);
  });

  it('rsType devuelve el valor actual del control rsType del grupo superscalar', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.superscalarGroup.get('rsType')!.setValue('distributed');

    expect(component.rsType).toBe('distributed');
  });

  it('al cambiar branchPredictionStrategy a "gshare" o "hybrid" se habilita ghrBits, y se deshabilita con "none"', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const ghrBits = component.settingsForm.get('ghrBits')!;

    component.settingsForm.get('branchPredictionStrategy')!.setValue('gshare');
    expect(ghrBits.disabled).toBe(false);

    component.settingsForm.get('branchPredictionStrategy')!.setValue('hybrid');
    expect(ghrBits.disabled).toBe(false);

    component.settingsForm.get('branchPredictionStrategy')!.setValue('none');
    expect(ghrBits.disabled).toBe(true);
  });

  it('al desactivar loggingEnabled se deshabilita logLevel, y se rehabilita al activarlo', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const logLevel = component.settingsForm.get('logLevel')!;

    component.settingsForm.get('loggingEnabled')!.setValue(false);
    expect(logLevel.disabled).toBe(true);

    component.settingsForm.get('loggingEnabled')!.setValue(true);
    expect(logLevel.disabled).toBe(false);
  });

  it('resetLatencies() restaura el grupo de latencias a DEFAULT_LATENCIES', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.latenciesGroup.get('intMul')!.setValue(999);
    component.resetLatencies();

    expect(component.latenciesGroup.getRawValue()).toEqual(component.DEFAULT_LATENCIES);
  });

  it('memSizeControl (isPowerOfTwo) es inválido con un tamaño que no es potencia de 2, y válido con una potencia de 2', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const memSize = component.memSizeControl!;

    memSize.setValue(5000);
    expect(memSize.errors?.['notPowerOfTwo']).toBe(true);

    memSize.setValue(8192);
    expect(memSize.errors).toBeNull();
  });

  it('un valor de latencia fuera de rango marca el control inválido y renderiza el mat-error', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const vecMem = component.latenciesGroup.get('vecMem')!;

    vecMem.setValue(component.LIMITS.latency.max + 1);
    vecMem.markAsTouched();
    fixture.detectChanges();

    expect(vecMem.invalid).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('mat-error').length).toBeGreaterThan(0);
  });

  it('con TODOS los campos de latencia fuera de rango, cada uno renderiza su propio mat-error y el botón guardar queda deshabilitado', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const controlNames = Object.keys(component.latenciesGroup.controls);
    expect(controlNames.length).toBeGreaterThan(0);

    for (const name of controlNames) {
      const control = component.latenciesGroup.get(name)!;
      control.setValue(component.LIMITS.latency.max + 1);
      control.markAsTouched();
    }
    fixture.detectChanges();

    for (const name of controlNames) {
      expect(component.latenciesGroup.get(name)!.invalid).toBe(true);
    }
    expect(component.settingsForm.invalid).toBe(true);

    const errors = fixture.nativeElement.querySelectorAll('mat-error');
    expect(errors.length).toBe(controlNames.length);

    const saveButton = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (b: any) => b.textContent?.includes('COMMON.SAVE') || b.getAttribute('color') === 'primary'
    ) as HTMLButtonElement | undefined;
    expect(saveButton?.disabled).toBe(true);
  });

  it('ghrBits queda deshabilitado con branchPredictionStrategy "none" (slider marcado como disabled)', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.settingsForm.get('branchPredictionStrategy')!.setValue('none');
    fixture.detectChanges();

    expect(component.settingsForm.get('ghrBits')!.disabled).toBe(true);
    const sliderContainer = fixture.nativeElement.querySelector('.slider-container');
    expect(sliderContainer?.classList.contains('disabled')).toBe(true);
  });

  // Los tests anteriores llaman a onCancel()/save()/resetLatencies()/applyPreset() directamente
  // sobre la instancia; los siguientes disparan clics reales sobre los botones de la plantilla
  // para cubrir esos listeners.
  it('el botón cancelar (clic real) cierra el diálogo sin argumentos', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const cancelBtn = Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button'))
      .find((b: any) => b.textContent?.includes('COMMON.CANCEL')) as HTMLButtonElement;
    expect(cancelBtn).toBeTruthy();
    cancelBtn.click();

    expect(dialogRefCloseSpy).toHaveBeenCalledWith();
  });

  it('el botón guardar (clic real) cierra el diálogo con el valor bruto del formulario', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const expectedRawValue = component.settingsForm.getRawValue();

    const saveBtn = Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button'))
      .find((b: any) => b.textContent?.includes('COMMON.SAVE')) as HTMLButtonElement;
    expect(saveBtn).toBeTruthy();
    saveBtn.click();

    expect(dialogRefCloseSpy).toHaveBeenCalledWith(expectedRawValue);
  });

  it('el botón de restablecer latencias (clic real) restaura el grupo a DEFAULT_LATENCIES', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.latenciesGroup.get('intMul')!.setValue(999);
    fixture.detectChanges();

    const resetBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.reset-btn');
    resetBtn.click();

    expect(component.latenciesGroup.getRawValue()).toEqual(component.DEFAULT_LATENCIES);
  });

  it('los botones de preset superescalar (clic real) aplican minimal/balanced/aggressive', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.settingsForm.get('processorType')!.setValue('superscalar');
    fixture.detectChanges();

    const presetButtons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('.preset-btn'));
    expect(presetButtons.length).toBe(3);

    presetButtons[0].click(); // minimal
    fixture.detectChanges();
    expect(component.superscalarGroup.getRawValue().rsType).toBe('centralized');

    presetButtons[1].click(); // balanced
    fixture.detectChanges();
    expect(component.superscalarGroup.getRawValue().rsType).toBe('distributed');

    presetButtons[2].click(); // aggressive
    fixture.detectChanges();
    expect(component.superscalarGroup.getRawValue().rsType).toBe('clustered');
  });
});

// El describe de arriba SIEMPRE inyecta MAT_DIALOG_DATA con la config real y completa de
// AsgConfigService, así que el lado "?? valorPorDefecto" / "|| valorPorDefecto" de cada campo
// de ngOnInit() nunca llega a ejecutarse (data siempre trae todos los campos). Este describe usa
// datos vacíos/parciales para ejercitar precisamente esas ramas de fallback.
describe('SettingsComponent (integración) — valores por defecto sin datos previos', () => {
  async function createWithData(data: unknown) {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        integrationTestProviders(),
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('con data=undefined, todos los campos toman su valor por defecto (rama "??"/"||" de ngOnInit)', async () => {
    const fixture = await createWithData(undefined);
    const raw = fixture.componentInstance.settingsForm.getRawValue();

    expect(raw.processorType).toBe('pipelined');
    expect(raw.memorySize).toBe(fixture.componentInstance.LIMITS.memorySize.min);
    expect(raw.enableForwarding).toBe(true);
    expect(raw.enableVectorChaining).toBe(true);
    expect(raw.enableBranchDelaySlot).toBe(false);
    expect(raw.aluLanes).toBe(fixture.componentInstance.LIMITS.aluLanes.min);
    expect(raw.memLanes).toBe(fixture.componentInstance.LIMITS.memLanes.min);
    expect(raw.mvl).toBe(64);
    expect(raw.branchPredictionStrategy).toBe('none');
    expect(raw.ghrBits).toBe(fixture.componentInstance.LIMITS.ghrBits.min);
    expect(raw.loggingEnabled).toBe(true);
    expect(raw.logLevel).toBe('relevant');
    expect(raw.timelineMode).toBe('live');
  });

  it('con data=undefined, el grupo de latencias toma DEFAULT_LATENCIES completo', async () => {
    const fixture = await createWithData(undefined);
    expect(fixture.componentInstance.latenciesGroup.getRawValue()).toEqual(
      fixture.componentInstance.DEFAULT_LATENCIES,
    );
  });

  it('con data=undefined, el grupo superscalar (incluidos los clusters de RS) toma DEFAULT_SUPERSCALAR_CONFIG', async () => {
    const fixture = await createWithData(undefined);
    const raw = fixture.componentInstance.superscalarGroup.getRawValue();

    expect(raw.rsType).toBe(DEFAULT_SUPERSCALAR_CONFIG.rsType);
    expect(raw.issueWidth).toBe(DEFAULT_SUPERSCALAR_CONFIG.issueWidth);
    expect(raw.robSize).toBe(DEFAULT_SUPERSCALAR_CONFIG.robSize);
    expect(raw.cdbWidth).toBe(DEFAULT_SUPERSCALAR_CONFIG.cdbWidth);
    expect(raw.rsClusterSizes).toEqual(DEFAULT_SUPERSCALAR_CONFIG.rsClusterSizes);
    expect(raw.enableVectorInitOverlap).toBe(DEFAULT_SUPERSCALAR_CONFIG.enableVectorInitOverlap);
  });

  it('con data parcial (sin latencies/superscalar), esos grupos también caen a sus valores por defecto', async () => {
    const fixture = await createWithData({ processorType: 'non-pipelined', memorySize: 8192 });
    const raw = fixture.componentInstance.settingsForm.getRawValue();

    expect(raw.processorType).toBe('non-pipelined'); // el único campo presente en `data`
    expect(raw.memorySize).toBe(8192);
    expect(raw.enableForwarding).toBe(true); // resto de campos: fallback por defecto
    expect(raw.latencies).toEqual(fixture.componentInstance.DEFAULT_LATENCIES);
    expect(raw.superscalar.rsType).toBe(DEFAULT_SUPERSCALAR_CONFIG.rsType);
  });

  it('con memorySize=0 en data (valor falsy), memorySize cae al mínimo por defecto (rama "||", no "??")', async () => {
    // Comprobación deliberada del operador usado: memorySize usa `|| this.LIMITS.memorySize.min`,
    // así que un 0 explícito (falsy pero no undefined) también activa el valor por defecto —
    // a diferencia de un campo con `??`, que solo cae al default si es null/undefined.
    const fixture = await createWithData({ memorySize: 0 });
    expect(fixture.componentInstance.memSizeControl!.value).toBe(fixture.componentInstance.LIMITS.memorySize.min);
  });
});
