import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MobileExecButtonsComponent } from '../../src/app/shared/mobile-exec-buttons/mobile-exec-buttons.component';
import { AsgProcessorFactoryService } from '../../src/app/core/services/processor/asg.processor-factory';
import { EditorComponent } from '../../src/app/shared/editor/editor.component';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

/**
 * `MobileExecButtonsComponent` recibe la instancia REAL de `EditorComponent` como `@Input` en
 * producción (ver mobile-main.component.spec.ts, que sí monta un `<app-editor>` real). Aquí, en
 * cambio, usamos un doble ligero con las mismas propiedades públicas que consulta esta barra
 * (`onRun`/`onStop`/`onStep`/`onRunToBreakpoint`/`togglePerformanceMode`/`hasBreakpoints`/
 * `performanceMode`) en lugar de montar Monaco de nuevo: eso ya lo cubre editor.component.spec.ts,
 * y lo que queremos comprobar aquí es la lógica de ESTE componente (a qué delega cada botón, y
 * cómo refleja el estado del procesador REAL), no reimplementar ese test.
 */
function fakeEditor(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    onRun: vi.fn(),
    onStop: vi.fn(),
    onStep: vi.fn(),
    onRunToBreakpoint: vi.fn(),
    togglePerformanceMode: vi.fn(),
    hasBreakpoints: false,
    performanceMode: signal(false),
    ...overrides,
  } as unknown as EditorComponent;
}

