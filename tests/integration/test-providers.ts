import { EnvironmentProviders, Provider } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { TRANSLOCO_LOADER, provideTransloco } from '@jsverse/transloco';

/**
 * Providers comunes para montar componentes standalone de la UI en tests de integración.
 * Reproduce el patrón ya probado en tests/unit/app.spec.ts (Transloco con loader en memoria,
 * router vacío). NO se añade ningún provider de animaciones: el paquete `@angular/animations` ni
 * siquiera está instalado en este proyecto (Angular Material funciona sin él, sin más), y
 * `app.config.ts` tampoco lo configura — así que los componentes ya deben funcionar sin él.
 */
export function integrationTestProviders(): (Provider | EnvironmentProviders)[] {
  return [
    provideRouter([]),
    provideTransloco({
      config: { availableLangs: ['en', 'es'], defaultLang: 'es' },
    }),
    { provide: TRANSLOCO_LOADER, useValue: { getTranslation: () => of({}) } },
  ];
}

/**
 * Llamar SIEMPRE al principio de cada `beforeEach`, antes de `TestBed.configureTestingModule(...)`.
 * `AsgConfigService` persiste la config en `localStorage` (misma clave para todos los tests, ya
 * que jsdom comparte el `localStorage` entre ficheros de test dentro del mismo proceso/worker) —
 * sin este reset, un test que cambie `processorType` (a 'superscalar' o 'non-pipelined') deja esa
 * config contaminando los tests de OTROS ficheros que arranquen después y esperen la config por
 * defecto ('pipelined'). Mismo patrón que `tests/functional/run-program.ts`'s `freshTestBed()`.
 */
export function resetIntegrationEnvironment(): void {
  localStorage.clear();
}

/**
 * jsdom no implementa `window.matchMedia` (usado por `BreakpointObserver` del Angular CDK, del
 * que depende `MainComponent` para decidir entre el dashboard de escritorio y `app-mobile-main`).
 * Sin este mock, inyectar `BreakpointObserver` lanza al llamar a `.observe()`/`.isMatched()`.
 *
 * Llamar en el `beforeEach` de CUALQUIER test que monte `MainComponent` (o cualquier componente
 * que inyecte `BreakpointObserver`), ANTES de `TestBed.createComponent(...)`. `matches` fija si
 * TODAS las media queries observadas se consideran activas — no diferencia por query concreta,
 * ya que ningún test de este proyecto necesita simular breakpoints distintos a la vez.
 */
export function mockMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
