import { TestBed } from '@angular/core/testing';
import { RobViewComponent } from '../../src/app/shared/rob-view/rob-view.component';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('RobViewComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [RobViewComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea y muestra un ROB con todas las entradas desocupadas por defecto', () => {
    const fixture = TestBed.createComponent(RobViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const entries = component.entries();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(e => !e.ocupada)).toBe(true);

    const occupancy = component.occupancy();
    expect(occupancy.occupied).toBe(0);
    expect(occupancy.total).toBe(entries.length);
  });

  it('getStateClass()/getStateText() devuelven el estado "vacío" para una entrada no ocupada', () => {
    const fixture = TestBed.createComponent(RobViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const entry = component.entries()[0];
    expect(component.getStateClass(entry)).toBe('state-empty');
    expect(component.getStateText(entry)).toBe('-');
  });

  it('formatValue()/formatHex() devuelven "-" para valores nulos', () => {
    const fixture = TestBed.createComponent(RobViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.formatValue(null)).toBe('-');
    expect(component.formatHex(null)).toBe('-');
    expect(component.formatHex(255)).toBe('0x000000ff');
  });

  it('isBranch() es falso y getRegName() es "-" para una entrada vacía sin destino', () => {
    const fixture = TestBed.createComponent(RobViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const entry = component.entries()[0];
    expect(component.isBranch(entry)).toBe(false);
    expect(component.getRegName(entry)).toBe('-');
  });

  it('getStateClass()/getStateText() reflejan "finalizada", "emitida" y "esperando" para entradas ocupadas', () => {
    const fixture = TestBed.createComponent(RobViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;

    const finishedEntry = { ocupada: true, finalizada: true, emitida: true } as any;
    expect(component.getStateClass(finishedEntry)).toBe('state-finished');
    expect(component.getStateText(finishedEntry)).toBe('F');

    const issuedEntry = { ocupada: true, finalizada: false, emitida: true } as any;
    expect(component.getStateClass(issuedEntry)).toBe('state-issued');
    expect(component.getStateText(issuedEntry)).toBe('E');

    const waitingEntry = { ocupada: true, finalizada: false, emitida: false } as any;
    expect(component.getStateClass(waitingEntry)).toBe('state-waiting');
    expect(component.getStateText(waitingEntry)).toBe('W');
  });

  it('formatValue() convierte un valor numérico real a texto', () => {
    const fixture = TestBed.createComponent(RobViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.formatValue(42)).toBe('42');
    expect(component.formatValue(0)).toBe('0');
  });

  it('getRegName() devuelve el nombre de registro cuando hay destino y tipo, y "-" si falta cualquiera de los dos', () => {
    const fixture = TestBed.createComponent(RobViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const fullEntry = { regDestino: 3, tipoReg: 'R' } as any;
    expect(component.getRegName(fullEntry)).toBe('R3');

    const noTypeEntry = { regDestino: 3, tipoReg: null } as any;
    expect(component.getRegName(noTypeEntry)).toBe('-');

    const noDestEntry = { regDestino: null, tipoReg: 'F' } as any;
    expect(component.getRegName(noDestEntry)).toBe('-');
  });

  it('isBranch() es verdadero para una entrada con branchInfo y getBranchStatus() distingue pending/correct/mispredicted', () => {
    const fixture = TestBed.createComponent(RobViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;

    const notBranchEntry = { branchInfo: null } as any;
    expect(component.isBranch(notBranchEntry)).toBe(false);
    expect(component.getBranchStatus(notBranchEntry)).toBe('');

    const pendingEntry = { branchInfo: { predictedTaken: true, predictedTarget: 100 } } as any;
    expect(component.isBranch(pendingEntry)).toBe(true);
    expect(component.getBranchStatus(pendingEntry)).toBe('pending');

    const mispredictedEntry = { branchInfo: { predictedTaken: true, predictedTarget: 100, mispredicted: true } } as any;
    expect(component.getBranchStatus(mispredictedEntry)).toBe('mispredicted');

    const correctEntry = { branchInfo: { predictedTaken: false, predictedTarget: 0, mispredicted: false } } as any;
    expect(component.getBranchStatus(correctEntry)).toBe('correct');
  });
});
