import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { FullPageComponent } from '../../src/app/layout/full-page/full-page.component';
import { SettingsComponent } from '../../src/app/layout/settings/settings.component';
import { AsgConfigService } from '../../src/app/core/services/asg.config';
import { ThemeService } from '../../src/app/services/theme';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('FullPageComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [FullPageComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea sin lanzar errores', () => {
    const fixture = TestBed.createComponent(FullPageComponent);
    expect(() => fixture.detectChanges()).not.toThrow();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('openSettings() abre SettingsComponent con la configuración actual como data', () => {
    const fixture = TestBed.createComponent(FullPageComponent);
    fixture.detectChanges();

    const dialog = TestBed.inject(MatDialog);
    const configService = TestBed.inject(AsgConfigService);
    const currentConfig = configService.getCurrentConfig();
    const openSpy = vi
      .spyOn(dialog, 'open')
      .mockReturnValue({ afterClosed: () => of(null) } as any);

    fixture.componentInstance.openSettings();

    expect(openSpy).toHaveBeenCalledWith(
      SettingsComponent,
      expect.objectContaining({ data: currentConfig }),
    );
  });

  it('openSettings() actualiza la configuración cuando afterClosed() emite una nueva config', () => {
    const fixture = TestBed.createComponent(FullPageComponent);
    fixture.detectChanges();

    const dialog = TestBed.inject(MatDialog);
    const configService = TestBed.inject(AsgConfigService);
    const newConfig = { ...configService.getCurrentConfig(), memorySize: 8192 };
    vi.spyOn(dialog, 'open').mockReturnValue({ afterClosed: () => of(newConfig) } as any);
    const updateSpy = vi.spyOn(configService, 'updateConfig');

    fixture.componentInstance.openSettings();

    expect(updateSpy).toHaveBeenCalledWith(newConfig);
  });

  it('openSettings() no actualiza la configuración cuando afterClosed() emite null', () => {
    const fixture = TestBed.createComponent(FullPageComponent);
    fixture.detectChanges();

    const dialog = TestBed.inject(MatDialog);
    const configService = TestBed.inject(AsgConfigService);
    vi.spyOn(dialog, 'open').mockReturnValue({ afterClosed: () => of(null) } as any);
    const updateSpy = vi.spyOn(configService, 'updateConfig');

    fixture.componentInstance.openSettings();

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('toggleTheme() invierte el estado isDark de ThemeService', () => {
    const fixture = TestBed.createComponent(FullPageComponent);
    fixture.detectChanges();

    const themeService = TestBed.inject(ThemeService);
    const before = themeService.isDark();

    fixture.componentInstance.toggleTheme();

    expect(themeService.isDark()).toBe(!before);
  });

  it('changeLang("en") actualiza activeLang y llama a translocoService.setActiveLang', () => {
    const fixture = TestBed.createComponent(FullPageComponent);
    fixture.detectChanges();

    const translocoService = TestBed.inject(TranslocoService);
    const setActiveLangSpy = vi.spyOn(translocoService, 'setActiveLang');

    fixture.componentInstance.changeLang('en');

    expect(setActiveLangSpy).toHaveBeenCalledWith('en');
    expect(fixture.componentInstance.activeLang()).toBe('en');
  });

  // Los tests anteriores llaman a openSettings()/toggleTheme()/changeLang() directamente sobre la
  // instancia; los siguientes disparan los eventos DOM reales ((click)) para cubrir los listeners
  // generados por la plantilla.
  it('el botón de ajustes (clic real) abre SettingsComponent', () => {
    const fixture = TestBed.createComponent(FullPageComponent);
    fixture.detectChanges();

    const dialog = TestBed.inject(MatDialog);
    const openSpy = vi.spyOn(dialog, 'open').mockReturnValue({ afterClosed: () => of(null) } as any);

    const settingsBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.settings-button');
    settingsBtn.click();
    fixture.detectChanges();

    expect(openSpy).toHaveBeenCalledWith(SettingsComponent, expect.anything());
  });

  it('el botón de tema (clic real) invierte isDark', () => {
    const fixture = TestBed.createComponent(FullPageComponent);
    fixture.detectChanges();

    const themeService = TestBed.inject(ThemeService);
    const before = themeService.isDark();

    const themeBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.theme-toggle');
    themeBtn.click();
    fixture.detectChanges();

    expect(themeService.isDark()).toBe(!before);
  });

  it('el menú de idioma: abrirlo y pulsar "EN" (clic real) cambia el idioma activo', () => {
    const fixture = TestBed.createComponent(FullPageComponent);
    fixture.detectChanges();

    const translocoService = TestBed.inject(TranslocoService);
    const setActiveLangSpy = vi.spyOn(translocoService, 'setActiveLang');

    const langTrigger: HTMLButtonElement = fixture.nativeElement.querySelector('.lang-selector');
    langTrigger.click();
    fixture.detectChanges();

    // mat-menu se renderiza en un overlay adjunto a document.body, fuera del árbol del fixture.
    const menuItems: HTMLButtonElement[] = Array.from(document.querySelectorAll('.mat-mdc-menu-item'));
    expect(menuItems.length).toBe(2);
    const enItem = menuItems.find(b => b.textContent?.trim().toUpperCase().includes('EN'));
    expect(enItem).toBeTruthy();
    enItem!.click();
    fixture.detectChanges();

    expect(setActiveLangSpy).toHaveBeenCalledWith('en');
    expect(fixture.componentInstance.activeLang()).toBe('en');
  });
});
