// Ver el comentario equivalente en editor.component.spec.ts: MainComponent renderiza <app-editor>,
// que importa monaco-editor a nivel de módulo — jsdom no implementa document.queryCommandSupported.
vi.hoisted(() => {
  if (typeof document !== 'undefined' && typeof (document as any).queryCommandSupported !== 'function') {
    (document as any).queryCommandSupported = () => false;
  }
});

import { TestBed } from '@angular/core/testing';
import { MainComponent } from '../../src/app/features/main/main.component';
import { AsgConfigService } from '../../src/app/core/services/asg.config';
import { AsgPipelinedProcessorService } from '../../src/app/core/services/processor/asg.pipelined.processor';
import { AsgSuperscalarProcessorService } from '../../src/app/core/services/processor/asg.superscalar.processor';
import { integrationTestProviders, resetIntegrationEnvironment, mockMatchMedia } from './test-providers';

// Monta TODOS los componentes hijo a la vez (editor, registers-view, event-view, stats-view o
// superscalar-stats-view, pipeline-view o superscalar-pipeline-view, timeline-view,
// console-view, memory-view-group y, en superescalar, rob/rs/cdb-view). El riesgo de Monaco
// (ver editor.component.spec.ts) no aplica aquí: su inicialización real queda diferida a un
// setTimeout(0) que este test nunca flushea, así que sigue sin ejecutarse dentro de <app-editor>.
describe('MainComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    // Por defecto simulamos escritorio (ninguna media query "coincide"): así los tests ya
    // existentes, escritos antes de que MainComponent dependiera de BreakpointObserver, siguen
    // ejercitando el dashboard de columnas sin tener que tocarlos uno a uno.
    mockMatchMedia(false);
    // Ver el comentario equivalente en editor.component.spec.ts: sin fake timers, el
    // setTimeout(0) de <app-editor> se dispara de verdad en el reloj real de Node y
    // monaco.editor.create() revienta en jsdom de forma asíncrona e incontrolada.
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [MainComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('se crea y renderiza el layout completo (pipelined) sin lanzar', () => {
    const fixture = TestBed.createComponent(MainComponent);
    TestBed.tick();

    expect(() => fixture.detectChanges()).not.toThrow();

    const component = fixture.componentInstance as any;
    expect(component.isSuperscalar).toBe(false);
    expect(fixture.nativeElement.querySelector('app-editor')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-pipeline-view')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-superscalar-pipeline-view')).toBeNull();
  });

  it('memories devuelve [dataMemory, instructionsMemory] del procesador activo', () => {
    const fixture = TestBed.createComponent(MainComponent);
    TestBed.tick();
    fixture.detectChanges();

    const processor = TestBed.inject(AsgPipelinedProcessorService);
    const component = fixture.componentInstance as any;
    const memories = component.memories;

    expect(memories).toHaveLength(2);
    expect(memories[0]).toBe(processor.dataMemory);
    expect(memories[1]).toBe(processor.instructionsMemory);
  });

  it('al cambiar a superescalar, isSuperscalar pasa a true y se renderizan las vistas superescalares', () => {
    const fixture = TestBed.createComponent(MainComponent);
    TestBed.tick();
    TestBed.inject(AsgConfigService).updateConfig({ processorType: 'superscalar' });
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    expect(component.isSuperscalar).toBe(true);

    const processor = TestBed.inject(AsgSuperscalarProcessorService);
    expect(component.memories[0]).toBe(processor.dataMemory);

    expect(fixture.nativeElement.querySelector('app-superscalar-pipeline-view')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-pipeline-view')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-rob-view')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-rs-view')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-cdb-view')).not.toBeNull();
  });

  it('isMobile() es false por defecto (matchMedia mockeado a "no coincide") y renderiza el dashboard', () => {
    const fixture = TestBed.createComponent(MainComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    expect(component.isMobile()).toBe(false);
    expect(fixture.nativeElement.querySelector('.dashboard-layout')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-mobile-main')).toBeNull();
  });

  it('cuando Breakpoints.Handset coincide, isMobile() es true y se renderiza app-mobile-main en lugar del dashboard', () => {
    // Sobrescribimos el mock de matchMedia del beforeEach ANTES de crear el componente: el valor
    // inicial del signal `isMobile` (toSignal con `initialValue: breakpointObserver.isMatched(...)`)
    // se calcula de forma síncrona en el constructor, así que tiene que estar en su sitio a tiempo.
    mockMatchMedia(true);

    const fixture = TestBed.createComponent(MainComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    expect(component.isMobile()).toBe(true);
    expect(fixture.nativeElement.querySelector('app-mobile-main')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.dashboard-layout')).toBeNull();
  });
});
