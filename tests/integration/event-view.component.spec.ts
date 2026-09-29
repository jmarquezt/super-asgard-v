import { TestBed } from '@angular/core/testing';
import { EventViewComponent } from '../../src/app/shared/event-view/event-view.component';
import { LogService } from '../../src/app/services/log';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('EventViewComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [EventViewComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea y sin búsqueda muestra todos los eventos del LogService', () => {
    const logService = TestBed.inject(LogService);
    logService.log('primer evento', 'success', 1);
    logService.log('segundo evento', 'error', 2);

    const fixture = TestBed.createComponent(EventViewComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component).toBeTruthy();
    expect(component.filteredEvents().length).toBe(2);
  });

  it('filtra los eventos por mensaje (case-insensitive)', () => {
    const logService = TestBed.inject(LogService);
    logService.log('Overflow detectado', 'error', 5);
    logService.log('Ejecución correcta', 'success', 6);

    const fixture = TestBed.createComponent(EventViewComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.searchQuery.set('overflow');
    fixture.detectChanges();

    const messages = component.filteredEvents().map(e => e.message);
    expect(messages).toEqual(['Overflow detectado']);
  });

  it('filtra los eventos por número de ciclo', () => {
    const logService = TestBed.inject(LogService);
    logService.log('evento en ciclo 10', 'success', 10);
    logService.log('evento en ciclo 20', 'success', 20);

    const fixture = TestBed.createComponent(EventViewComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.searchQuery.set('20');
    fixture.detectChanges();

    const messages = component.filteredEvents().map(e => e.message);
    expect(messages).toEqual(['evento en ciclo 20']);
  });

  it('filtra los eventos por tipo', () => {
    const logService = TestBed.inject(LogService);
    logService.log('fallo crítico', 'error', 1);
    logService.log('operación exitosa', 'success', 2);

    const fixture = TestBed.createComponent(EventViewComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.searchQuery.set('error');
    fixture.detectChanges();

    const messages = component.filteredEvents().map(e => e.message);
    expect(messages).toEqual(['fallo crítico']);
  });

  // Los tests anteriores fijan searchQuery directamente desde la instancia del componente; los
  // siguientes disparan los eventos DOM reales ((input), (click)) que la plantilla enlaza, para
  // cubrir esos listeners generados por Angular (event-view.component.html: 3 funciones, 0
  // invocaciones — el propio componente sí estaba bien testeado, pero nunca a través del DOM).
  it('escribir en el campo de búsqueda (evento input real) actualiza searchQuery y filtra', () => {
    const logService = TestBed.inject(LogService);
    logService.log('Overflow detectado', 'error', 5);
    logService.log('Ejecución correcta', 'success', 6);

    const fixture = TestBed.createComponent(EventViewComponent);
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('.search-input');
    input.value = 'overflow';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.searchQuery()).toBe('overflow');
    expect(fixture.componentInstance.filteredEvents().map(e => e.message)).toEqual(['Overflow detectado']);
  });

  it('el botón de limpiar búsqueda (clic real) vacía searchQuery', () => {
    const logService = TestBed.inject(LogService);
    logService.log('un evento', 'success', 1);

    const fixture = TestBed.createComponent(EventViewComponent);
    fixture.detectChanges();
    fixture.componentInstance.searchQuery.set('un');
    fixture.detectChanges();

    const clearBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.clear-btn');
    expect(clearBtn).not.toBeNull(); // solo se renderiza cuando searchQuery() es truthy
    clearBtn.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.searchQuery()).toBe('');
  });

  it('el botón de limpiar registro (clic real) vacía el log a través de logService.clearLog()', () => {
    const logService = TestBed.inject(LogService);
    logService.log('un evento', 'success', 1);

    const fixture = TestBed.createComponent(EventViewComponent);
    fixture.detectChanges();

    const clearLogBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.actions button');
    clearLogBtn.click();
    fixture.detectChanges();

    expect(logService.eventLog().length).toBe(0);
  });
});