describe('MobileExecButtonsComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [MobileExecButtonsComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('togglePlayPause() llama a editor.onRun() cuando el procesador NO está corriendo', () => {
    const fixture = TestBed.createComponent(MobileExecButtonsComponent);
    const editor = fakeEditor();
    fixture.componentRef.setInput('editor', editor);
    fixture.detectChanges();

    const processor = TestBed.inject(AsgProcessorFactoryService).getProcessor();
    expect(processor.isRunning()).toBe(false);

    fixture.componentInstance.togglePlayPause();

    expect(editor.onRun).toHaveBeenCalledTimes(1);
  });

  it('togglePlayPause() llama a processor.pause() (no a editor.onRun) cuando SÍ está corriendo', () => {
    const fixture = TestBed.createComponent(MobileExecButtonsComponent);
    const editor = fakeEditor();
    fixture.componentRef.setInput('editor', editor);
    fixture.detectChanges();

    const processor = TestBed.inject(AsgProcessorFactoryService).getProcessor();
    processor.isRunning.set(true);

    fixture.componentInstance.togglePlayPause();

    expect(editor.onRun).not.toHaveBeenCalled();
    expect(processor.isRunning()).toBe(false); // pause() lo pone a false
  });

  it('el botón principal muestra el icono play/pause y la tooltip según processor.isRunning()', () => {
    const fixture = TestBed.createComponent(MobileExecButtonsComponent);
    fixture.componentRef.setInput('editor', fakeEditor());
    fixture.detectChanges();

    const processor = TestBed.inject(AsgProcessorFactoryService).getProcessor();
    const mainIcon = () => fixture.nativeElement.querySelector('.controls-row button mat-icon');

    expect(mainIcon().textContent.trim()).toBe('play_arrow');

    processor.isRunning.set(true);
    fixture.detectChanges();

    expect(mainIcon().textContent.trim()).toBe('pause');
  });

  it('stop()/step()/runToBreakpoint()/toggleTurbo() delegan en los métodos correspondientes del editor', () => {
    const fixture = TestBed.createComponent(MobileExecButtonsComponent);
    const editor = fakeEditor();
    fixture.componentRef.setInput('editor', editor);
    fixture.detectChanges();

    fixture.componentInstance.stop();
    fixture.componentInstance.step();
    fixture.componentInstance.runToBreakpoint();
    fixture.componentInstance.toggleTurbo();

    expect(editor.onStop).toHaveBeenCalledTimes(1);
    expect(editor.onStep).toHaveBeenCalledTimes(1);
    expect(editor.onRunToBreakpoint).toHaveBeenCalledTimes(1);
    expect(editor.togglePerformanceMode).toHaveBeenCalledTimes(1);
  });

  it('el botón de "run to breakpoint" se deshabilita si editor.hasBreakpoints es false', () => {
    const fixture = TestBed.createComponent(MobileExecButtonsComponent);
    fixture.componentRef.setInput('editor', fakeEditor({ hasBreakpoints: false }));
    fixture.detectChanges();

    // Orden real en la plantilla: play/pause, stop, step, run-to-bp, turbo, reset.
    const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('.controls-row button'));
    const runToBpButton = buttons[3];
    expect(runToBpButton.disabled).toBe(true);
  });

  it('reset() llama a processor.reset() (sin pasar por el editor)', () => {
    const fixture = TestBed.createComponent(MobileExecButtonsComponent);
    const editor = fakeEditor();
    fixture.componentRef.setInput('editor', editor);
    fixture.detectChanges();

    const processor = TestBed.inject(AsgProcessorFactoryService).getProcessor();
    const resetSpy = vi.spyOn(processor, 'reset');

    fixture.componentInstance.reset();

    expect(resetSpy).toHaveBeenCalledTimes(1);
  });

  it('onSpeedChange() llama a processor.updateSpeed() con el valor recibido', () => {
    const fixture = TestBed.createComponent(MobileExecButtonsComponent);
    fixture.componentRef.setInput('editor', fakeEditor());
    fixture.detectChanges();

    const processor = TestBed.inject(AsgProcessorFactoryService).getProcessor();

    fixture.componentInstance.onSpeedChange(250);

    expect(processor.speed()).toBe(250);
  });

  it('formatLabel() añade el sufijo "ms"', () => {
    const fixture = TestBed.createComponent(MobileExecButtonsComponent);
    fixture.componentRef.setInput('editor', fakeEditor());
    fixture.detectChanges();

    expect(fixture.componentInstance.formatLabel(500)).toBe('500ms');
  });

  // Los tests anteriores llaman a los métodos directamente sobre la instancia; los siguientes
  // disparan los eventos DOM reales ((click) en los botones, (change) en el slider) para cubrir
  // los listeners generados por la plantilla.
  it('los botones de la barra de ejecución (clic real) delegan en el método correspondiente', () => {
    const fixture = TestBed.createComponent(MobileExecButtonsComponent);
    const editor = fakeEditor({ hasBreakpoints: true });
    fixture.componentRef.setInput('editor', editor);
    fixture.detectChanges();

    // El botón de stop se deshabilita si processor.cycle() === 0 || processor.isStopped(); un
    // procesador recién creado cumple ambas, así que hay que simular que ya se ha ejecutado algo.
    const processor = TestBed.inject(AsgProcessorFactoryService).getProcessor();
    processor.cycle.set(1);
    fixture.detectChanges();

    // Orden real en la plantilla: play/pause, stop, step, run-to-bp, turbo, reset.
    const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('.controls-row button'));
    expect(buttons).toHaveLength(6);

    buttons[0].click(); // togglePlayPause -> editor.onRun (no está corriendo)
    expect(editor.onRun).toHaveBeenCalledTimes(1);

    buttons[1].click(); // stop
    expect(editor.onStop).toHaveBeenCalledTimes(1);

    buttons[2].click(); // step
    expect(editor.onStep).toHaveBeenCalledTimes(1);

    buttons[3].click(); // runToBreakpoint
    expect(editor.onRunToBreakpoint).toHaveBeenCalledTimes(1);

    buttons[4].click(); // toggleTurbo
    expect(editor.togglePerformanceMode).toHaveBeenCalledTimes(1);

    const resetSpy = vi.spyOn(processor, 'reset');
    buttons[5].click(); // reset
    expect(resetSpy).toHaveBeenCalledTimes(1);
  });

  it('mover el slider de velocidad (evento change real) llama a processor.updateSpeed()', () => {
    const fixture = TestBed.createComponent(MobileExecButtonsComponent);
    fixture.componentRef.setInput('editor', fakeEditor());
    fixture.detectChanges();

    const processor = TestBed.inject(AsgProcessorFactoryService).getProcessor();
    const thumbInput: HTMLInputElement = fixture.nativeElement.querySelector('input[matSliderThumb]');
    expect(thumbInput).toBeTruthy();

    thumbInput.value = '250';
    thumbInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(processor.speed()).toBe(250);
  });
});
