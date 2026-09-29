import { TestBed } from '@angular/core/testing';
import { LoaderComponent } from '../../src/app/layout/loader/loader.component';
import { ThemeService } from '../../src/app/services/theme';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('LoaderComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [LoaderComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea y renderiza el spinner de carga', () => {
    const fixture = TestBed.createComponent(LoaderComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component).toBeTruthy();

    const spinner = fixture.nativeElement.querySelector('mat-progress-spinner');
    expect(spinner).toBeTruthy();
  });

  it('no aplica la clase dark-theme cuando ThemeService.isDark() es false por defecto', () => {
    const fixture = TestBed.createComponent(LoaderComponent);
    fixture.detectChanges();

    const themeService = TestBed.inject(ThemeService);
    expect(themeService.isDark()).toBe(false);

    const overlay = fixture.nativeElement.querySelector('.loading-overlay');
    expect(overlay.classList.contains('dark-theme')).toBe(false);
  });

  it('aplica la clase dark-theme cuando ThemeService.toggle() activa el modo oscuro', () => {
    const fixture = TestBed.createComponent(LoaderComponent);
    fixture.detectChanges();

    const themeService = TestBed.inject(ThemeService);
    themeService.toggle();
    fixture.detectChanges();

    expect(themeService.isDark()).toBe(true);
    const overlay = fixture.nativeElement.querySelector('.loading-overlay');
    expect(overlay.classList.contains('dark-theme')).toBe(true);
  });
});
