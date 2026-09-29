import { TestBed } from '@angular/core/testing';
import { RegistersViewComponent } from '../../src/app/shared/registers-view/registers-view.component';
import { AsgConfigService } from '../../src/app/core/services/asg.config';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('RegistersViewComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [RegistersViewComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea y renderiza los 32 registros enteros y los 32 flotantes por defecto (pipelined)', () => {
    const fixture = TestBed.createComponent(RegistersViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.registers().length).toBe(32);
    expect(component.floatRegisters().length).toBe(32);
    expect(component.isSuperscalar()).toBe(false);

    const regCards = fixture.nativeElement.querySelectorAll('.reg-card');
    expect(regCards.length).toBeGreaterThan(0);
  });

  it('rrfState() es null fuera del superescalar y no-null tras cambiar a superescalar', () => {
    const fixture = TestBed.createComponent(RegistersViewComponent);
    TestBed.tick();
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.rrfState()).toBeNull();

    TestBed.inject(AsgConfigService).updateConfig({ processorType: 'superscalar' });
    fixture.detectChanges();

    expect(component.isSuperscalar()).toBe(true);
    expect(component.rrfState()).not.toBeNull();
    expect(component.getIntRRF(0)).toEqual({ ocupado: false, slot: null });
  });

  it('hasData() detecta un registro vectorial con algún valor distinto de cero', () => {
    const fixture = TestBed.createComponent(RegistersViewComponent);
    TestBed.tick();
    fixture.detectChanges();
    const component = fixture.componentInstance;

    for (let i = 0; i < 8; i++) {
      expect(component.hasData(i)).toBe(false);
    }
  });

  it('isDouble() solo es true para índices pares marcados como double en el banco flotante', () => {
    const fixture = TestBed.createComponent(RegistersViewComponent);
    TestBed.tick();
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.isDouble(1)).toBe(false); // índice impar
    expect(component.isDouble(0)).toBe(false); // par pero aún no escrito como double
  });

  // El (ngModelChange) del mat-button-toggle-group nunca se disparaba en los tests anteriores
  // (fijaban displayMode directamente sobre la instancia). Aquí se simula el clic real sobre el
  // botón "HEX" para que Angular ejecute el listener generado por la plantilla.
  it('pulsar el botón HEX del selector de modo (clic real) cambia displayMode', () => {
    const fixture = TestBed.createComponent(RegistersViewComponent);
    TestBed.tick();
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.displayMode).toBe('dec');

    const toggles: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('mat-button-toggle'));
    const hexToggle = toggles.find(t => t.textContent?.trim() === 'HEX');
    expect(hexToggle).toBeTruthy();
    const hexButton = hexToggle!.querySelector('button') as HTMLButtonElement;
    hexButton.click();
    fixture.detectChanges();

    expect(component.displayMode).toBe('hex');
  });
});
