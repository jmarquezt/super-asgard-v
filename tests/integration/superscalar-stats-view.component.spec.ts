import { TestBed } from '@angular/core/testing';
import { SuperscalarStatsViewComponent } from '../../src/app/shared/superscalar-stats-view/superscalar-stats-view.component';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('SuperscalarStatsViewComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [SuperscalarStatsViewComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea y renderiza las tarjetas de estadísticas sin lanzar errores', () => {
    const fixture = TestBed.createComponent(SuperscalarStatsViewComponent);
    TestBed.tick();
    expect(() => fixture.detectChanges()).not.toThrow();

    const statCards = fixture.nativeElement.querySelectorAll('.stat-card');
    expect(statCards.length).toBeGreaterThan(0);
  });

  it('branchAccuracy() es 100 cuando no hubo predicciones de salto', () => {
    const fixture = TestBed.createComponent(SuperscalarStatsViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.branchAccuracy()).toBe(100);
  });

  it('stallBreakdown() suma 0 cuando no se ha ejecutado ningún ciclo', () => {
    const fixture = TestBed.createComponent(SuperscalarStatsViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const breakdown = component.stallBreakdown();
    expect(breakdown.fetch).toBe(0);
    expect(breakdown.rob).toBe(0);
    expect(breakdown.rs).toBe(0);
    expect(breakdown.structural).toBe(0);
    expect(breakdown.total).toBe(0);
  });

  it('ipc() se formatea con 3 decimales', () => {
    const fixture = TestBed.createComponent(SuperscalarStatsViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.ipc()).toMatch(/^\d+\.\d{3}$/);
  });

  it('getBranchAccuracyClass() aplica los umbrales de 90/70 correctamente', () => {
    const fixture = TestBed.createComponent(SuperscalarStatsViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.getBranchAccuracyClass(95)).toBe('success');
    expect(component.getBranchAccuracyClass(80)).toBe('warning');
    expect(component.getBranchAccuracyClass(50)).toBe('danger');
  });
});
