// `monaco-editor` comprueba document.queryCommandSupported en la carga del módulo (efecto
// secundario a nivel de import, no diferido) — jsdom no lo implementa. `vi.hoisted()` se ejecuta
// ANTES que los imports de abajo (incluido el transitivo a monaco-editor vía EditorComponent),
// así que el polyfill llega a tiempo.
vi.hoisted(() => {
  if (typeof document !== 'undefined' && typeof (document as any).queryCommandSupported !== 'function') {
    (document as any).queryCommandSupported = () => false;
  }
});

import { TestBed } from '@angular/core/testing';
import { EditorComponent } from '../../src/app/shared/editor/editor.component';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

// IMPORTANTE — alcance deliberadamente limitado: `ngAfterViewInit()` difiere la creación del
// editor Monaco real a un `setTimeout(() => this.initMonaco(), 0)`. `monaco.editor.create(...)`
// hace medición de layout real y usa `ResizeObserver` (vía `automaticLayout: true`), que jsdom no
// implementa de forma fiable — intentar "flushear" ese timeout (fakeAsync/tick, o await de un
// setTimeout real) arriesga hacer fallar el test por limitaciones del entorno, no por un bug real.
// Por eso este test SOLO comprueba lo que ocurre ANTES de que ese timeout se dispare: mientras no
// se avance el reloj de forma explícita, `initMonaco()` nunca se ejecuta y el componente debe
// poder montarse, leer sus signals derivados del procesador y destruirse sin lanzar. La cobertura
// de la lógica interna de Monaco (breakpoints, decoraciones, pestañas...) queda fuera a propósito.
describe('EditorComponent (integración, smoke — sin inicializar Monaco)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    // Temporizadores falsos: ngAfterViewInit() programa `setTimeout(() => initMonaco(), 0)` con un
    // timer REAL. Sin fake timers, ese timeout se dispara igualmente en el reloj real de Node
    // mientras el resto de tests sigue ejecutándose (no basta con "no flushearlo" a mano), y
    // monaco.editor.create() revienta en jsdom de forma asíncrona e incontrolada. Con fake timers,
    // el callback queda pendiente y se descarta sin más al terminar el test.
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [EditorComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('se crea y hace detectChanges() sin lanzar, sin haberse inicializado Monaco todavía', () => {
    const fixture = TestBed.createComponent(EditorComponent);
    TestBed.tick();

    expect(() => fixture.detectChanges()).not.toThrow();

    const component = fixture.componentInstance as any;
    // ngAfterViewInit ya se disparó (detectChanges lo ejecuta), pero initMonaco() sigue en la cola
    // del setTimeout(0) sin flushear, así que `tabs`/`editor` deben seguir en su estado inicial.
    expect(component.tabs()).toEqual([]);
    expect(component.editor).toBeUndefined();
  });

  it('expone currentPC/currentSpeed/performanceMode derivados del procesador activo', () => {
    const fixture = TestBed.createComponent(EditorComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    expect(component.currentPC()).toBe(100); // PC inicial/reset de este simulador: 0x64
    expect(typeof component.currentSpeed()).toBe('number');
    expect(component.performanceMode()).toBe(false);
  });

  it('se destruye sin lanzar (ngOnDestroy con tabs()/editor aún vacíos)', () => {
    const fixture = TestBed.createComponent(EditorComponent);
    TestBed.tick();
    fixture.detectChanges();

    expect(() => fixture.destroy()).not.toThrow();
  });

  it('hideControls=false (por defecto) muestra la barra de herramientas de ejecución', () => {
    const fixture = TestBed.createComponent(EditorComponent);
    TestBed.tick();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.modern-toolbar')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.editor-window').classList.contains('no-toolbar')).toBe(false);
  });

  it('hideControls=true oculta la barra de herramientas (la sustituye la barra flotante de controles del layout móvil)', () => {
    const fixture = TestBed.createComponent(EditorComponent);
    fixture.componentRef.setInput('hideControls', true);
    TestBed.tick();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.modern-toolbar')).toBeNull();
    expect(fixture.nativeElement.querySelector('.editor-window').classList.contains('no-toolbar')).toBe(true);
  });
});
