import { TestBed } from '@angular/core/testing';
import { RsViewComponent } from '../../src/app/shared/rs-view/rs-view.component';
import { AsgAssemblerService } from '../../src/app/core/services/assembly/asg.assembler';
import { AsgSuperscalarProcessorService } from '../../src/app/core/services/processor/asg.superscalar.processor';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('RsViewComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [RsViewComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea y no tiene grupos de RS ocupados por defecto (sin programa cargado)', () => {
    const fixture = TestBed.createComponent(RsViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.entries()).toEqual([]);
    expect(component.groupedEntries()).toEqual([]);

    const emptyMessage = fixture.nativeElement.querySelector('.empty-message');
    expect(emptyMessage).toBeTruthy();
    const groups = fixture.nativeElement.querySelectorAll('.rs-group');
    expect(groups.length).toBe(0);
  });

  it('getStateClass()/isReady() reflejan el estado de una entrada de RS simulada', () => {
    const fixture = TestBed.createComponent(RsViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const emptyEntry = { ocupada: false, lista: false } as any;
    expect(component.getStateClass(emptyEntry)).toBe('state-empty');
    expect(component.isReady(emptyEntry)).toBe(false);

    const readyEntry = { ocupada: true, lista: true } as any;
    expect(component.getStateClass(readyEntry)).toBe('state-ready');
    expect(component.isReady(readyEntry)).toBe(true);

    const waitingEntry = { ocupada: true, lista: false } as any;
    expect(component.getStateClass(waitingEntry)).toBe('state-waiting');
    expect(component.isReady(waitingEntry)).toBe(false);
  });

  it('formatOperand() prioriza el tag ROB sobre el valor numérico y muestra "-" cuando ambos son nulos', () => {
    const fixture = TestBed.createComponent(RsViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.formatOperand(5, { slot: 3 } as any)).toBe('ROB[3]');
    expect(component.formatOperand(5, null)).toBe('5');
    expect(component.formatOperand(null, null)).toBe('-');
  });

  it('getFuTypeColor() devuelve un color conocido para tipos válidos y un color por defecto para tipos desconocidos', () => {
    const fixture = TestBed.createComponent(RsViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.getFuTypeColor('FP_MUL')).toBe('#00bcd4');
    expect(component.getFuTypeColor('UNKNOWN')).toBe('#9e9e9e');
  });

  it('groupedEntries() agrupa por tipo de UF las entradas reales distribuidas a las RS de un programa en ejecución', () => {
    const assembler = TestBed.inject(AsgAssemblerService);
    const processor = TestBed.inject(AsgSuperscalarProcessorService);
    TestBed.tick();

    const result = assembler.assembleProgram([{
      name: 'main', source: `
      .text
      ADDI R1, R0, #10
      ADDI R2, R0, #5
      ADD  R3, R1, R2
      ADD  R4, R1, R2
    `}]);
    expect(result.success).toBe(true);
    processor.load(result.instructionBinary, result.dataBuffer, result.initialCodePtr);

    // Avanzar ciclos suficientes para que IF -> ID -> II (distribución a RS) ocurra realmente
    for (let i = 0; i < 4 && !processor.isFinished(); i++) {
      processor.nextCycle();
    }

    const fixture = TestBed.createComponent(RsViewComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.entries().length).toBeGreaterThan(0);

    const groups = component.groupedEntries();
    expect(groups.length).toBeGreaterThan(0);

    const intAluGroup = groups.find(g => g.type === 'INT_ALU');
    expect(intAluGroup).toBeTruthy();
    expect(intAluGroup!.occupied).toBeGreaterThan(0);
    expect(intAluGroup!.entries.length).toBe(intAluGroup!.occupied);
    expect(intAluGroup!.entries.every(e => e.fuType === 'INT_ALU')).toBe(true);

    const emptyMessage = fixture.nativeElement.querySelector('.empty-message');
    expect(emptyMessage).toBeFalsy();
    const groupEls = fixture.nativeElement.querySelectorAll('.rs-group');
    expect(groupEls.length).toBe(groups.length);
  });
});
