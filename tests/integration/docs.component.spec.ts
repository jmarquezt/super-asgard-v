import { TestBed } from '@angular/core/testing';
import { DocsComponent } from '../../src/app/features/docs/docs.component';
import { DOC_SECTIONS } from '../../src/app/features/docs/docs.data';
import { integrationTestProviders, resetIntegrationEnvironment, mockMatchMedia } from './test-providers';

describe('DocsComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    // DocsComponent inyecta BreakpointObserver (isMobile) igual que MainComponent — jsdom no
    // implementa matchMedia, hay que mockearlo antes de crear el componente.
    mockMatchMedia(false);
    await TestBed.configureTestingModule({
      imports: [DocsComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea y abre por defecto las categorías de la primera sección (application)', () => {
    const fixture = TestBed.createComponent(DocsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    expect(component).toBeTruthy();

    const firstSectionCategoryIds = DOC_SECTIONS[0].categories.map(c => c.id);
    for (const id of firstSectionCategoryIds) {
      expect(component.isOpen(id)).toBe(true);
    }
    // Una categoría de otra sección no está abierta por defecto
    expect(component.isOpen('int-alu')).toBe(false);

    // Sin búsqueda, filteredSections() devuelve todas las secciones tal cual
    expect(component.filteredSections().length).toBe(DOC_SECTIONS.length);
  });

  it('toggleCategory() alterna el estado abierto/cerrado de una categoría', () => {
    const fixture = TestBed.createComponent(DocsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    const id = DOC_SECTIONS[0].categories[0].id;
    const initiallyOpen = component.isOpen(id);

    component.toggleCategory(id);
    expect(component.isOpen(id)).toBe(!initiallyOpen);

    component.toggleCategory(id);
    expect(component.isOpen(id)).toBe(initiallyOpen);
  });

  it('filteredSections() filtra las entradas por nombre de instrucción y descarta secciones/categorías sin resultados', () => {
    const fixture = TestBed.createComponent(DocsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    (component as any).searchQuery.set('addi');

    const filtered: any[] = component.filteredSections();
    const allEntryNames = filtered.flatMap((s: any) => s.categories.flatMap((c: any) => c.entries.map((e: any) => e.name.toLowerCase())));

    expect(allEntryNames.length).toBeGreaterThan(0);
    expect(allEntryNames).toContain('addi');

    // La sección 'instructions' debe seguir presente (contiene ADDI) y las secciones sin
    // ninguna coincidencia (ej. 'examples') deben quedar excluidas.
    expect(filtered.some((s: any) => s.id === 'instructions')).toBe(true);
    expect(filtered.some((s: any) => s.id === 'examples')).toBe(false);
  });

  it('onSearch() actualiza searchQuery a partir del valor del input y abre todas las categorías', () => {
    const fixture = TestBed.createComponent(DocsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    const fakeEvent = { target: { value: 'sub' } } as unknown as Event;
    component.onSearch(fakeEvent);

    expect((component as any).searchQuery()).toBe('sub');
    // Con búsqueda activa se abren todas las categorías, incluidas las de otras secciones
    expect(component.isOpen('int-alu')).toBe(true);
  });

  it('select() guarda la entrada seleccionada', () => {
    const fixture = TestBed.createComponent(DocsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    const entry = DOC_SECTIONS[1].categories[0].entries[0];
    component.select(entry);

    expect((component as any).selected()).toBe(entry);
  });

  it('onSearch() con una cadena vacía no fuerza la apertura de todas las categorías', () => {
    const fixture = TestBed.createComponent(DocsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    // Cerramos explícitamente una categoría de otra sección antes de "buscar" en vacío.
    expect(component.isOpen('int-alu')).toBe(false);

    const emptyEvent = { target: { value: '' } } as unknown as Event;
    component.onSearch(emptyEvent);

    expect(component.searchQuery()).toBe('');
    expect(component.isOpen('int-alu')).toBe(false);
  });

  it('translate() devuelve cadena vacía para una clave vacía y la propia clave si no empieza por "DOCS."', () => {
    const fixture = TestBed.createComponent(DocsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    expect(component.translate('')).toBe('');
    expect(component.translate('texto sin prefijo')).toBe('texto sin prefijo');
  });

  it('formatDescription() traduce el texto y lo divide en líneas por salto de línea', () => {
    const fixture = TestBed.createComponent(DocsComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    expect(component.formatDescription('línea uno\nlínea dos')).toEqual(['línea uno', 'línea dos']);
    expect(component.formatDescription('una sola línea')).toEqual(['una sola línea']);
  });

  // Los tests anteriores llaman a onSearch()/toggleCategory()/select() directamente sobre la
  // instancia; los siguientes disparan los eventos DOM reales ((input), (click)) para cubrir los
  // listeners generados por la plantilla.
  it('escribir en el buscador de la sidebar (evento input real) actualiza searchQuery', () => {
    const fixture = TestBed.createComponent(DocsComponent);
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('.search-input');
    input.value = 'sub';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    expect(component.searchQuery()).toBe('sub');
    expect(component.isOpen('int-alu')).toBe(true);
  });

  it('pulsar la cabecera de una categoría (clic real) alterna su estado abierto/cerrado', () => {
    const fixture = TestBed.createComponent(DocsComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as any;

    const id = DOC_SECTIONS[0].categories[0].id;
    const initiallyOpen = component.isOpen(id);

    const catHeader: HTMLButtonElement = fixture.nativeElement.querySelector('.cat-header');
    catHeader.click();
    fixture.detectChanges();

    expect(component.isOpen(id)).toBe(!initiallyOpen);
  });

  it('pulsar una entrada de la lista (clic real) la selecciona', () => {
    const fixture = TestBed.createComponent(DocsComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as any;

    const entryItem: HTMLLIElement = fixture.nativeElement.querySelector('.entry-item');
    expect(entryItem).toBeTruthy();
    entryItem.click();
    fixture.detectChanges();

    expect(component.selected()).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.entry-item.active')).toBeTruthy();
  });

  it('en móvil, seleccionar una entrada oculta el sidebar y muestra el contenido; backToList() vuelve al índice', () => {
    mockMatchMedia(true);
    const fixture = TestBed.createComponent(DocsComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as any;

    expect(component.isMobile()).toBe(true);
    expect(fixture.nativeElement.querySelector('.docs-sidebar').classList.contains('mobile-hidden')).toBe(false);
    expect(fixture.nativeElement.querySelector('.docs-content').classList.contains('mobile-hidden')).toBe(true);

    const entry = DOC_SECTIONS[0].categories[0].entries[0];
    component.select(entry);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.docs-sidebar').classList.contains('mobile-hidden')).toBe(true);
    expect(fixture.nativeElement.querySelector('.docs-content').classList.contains('mobile-hidden')).toBe(false);
    expect(fixture.nativeElement.querySelector('.mobile-back-btn')).toBeTruthy();

    component.backToList();
    fixture.detectChanges();

    expect(component.selected()).toBeNull();
    expect(fixture.nativeElement.querySelector('.docs-sidebar').classList.contains('mobile-hidden')).toBe(false);
    expect(fixture.nativeElement.querySelector('.docs-content').classList.contains('mobile-hidden')).toBe(true);
  });

  it('en escritorio (no móvil), sidebar y contenido se muestran siempre a la vez', () => {
    const fixture = TestBed.createComponent(DocsComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as any;

    expect(component.isMobile()).toBe(false);
    component.select(DOC_SECTIONS[0].categories[0].entries[0]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.docs-sidebar').classList.contains('mobile-hidden')).toBe(false);
    expect(fixture.nativeElement.querySelector('.docs-content').classList.contains('mobile-hidden')).toBe(false);
    expect(fixture.nativeElement.querySelector('.mobile-back-btn')).toBeNull();
  });

  it('pulsar el botón de copiar del ejemplo (clic real) no propaga el evento ni lanza excepción', () => {
    const fixture = TestBed.createComponent(DocsComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as any;

    const entryWithExample = DOC_SECTIONS.flatMap(s => s.categories.flatMap(c => c.entries)).find(e => e.example);
    expect(entryWithExample).toBeTruthy();
    component.select(entryWithExample);
    fixture.detectChanges();

    const copyBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.copy-btn');
    expect(copyBtn).toBeTruthy();
    expect(() => copyBtn.click()).not.toThrow();
  });
});
