import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TRANSLOCO_LOADER, provideTransloco } from '@jsverse/transloco';
import { of } from 'rxjs';
import { App } from '../../src/app/app';
import { LoaderService } from '../../src/app/services/loader';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideTransloco({
          config: { availableLangs: ['en', 'es'], defaultLang: 'es' },
        }),
        { provide: TRANSLOCO_LOADER, useValue: { getTranslation: () => of({}) } },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should show the loader overlay while the initial route resolves', () => {
    TestBed.createComponent(App);
    const loaderService = TestBed.inject(LoaderService);
    expect(loaderService.isLoading()).toBe(true);
  });

  // Los tests anteriores nunca llaman a detectChanges(), así que el `@if` de app.html nunca llega
  // a evaluarse ni a renderizar el <app-loader> — de ahí que la plantilla marcase 0% de branch.
  it('renderiza <app-loader> mientras loaderService.isLoading() es true', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-loader')).not.toBeNull();
  });

  it('no renderiza <app-loader> una vez loaderService.isLoading() pasa a false', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    TestBed.inject(LoaderService).hide();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-loader')).toBeNull();
  });
});
