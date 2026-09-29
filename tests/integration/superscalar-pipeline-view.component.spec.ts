import { TestBed } from '@angular/core/testing';
import { SuperscalarPipelineViewComponent } from '../../src/app/shared/superscalar-pipeline-view/superscalar-pipeline-view.component';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('SuperscalarPipelineViewComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [SuperscalarPipelineViewComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea y todas las etapas (IF, ID, II, EX, WR, RI) están vacías por defecto', () => {
    const fixture = TestBed.createComponent(SuperscalarPipelineViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const stages = component.stages();
    expect(stages.IF).toEqual([]);
    expect(stages.ID).toEqual([]);
    expect(stages.II).toEqual([]);
    expect(stages.EX).toEqual([]);
    expect(stages.WR).toEqual([]);
    expect(stages.RI).toEqual([]);
  });

  it('renderiza las 6 columnas de etapa, cada una mostrando el mensaje vacío', () => {
    const fixture = TestBed.createComponent(SuperscalarPipelineViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const stageColumns = fixture.nativeElement.querySelectorAll('.stage-column');
    expect(stageColumns.length).toBe(6);

    const emptyMsgs = fixture.nativeElement.querySelectorAll('.empty-msg');
    expect(emptyMsgs.length).toBe(6);
  });

  it('ninguna de las cajas de etapa tiene la clase "active" cuando no hay instrucciones en vuelo', () => {
    const fixture = TestBed.createComponent(SuperscalarPipelineViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const activeStages = fixture.nativeElement.querySelectorAll('.stage-box.active');
    expect(activeStages.length).toBe(0);
  });

  it('stages() agrupa instrucciones en vuelo reales en cada una de las etapas IF/ID/II/EX/WR', () => {
    const fixture = TestBed.createComponent(SuperscalarPipelineViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const processor = component.processor;

    // Inyectamos instrucciones sintéticas en cada estado del pipeline directamente en el mapa
    // público `inFlight` (evita tener que ensamblar/ejecutar un programa real para poblar cada
    // etapa de forma determinista).
    processor.inFlight.set(1, { state: 'FETCHED' } as any);
    processor.inFlight.set(2, { state: 'DECODED' } as any);
    processor.inFlight.set(3, { state: 'DISPATCHED' } as any);
    processor.inFlight.set(4, { state: 'ISSUED' } as any);
    processor.inFlight.set(5, { state: 'EXECUTING' } as any);
    processor.inFlight.set(6, { state: 'FINISHED', cycleWR: null } as any);
    processor.inFlight.set(7, { state: 'FINISHED', cycleWR: 3 } as any);
    // El computed depende del signal `cycle`: hay que incrementarlo para invalidar la caché
    // y forzar el recálculo con el contenido ya actualizado de `inFlight`.
    processor.cycle.set(processor.cycle() + 1);

    const stages = component.stages();
    expect(stages.IF.length).toBe(1);
    expect(stages.ID.length).toBe(1);
    expect(stages.II.length).toBe(2); // DISPATCHED + ISSUED
    expect(stages.EX.length).toBe(2); // EXECUTING + FINISHED sin cycleWR
    expect(stages.WR.length).toBe(1); // FINISHED con cycleWR ya asignado
  });

  it('stages().RI se vacía cuando el procesador ha terminado, aunque haya instrucciones retiradas en el último ciclo', () => {
    const fixture = TestBed.createComponent(SuperscalarPipelineViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const processor = component.processor;

    processor.lastRetiredInFlight = [{ state: 'RETIRED' } as any];
    processor.finished.set(true);
    processor.cycle.set(processor.cycle() + 1);

    const stages = component.stages();
    expect(stages.RI).toEqual([]);
  });

  it('renderiza el contenido real de cada instr-mini (opcode, ROB, RS, fase, latencia) en el DOM', () => {
    const fixture = TestBed.createComponent(SuperscalarPipelineViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const processor = component.processor;

    processor.inFlight.set(1, { id: 1, state: 'FETCHED', instr: { opcode: 'ADDI', isVector: false } } as any);
    processor.inFlight.set(2, { id: 2, state: 'DECODED', instr: { opcode: 'ADD', isVector: false }, robTag: { slot: 3 } } as any);
    processor.inFlight.set(3, { id: 3, state: 'DISPATCHED', instr: { opcode: 'SUB', isVector: false }, rsIndex: 2 } as any);
    processor.inFlight.set(4, {
      id: 4, state: 'EXECUTING',
      instr: { opcode: 'MULTSV', isVector: true },
      executionPhaseLabel: 'Proc[3]',
      cyclesRemainingEX: 5,
    } as any);
    processor.inFlight.set(5, {
      id: 5, state: 'EXECUTING',
      instr: { opcode: 'ADD', isVector: false },
      executionPhaseLabel: null,
      cyclesRemainingEX: 2,
    } as any);
    processor.inFlight.set(6, { id: 6, state: 'FINISHED', cycleWR: 3, instr: { opcode: 'MULT', isVector: false } } as any);
    processor.cycle.set(processor.cycle() + 1);
    fixture.detectChanges();

    const html = fixture.nativeElement as HTMLElement;

    expect(html.textContent).toContain('ADDI');
    expect(html.querySelector('.stage-box.stage-IF.active')).toBeTruthy();

    expect(html.textContent).toContain('ROB[3]');
    expect(html.querySelector('.stage-box.stage-ID.active')).toBeTruthy();

    expect(html.textContent).toContain('RS[2]');
    expect(html.querySelector('.stage-box.stage-II.active')).toBeTruthy();

    // EX: una instrucción vectorial con fase (muestra .phase, no .latency) y una escalar con
    // cyclesRemainingEX>0 (muestra .latency)
    const exBox = html.querySelector('.stage-box.stage-EX');
    expect(exBox).toBeTruthy();
    expect(exBox!.querySelector('.phase')?.textContent).toContain('Proc[3]');
    expect(exBox!.querySelector('.latency')?.textContent).toContain('[2]');

    expect(html.querySelector('.stage-box.stage-WR.active')).toBeTruthy();
    expect(html.querySelector('.done-icon')).toBeTruthy();
  });
});
