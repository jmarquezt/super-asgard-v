// MobileMainComponent renderiza <app-editor> (real, sin mockear) como una de sus 4 páginas —
// mismo problema que en editor.component.spec.ts / main.component.spec.ts: monaco-editor
// comprueba document.queryCommandSupported al importarse, y jsdom no lo implementa.
vi.hoisted(() => {
  if (typeof document !== 'undefined' && typeof (document as any).queryCommandSupported !== 'function') {
    (document as any).queryCommandSupported = () => false;
  }
});

import { TestBed } from '@angular/core/testing';
import { MobileMainComponent } from '../../src/app/features/mobile-main/mobile-main.component';
import { AsgConfigService } from '../../src/app/core/services/asg.config';
import { AsgPipelinedProcessorService } from '../../src/app/core/services/processor/asg.pipelined.processor';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

// No necesita mockMatchMedia: a diferencia de MainComponent, MobileMainComponent no inyecta
// BreakpointObserver — se instancia directamente aquí (como haría MainComponent una vez decidido
// que estamos en móvil), sin depender de ningún breakpoint.
describe('MobileMainComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    // Igual que en editor.component.spec.ts: initMonaco() queda diferido a un setTimeout(0) real;
    // con fake timers ese timeout nunca se flushea y monaco.editor.create() nunca llega a correr.
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [MobileMainComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function pages(fixture: any): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.page'));
  }

  it('se crea sin lanzar, con la pestaña "editor" activa por defecto (única página visible)', () => {
    const fixture = TestBed.createComponent(MobileMainComponent);
    TestBed.tick();

    expect(() => fixture.detectChanges()).not.toThrow();

    const component = fixture.componentInstance as any;
    expect(component.activeTab()).toBe('editor');

    const [editorPage, executionPage, registersPage, statsPage] = pages(fixture);
    expect((editorPage as HTMLElement).hidden).toBe(false);
    expect((executionPage as HTMLElement).hidden).toBe(true);
    expect((registersPage as HTMLElement).hidden).toBe(true);
    expect((statsPage as HTMLElement).hidden).toBe(true);
  });

  it('el editor montado recibe hideControls=true (la barra de ejecución la sustituye la barra de controloes flotante)', () => {
    const fixture = TestBed.createComponent(MobileMainComponent);
    TestBed.tick();
    fixture.detectChanges();

    // hideControls oculta la <mat-toolbar> dentro de app-editor (ver editor.component.spec.ts).
    expect(fixture.nativeElement.querySelector('app-editor .modern-toolbar')).toBeNull();
  });

  it('selectTab() cambia qué página queda visible ([hidden] se alterna) para cada pestaña', () => {
    const fixture = TestBed.createComponent(MobileMainComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance as any;

    (['execution', 'registers', 'stats', 'editor'] as const).forEach(tab => {
      component.selectTab(tab);
      fixture.detectChanges();

      expect(component.activeTab()).toBe(tab);
      const visiblePages = pages(fixture).filter(p => !p.hidden);
      expect(visiblePages).toHaveLength(1);
    });
  });

  it('la navegación inferior tiene 4 botones y marca como activo el de la pestaña actual', () => {
    const fixture = TestBed.createComponent(MobileMainComponent);
    TestBed.tick();
    fixture.detectChanges();

    const navButtons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('.nav-btn'));
    expect(navButtons).toHaveLength(4);
    expect(navButtons.filter(b => b.classList.contains('active'))).toHaveLength(1);

    navButtons[2].click(); // 'registers'
    fixture.detectChanges();

    expect((fixture.componentInstance as any).activeTab()).toBe('registers');
    expect(navButtons[2].classList.contains('active')).toBe(true);
  });

  it('cada botón de la navegación inferior (clic real) selecciona su propia pestaña', () => {
    const fixture = TestBed.createComponent(MobileMainComponent);
    TestBed.tick();
    fixture.detectChanges();

    const navButtons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('.nav-btn'));
    const component = fixture.componentInstance as any;

    navButtons[1].click(); // 'execution'
    fixture.detectChanges();
    expect(component.activeTab()).toBe('execution');

    navButtons[3].click(); // 'stats'
    fixture.detectChanges();
    expect(component.activeTab()).toBe('stats');

    navButtons[0].click(); // 'editor'
    fixture.detectChanges();
    expect(component.activeTab()).toBe('editor');
  });

  it('memories devuelve [dataMemory, instructionsMemory] del procesador activo', () => {
    const fixture = TestBed.createComponent(MobileMainComponent);
    TestBed.tick();
    fixture.detectChanges();

    const processor = TestBed.inject(AsgPipelinedProcessorService);
    const memories = (fixture.componentInstance as any).memories;

    expect(memories).toHaveLength(2);
    expect(memories[0]).toBe(processor.dataMemory);
    expect(memories[1]).toBe(processor.instructionsMemory);
  });

  it('en superescalar, la pestaña "registros" añade ROB/RS/CDB además de registros y memoria', () => {
    const fixture = TestBed.createComponent(MobileMainComponent);
    TestBed.tick();
    TestBed.inject(AsgConfigService).updateConfig({ processorType: 'superscalar' });
    fixture.detectChanges();

    (fixture.componentInstance as any).selectTab('registers');
    fixture.detectChanges();

    expect((fixture.componentInstance as any).isSuperscalar).toBe(true);
    expect(fixture.nativeElement.querySelector('app-registers-view')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-memory-view-group')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-rob-view')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-rs-view')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-cdb-view')).not.toBeNull();
  });

  it('en superescalar, la pestaña "ejecución" usa app-superscalar-pipeline-view en vez de app-pipeline-view', () => {
    const fixture = TestBed.createComponent(MobileMainComponent);
    TestBed.tick();
    TestBed.inject(AsgConfigService).updateConfig({ processorType: 'superscalar' });
    fixture.detectChanges();

    (fixture.componentInstance as any).selectTab('execution');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-superscalar-pipeline-view')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-pipeline-view')).toBeNull();
  });

  it('la barra flotante de controles de ejecución se renderiza una vez resuelto el viewChild del editor', () => {
    const fixture = TestBed.createComponent(MobileMainComponent);
    TestBed.tick();
    fixture.detectChanges();

    expect((fixture.componentInstance as any).editor()).toBeDefined();
    expect(fixture.nativeElement.querySelector('app-mobile-exec-buttons')).not.toBeNull();
  });
});
