import { TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { StaticSchedulingDialogComponent } from '../../src/app/shared/static-scheduling-dialog/static-scheduling-dialog.component';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

// Fuente real reutilizada de tests/functional/static-scheduler.spec.ts, ya verificada allí como
// válida para AsgStaticSchedulerService.optimize() (conserva el resultado arquitectónico final).
const SOURCE = `
  .data
  .align 3
  A: .double 10.5
  B: .double 2.5
  C: .double 5.0
  X: .double 0.0

  .text
  main:
      ld f2, A
      ld f4, B
      multd f6, f2, f4
      addi r1, r0, #100
      addi r2, r0, #200
      ld f8, C
      addd f10, f6, f8
      sd X, f10
`;

describe('StaticSchedulingDialogComponent (integración)', () => {
  let dialogRefCloseSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    resetIntegrationEnvironment();
    dialogRefCloseSpy = vi.fn();
    await TestBed.configureTestingModule({
      imports: [StaticSchedulingDialogComponent],
      providers: [
        integrationTestProviders(),
        { provide: MatDialogRef, useValue: { close: dialogRefCloseSpy } },
        { provide: MAT_DIALOG_DATA, useValue: { source: SOURCE } },
      ],
    }).compileComponents();
  });

  it('se crea sin lanzar errores y guarda el código original recibido en data.source', () => {
    const fixture = TestBed.createComponent(StaticSchedulingDialogComponent);
    expect(() => fixture.detectChanges()).not.toThrow();

    const component = fixture.componentInstance;
    expect(component).toBeTruthy();
    expect(component.originalCode).toBe(SOURCE);
  });

  it('optimizeResult() refleja la salida real de AsgStaticSchedulerService para la config por defecto', () => {
    const fixture = TestBed.createComponent(StaticSchedulingDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const result = component.optimizeResult();

    expect(result.error).toBeUndefined();
    expect(typeof result.code).toBe('string');
    expect(result.code.length).toBeGreaterThan(0);
    expect(Array.isArray(result.lines)).toBe(true);
    expect(component.hasError()).toBe(false);
  });

  it('actualizar config() (updateConfig) con enableScheduling en false cambia optimizeResult()', () => {
    const fixture = TestBed.createComponent(StaticSchedulingDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const before = component.optimizeResult();
    // Con enableScheduling en true (config por defecto) el programa de ejemplo tiene instrucciones
    // independientes (los addi) que el scheduler puede adelantar para rellenar la espera de multd/addd.
    expect(before.reorderedCount + before.insertedCount).toBeGreaterThan(0);

    component.updateConfig({ enableScheduling: false });
    const after = component.optimizeResult();

    // Con todas las optimizaciones desactivadas (scheduling incluido, unrolling/renaming/delayed
    // branch ya estaban en false por defecto) el scheduler no reordena ni inserta nada.
    expect(after.reorderedCount).toBe(0);
    expect(after.insertedCount).toBe(0);
    expect(after.code).not.toBe(before.code);
  });

  it('apply() cierra el diálogo con optimizeResult().code', () => {
    const fixture = TestBed.createComponent(StaticSchedulingDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const expectedCode = component.optimizeResult().code;
    component.apply();

    expect(dialogRefCloseSpy).toHaveBeenCalledWith(expectedCode);
  });

  it('enableUnrolling con unrollFactor:2 desenrolla el bucle y aumenta el número de líneas del código', () => {
    // Fuente reutilizada de tests/functional/static-scheduler.spec.ts (test de unrolling), ya
    // verificada allí como válida y con un bucle que el scheduler sabe desenrollar.
    const UNROLL_SOURCE = `
      .data
      .align 3
      arr: .double 1.0, 2.0, 3.0, 4.0

      .text
      main:
          addi r1, r0, arr      ; r1 = dirección de arr
          addi r6, r0, #32      ; límite = arr + 32 (justo pasado el último elemento)
          addi r9, r0, #0
          movi2fp f4, r9
          cvti2d f4, f4          ; acumulador = 0.0
      loop:
          ld f2, 0(r1)
          addd f4, f4, f2
          addi r1, r1, #8
          sub r7, r1, r6
          bnez r7, loop
    `;

    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { source: UNROLL_SOURCE } });
    const fixture = TestBed.createComponent(StaticSchedulingDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const before = component.optimizeResult();

    component.updateConfig({ enableUnrolling: true, unrollFactor: 2, enableScheduling: false });
    const after = component.optimizeResult();

    expect(after.error).toBeUndefined();
    expect(after.code.split('\n').length).toBeGreaterThan(before.code.split('\n').length);
  });

  it('enableDelayedBranch rellena el delay slot del salto (reordena o inserta una línea)', () => {
    // Fuente reutilizada de tests/functional/static-scheduler.spec.ts (test de delay slot).
    const DELAY_SOURCE = `
      .text
      main:
          addi r1, r0, #10
          addi r2, r0, #20
          add r3, r1, r2
          j end
      end:
          addi r4, r0, #1
    `;

    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { source: DELAY_SOURCE } });
    const fixture = TestBed.createComponent(StaticSchedulingDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.updateConfig({ enableDelayedBranch: true, enableScheduling: false });
    const result = component.optimizeResult();

    expect(result.error).toBeUndefined();
    expect(result.reorderedCount + result.insertedCount).toBeGreaterThan(0);
  });

  it('enableRegisterRenaming renombra un registro con un hazard WAR dentro del bloque', () => {
    // R1 se lee (en "add r2, r1, r0") después de que "addi r1, r0, #2" vaya a reescribirlo:
    // hazard WAR sobre R1 que el renombrado estático debe resolver usando otro registro libre.
    const RENAME_SOURCE = `
      .text
      main:
          addi r1, r0, #1
          add  r2, r1, r0
          addi r1, r0, #2
          add  r5, r1, r0
    `;

    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { source: RENAME_SOURCE } });
    const fixture = TestBed.createComponent(StaticSchedulingDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.updateConfig({ enableRegisterRenaming: true, enableScheduling: false });
    const result = component.optimizeResult();

    expect(result.error).toBeUndefined();
    expect(result.reorderedCount).toBeGreaterThan(0);
  });

  it('un error de análisis léxico se refleja en optimizeResult().error, hasError() y originalAnnotatedLines()', () => {
    const INVALID_SOURCE = '      addi r1, r0, @@@\n';

    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { source: INVALID_SOURCE } });
    const fixture = TestBed.createComponent(StaticSchedulingDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const result = component.optimizeResult();

    expect(typeof result.error).toBe('string');
    expect(component.hasError()).toBe(true);
    // En caso de error, las líneas anotadas son simplemente el código original sin marcar como movido.
    const annotated = component.originalAnnotatedLines();
    expect(annotated.every(l => l.movedOut === false)).toBe(true);
    expect(annotated.map(l => l.text)).toEqual(INVALID_SOURCE.split('\n'));
  });

  it('cancel() cierra el diálogo con null', () => {
    const fixture = TestBed.createComponent(StaticSchedulingDialogComponent);
    fixture.detectChanges();

    fixture.componentInstance.cancel();

    expect(dialogRefCloseSpy).toHaveBeenCalledWith(null);
  });

  // Los tests anteriores llaman a updateConfig()/apply()/cancel() directamente sobre la
  // instancia; los siguientes disparan los eventos DOM reales ((change) en los slide-toggle,
  // (ngModelChange) en el input de factor, (click) en los botones) para cubrir esos listeners.
  it('pulsar cada slide-toggle (clic real) actualiza su flag en config()', () => {
    const fixture = TestBed.createComponent(StaticSchedulingDialogComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    // Orden real en la plantilla: scheduling, unrolling, register-renaming, delayed-branch.
    const toggles: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('mat-slide-toggle button.mdc-switch'),
    );
    expect(toggles.length).toBe(4);

    expect(component.config().enableScheduling).toBe(true);
    toggles[0].click();
    fixture.detectChanges();
    expect(component.config().enableScheduling).toBe(false);

    expect(component.config().enableUnrolling).toBe(false);
    toggles[1].click();
    fixture.detectChanges();
    expect(component.config().enableUnrolling).toBe(true);

    expect(component.config().enableRegisterRenaming).toBe(false);
    toggles[2].click();
    fixture.detectChanges();
    expect(component.config().enableRegisterRenaming).toBe(true);

    expect(component.config().enableDelayedBranch).toBe(false);
    toggles[3].click();
    fixture.detectChanges();
    expect(component.config().enableDelayedBranch).toBe(true);
  });

  it('escribir el factor de desenrollado (evento input real) actualiza config().unrollFactor', () => {
    const fixture = TestBed.createComponent(StaticSchedulingDialogComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.updateConfig({ enableUnrolling: true });
    fixture.detectChanges();

    const factorInput: HTMLInputElement = fixture.nativeElement.querySelector('.small-input input');
    expect(factorInput).toBeTruthy();
    factorInput.value = '4';
    factorInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component.config().unrollFactor).toBe(4);
  });

  it('el botón cancelar (clic real) cierra el diálogo con null', () => {
    const fixture = TestBed.createComponent(StaticSchedulingDialogComponent);
    fixture.detectChanges();

    const cancelBtn = Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button'))
      .find((b: any) => b.textContent?.includes('COMMON.CANCEL')) as HTMLButtonElement;
    expect(cancelBtn).toBeTruthy();
    cancelBtn.click();

    expect(dialogRefCloseSpy).toHaveBeenCalledWith(null);
  });

  it('el botón "usar optimizado" (clic real) cierra el diálogo con el código optimizado', () => {
    const fixture = TestBed.createComponent(StaticSchedulingDialogComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const expectedCode = component.optimizeResult().code;

    const applyBtn = Array.from(fixture.nativeElement.querySelectorAll('mat-dialog-actions button'))
      .find((b: any) => b.textContent?.includes('STATIC_SCHEDULER.USE_OPTIMIZED')) as HTMLButtonElement;
    expect(applyBtn).toBeTruthy();
    applyBtn.click();

    expect(dialogRefCloseSpy).toHaveBeenCalledWith(expectedCode);
  });
});
