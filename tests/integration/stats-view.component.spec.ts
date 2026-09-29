import { TestBed } from '@angular/core/testing';
import { StatsViewComponent } from '../../src/app/shared/stats-view/stats-view.component';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('StatsViewComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [StatsViewComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea y renderiza sin lanzar errores', () => {
    const fixture = TestBed.createComponent(StatsViewComponent);
    TestBed.tick();
    expect(() => fixture.detectChanges()).not.toThrow();

    const statCards = fixture.nativeElement.querySelectorAll('.stat-card');
    expect(statCards.length).toBeGreaterThan(0);
  });

  it('getBranchHitRateClass() devuelve "success-theme" para tasas >= 90', () => {
    const fixture = TestBed.createComponent(StatsViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.getBranchHitRateClass(90)).toBe('success-theme');
    expect(component.getBranchHitRateClass(100)).toBe('success-theme');
  });

  it('getBranchHitRateClass() devuelve "warning-theme" para tasas entre 70 y 89', () => {
    const fixture = TestBed.createComponent(StatsViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.getBranchHitRateClass(70)).toBe('warning-theme');
    expect(component.getBranchHitRateClass(89)).toBe('warning-theme');
  });

  it('getBranchHitRateClass() devuelve "danger-theme" para tasas por debajo de 70', () => {
    const fixture = TestBed.createComponent(StatsViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.getBranchHitRateClass(69)).toBe('danger-theme');
    expect(component.getBranchHitRateClass(0)).toBe('danger-theme');
  });
});
