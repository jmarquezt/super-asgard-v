import { TestBed } from '@angular/core/testing';
import { TimelineViewComponent } from '../../src/app/shared/timeline-view/timeline-view.component';
import { AsgConfigService } from '../../src/app/core/services/asg.config';
import { AsgAssemblerService } from '../../src/app/core/services/assembly/asg.assembler';
import { AsgPipelinedProcessorService } from '../../src/app/core/services/processor/asg.pipelined.processor';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

/** Ensambla y carga un programa mínimo en el procesador pipelined, sin ejecutar ningún ciclo. */
function loadTinyProgram(): AsgPipelinedProcessorService {
  const assembler = TestBed.inject(AsgAssemblerService);
  const processor = TestBed.inject(AsgPipelinedProcessorService);
  TestBed.tick();
  const result = assembler.assembleProgram([{
    name: 'main',
    source: `
      .text
          addi r1, r0, #5
          addi r2, r0, #10
          add  r3, r1, r2
          trap 0
    `,
  }]);
  if (!result.success) {
    throw new Error(`Fallo de ensamblado: ${result.message} (línea ${result.errorLine})`);
  }
  processor.load(result.instructionBinary, result.dataBuffer, result.initialCodePtr);
  return processor;
}

// No se ejercitan onExportCSV()/onExportPNG(): disparan descarga de fichero / dibujado en canvas,
// arriesgado en jsdom y sin valor añadido sobre comprobar la lógica pura del componente.
describe('TimelineViewComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [TimelineViewComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('sin ciclos ejecutados, hasData() es false y no hay datos que mostrar', () => {
    const fixture = TestBed.createComponent(TimelineViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    expect(component.hasData()).toBe(false);
    expect(component.displayTimeline()).toEqual([]);
    expect(component.displayCycles()).toEqual([]);
  });

  it('con timelineMode "disabled", displayTimeline()/displayCycles() están siempre vacíos', () => {
    const fixture = TestBed.createComponent(TimelineViewComponent);
    TestBed.tick();
    TestBed.inject(AsgConfigService).updateConfig({ timelineMode: 'disabled' });
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    expect(component.displayTimeline()).toEqual([]);
    expect(component.displayCycles()).toEqual([]);
  });

  it('con timelineMode "on-finish", no muestra datos mientras el procesador no ha terminado', () => {
    const fixture = TestBed.createComponent(TimelineViewComponent);
    TestBed.tick();
    TestBed.inject(AsgConfigService).updateConfig({ timelineMode: 'on-finish' });
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    const processor = loadTinyProgram();
    processor.nextCycle();
    fixture.detectChanges();

    expect(component.hasData()).toBe(true);
    expect(component.displayTimeline()).toEqual([]);
    expect(component.displayCycles()).toEqual([]);
    expect(component.showLiveOff()).toBe(true);
    expect(component.showDisabled()).toBe(false);
  });

  it('con timelineMode "on-finish", muestra los datos una vez el procesador ha terminado', () => {
    const fixture = TestBed.createComponent(TimelineViewComponent);
    TestBed.tick();
    TestBed.inject(AsgConfigService).updateConfig({ timelineMode: 'on-finish' });
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    const processor = loadTinyProgram();
    let guard = 0;
    while (!processor.isFinished() && guard < 100) {
      processor.nextCycle();
      guard++;
    }
    // isFinished() es un cálculo derivado (PC + pipeline vacío), NO la signal `finished` que lee
    // el componente — esa signal solo se pone a true dentro de run() (auto-play). Al avanzar
    // ciclos a mano con nextCycle(), como aquí, hay que fijarla explícitamente para simular lo
    // que run() habría hecho al detectar el fin del programa.
    processor.finished.set(true);
    fixture.detectChanges();

    expect(processor.isFinished()).toBe(true);
    expect(component.displayTimeline().length).toBeGreaterThan(0);
    expect(component.displayCycles().length).toBeGreaterThan(0);
    expect(component.showLiveOff()).toBe(false);
  });

  it('con timelineMode "disabled" y ciclos ejecutados, showDisabled() es true', () => {
    const fixture = TestBed.createComponent(TimelineViewComponent);
    TestBed.tick();
    TestBed.inject(AsgConfigService).updateConfig({ timelineMode: 'disabled' });
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    const processor = loadTinyProgram();
    processor.nextCycle();
    fixture.detectChanges();

    expect(component.showDisabled()).toBe(true);
    expect(component.displayTimeline()).toEqual([]);
    expect(component.displayCycles()).toEqual([]);
  });

  it('con timelineMode "live", muestra datos en cada ciclo sin lanzar excepciones', () => {
    const fixture = TestBed.createComponent(TimelineViewComponent);
    TestBed.tick();
    TestBed.inject(AsgConfigService).updateConfig({ timelineMode: 'live' });
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    const processor = loadTinyProgram();

    expect(() => {
      processor.nextCycle();
      fixture.detectChanges();
      TestBed.tick();
    }).not.toThrow();

    expect(component.displayTimeline().length).toBeGreaterThan(0);
    expect(component.displayCycles()).toEqual([1]);
  });

  describe('cellClass()', () => {
    let component: any;

    beforeEach(() => {
      const fixture = TestBed.createComponent(TimelineViewComponent);
      TestBed.tick();
      fixture.detectChanges();
      component = fixture.componentInstance;
    });

    it('devuelve "cell" para una etapa indefinida', () => {
      expect(component.cellClass(undefined)).toBe('cell');
    });

    it('clasifica las fases vectoriales (Init/Proc/Wait/WaitFU/End)', () => {
      expect(component.cellClass('Init[3]')).toBe('cell EX vector-init');
      expect(component.cellClass('Proc[12]')).toBe('cell EX vector-processing');
      expect(component.cellClass('Wait[0]')).toBe('cell EX vector-wait');
      expect(component.cellClass('WaitFU')).toBe('cell EX vector-wait-fu');
      expect(component.cellClass('End[1]')).toBe('cell EX vector-end');
    });

    it('clasifica latencia inicial tipo "EX[3]" y elementos tipo "MEM(1)"', () => {
      expect(component.cellClass('EX[3]')).toBe('cell EX latency');
      expect(component.cellClass('MEM[2]')).toBe('cell MEM latency');
      expect(component.cellClass('EX(0)')).toBe('cell EX vector');
      expect(component.cellClass('MEM(1)')).toBe('cell MEM vector');
    });

    it('devuelve "cell <stage>" para una etapa simple sin corchetes/paréntesis', () => {
      expect(component.cellClass('IF')).toBe('cell IF');
      expect(component.cellClass('WB')).toBe('cell WB');
    });
  });

  describe('isStallCell()', () => {
    let component: any;

    beforeEach(() => {
      const fixture = TestBed.createComponent(TimelineViewComponent);
      TestBed.tick();
      fixture.detectChanges();
      component = fixture.componentInstance;
    });

    it('es true cuando ID se repite en dos ciclos consecutivos (stall)', () => {
      const row = { stages: { 1: 'ID', 2: 'ID' } };
      expect(component.isStallCell(row, 2)).toBe(true);
    });

    it('es false cuando la etapa avanza de IF a ID', () => {
      const row = { stages: { 1: 'IF', 2: 'ID' } };
      expect(component.isStallCell(row, 2)).toBe(false);
    });

    it('es false para etapas que no son IF/ID aunque se repitan', () => {
      const row = { stages: { 1: 'EX', 2: 'EX' } };
      expect(component.isStallCell(row, 2)).toBe(false);
    });
  });

  describe('funciones de trackBy', () => {
    let component: any;

    beforeEach(() => {
      const fixture = TestBed.createComponent(TimelineViewComponent);
      TestBed.tick();
      fixture.detectChanges();
      component = fixture.componentInstance;
    });

    it('trackByCycle() devuelve el propio número de ciclo', () => {
      expect(component.trackByCycle(0, 5)).toBe(5);
    });

    it('trackByRow() devuelve el id de la fila', () => {
      expect(component.trackByRow(0, { id: 42 })).toBe(42);
    });
  });
});
