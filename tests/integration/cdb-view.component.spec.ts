import { TestBed } from '@angular/core/testing';
import { CdbViewComponent } from '../../src/app/shared/cdb-view/cdb-view.component';
import { AsgAssemblerService } from '../../src/app/core/services/assembly/asg.assembler';
import { AsgSuperscalarProcessorService } from '../../src/app/core/services/processor/asg.superscalar.processor';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('CdbViewComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [CdbViewComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea y renderiza el estado vacío del CDB por defecto', () => {
    const fixture = TestBed.createComponent(CdbViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.hasResults()).toBe(false);
    expect(component.results()).toEqual([]);

    const emptyState = fixture.nativeElement.querySelector('.empty-state');
    expect(emptyState).toBeTruthy();
    const cdbBus = fixture.nativeElement.querySelector('.cdb-bus');
    expect(cdbBus).toBeFalsy();
  });

  it('formatValue() convierte el número a texto', () => {
    const fixture = TestBed.createComponent(CdbViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.formatValue(42)).toBe('42');
    expect(component.formatValue(-7)).toBe('-7');
  });

  it('getFuTypeColor() devuelve un color conocido para tipos válidos y un color por defecto para tipos desconocidos', () => {
    const fixture = TestBed.createComponent(CdbViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.getFuTypeColor('INT_ALU')).toBe('#4caf50');
    expect(component.getFuTypeColor('UNKNOWN_TYPE')).toBe('#9e9e9e');
  });

  it('renderiza el bus del CDB cuando hay resultados publicados en el ciclo actual', () => {
    const assembler = TestBed.inject(AsgAssemblerService);
    const processor = TestBed.inject(AsgSuperscalarProcessorService);
    TestBed.tick();

    const result = assembler.assembleProgram([{
      name: 'main', source: `
      .text
      ADDI R1, R0, #10
      ADDI R2, R0, #5
      ADD  R3, R1, R2
      TRAP 0
    `}]);
    expect(result.success).toBe(true);
    processor.load(result.instructionBinary, result.dataBuffer, result.initialCodePtr);

    // getCDBResults() solo tiene contenido durante el ciclo en que se publica (se limpia en el
    // siguiente startCycle()) — avanzamos hasta encontrar ese ciclo, en vez de asumir un número
    // fijo de ciclos.
    let guard = 0;
    while (processor.getCDBResults().length === 0 && guard < 50) {
      processor.nextCycle();
      guard++;
    }
    expect(guard).toBeLessThan(50);

    const fixture = TestBed.createComponent(CdbViewComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.hasResults()).toBe(true);
    expect(component.results().length).toBeGreaterThan(0);

    const cdbBus = fixture.nativeElement.querySelector('.cdb-bus');
    expect(cdbBus).toBeTruthy();
    const results = fixture.nativeElement.querySelectorAll('.cdb-result');
    expect(results.length).toBe(component.results().length);
    const emptyState = fixture.nativeElement.querySelector('.empty-state');
    expect(emptyState).toBeFalsy();
  });
});
