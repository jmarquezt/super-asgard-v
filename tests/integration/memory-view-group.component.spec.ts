import { TestBed } from '@angular/core/testing';
import { MemoryViewGroupComponent } from '../../src/app/shared/memory-view-group/memory-view-group.component';
import { AsgPipelinedProcessorService } from '../../src/app/core/services/processor/asg.pipelined.processor';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('MemoryViewGroupComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [MemoryViewGroupComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea y por defecto muestra la primera memoria (datos) como memoria activa', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();

    const fixture = TestBed.createComponent(MemoryViewGroupComponent);
    fixture.componentRef.setInput('memories', [processor.dataMemory, processor.instructionsMemory]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component).toBeTruthy();
    expect(component.activeTabIndex()).toBe(0);
    expect(component.activeMemory()).toBe(processor.dataMemory);
    expect(component.memoryWords().length).toBe(processor.dataMemory.get().length / 4);
  });

  it('cambiar activeTabIndex conmuta la memoria activa a la memoria de instrucciones', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();

    const fixture = TestBed.createComponent(MemoryViewGroupComponent);
    fixture.componentRef.setInput('memories', [processor.dataMemory, processor.instructionsMemory]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.activeTabIndex.set(1);
    fixture.detectChanges();

    expect(component.activeMemory()).toBe(processor.instructionsMemory);
    // instructionsMemory se crea con tamaño 0 antes de cargar ningún programa
    expect(component.memoryWords().length).toBe(0);
    expect(component.isMemoryEmpty()).toBe(true);
  });

  it('isMemoryEmpty() es false cuando la memoria activa tiene algún byte distinto de cero', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();
    processor.dataMemory.write(0, 42, 4);

    const fixture = TestBed.createComponent(MemoryViewGroupComponent);
    fixture.componentRef.setInput('memories', [processor.dataMemory, processor.instructionsMemory]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.isMemoryEmpty()).toBe(false);
  });

  it('filtra las palabras de la memoria activa por la búsqueda en modo hex', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();
    processor.dataMemory.write(0, 0xab, 4);

    const fixture = TestBed.createComponent(MemoryViewGroupComponent);
    fixture.componentRef.setInput('memories', [processor.dataMemory, processor.instructionsMemory]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.displayMode.set('hex');
    component.searchQuery.set('ab');
    fixture.detectChanges();

    expect(component.filteredWords().some(w => w.address === 0)).toBe(true);
  });

  it('la búsqueda en modo hex ignora el prefijo "0x" (equivale a buscar sin él)', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();
    processor.dataMemory.write(0, 0xab, 4);

    const fixture = TestBed.createComponent(MemoryViewGroupComponent);
    fixture.componentRef.setInput('memories', [processor.dataMemory, processor.instructionsMemory]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.displayMode.set('hex');
    component.searchQuery.set('0xab');
    fixture.detectChanges();

    expect(component.filteredWords().some(w => w.address === 0)).toBe(true);
  });

  it('una búsqueda que es solo "0x" (queda vacía tras quitar el prefijo) no filtra nada', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();

    const fixture = TestBed.createComponent(MemoryViewGroupComponent);
    fixture.componentRef.setInput('memories', [processor.dataMemory, processor.instructionsMemory]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const allWords = component.memoryWords();
    component.searchQuery.set('0x');
    fixture.detectChanges();

    expect(component.filteredWords()).toEqual(allWords);
  });

  it('filtra las palabras de la memoria activa por la búsqueda en modo decimal', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();
    processor.dataMemory.write(0, 240, 4); // byte bajo = 240 -> "0 0 0 240"

    const fixture = TestBed.createComponent(MemoryViewGroupComponent);
    fixture.componentRef.setInput('memories', [processor.dataMemory, processor.instructionsMemory]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.displayMode.set('dec');
    component.searchQuery.set('240');
    fixture.detectChanges();

    expect(component.filteredWords().some(w => w.address === 0)).toBe(true);
  });

  it('filtra las palabras de la memoria activa por la búsqueda en modo binario', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();
    processor.dataMemory.write(0, 0xab, 4);
    const expectedBits = (0xab >>> 0).toString(2).padStart(32, '0');

    const fixture = TestBed.createComponent(MemoryViewGroupComponent);
    fixture.componentRef.setInput('memories', [processor.dataMemory, processor.instructionsMemory]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.displayMode.set('bin');
    component.searchQuery.set(expectedBits.slice(-8)); // últimos 8 bits, únicos para 0xab

    expect(component.filteredWords().some(w => w.address === 0)).toBe(true);
  });

  it('filtra las palabras de la memoria activa por la búsqueda en modo ascii (insensible a mayúsculas)', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();
    // Byte 0x41 = 'A' (imprimible) en la posición más significativa del word
    processor.dataMemory.write(0, 0x41000000, 4);

    const fixture = TestBed.createComponent(MemoryViewGroupComponent);
    fixture.componentRef.setInput('memories', [processor.dataMemory, processor.instructionsMemory]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.displayMode.set('ascii');
    component.searchQuery.set('a'); // minúscula: la búsqueda es insensible a mayúsculas

    expect(component.filteredWords().some(w => w.address === 0)).toBe(true);
  });

  it('sin memoria activa (índice de pestaña fuera de rango), filteredWords/isMemoryEmpty no lanzan', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();

    const fixture = TestBed.createComponent(MemoryViewGroupComponent);
    fixture.componentRef.setInput('memories', [processor.dataMemory, processor.instructionsMemory]);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.activeTabIndex.set(99); // fuera de rango: activeMemory() es undefined

    expect(component.activeMemory()).toBeUndefined();
    expect(component.memoryWords()).toEqual([]);
    expect(component.isMemoryEmpty()).toBe(true);

    // Con una búsqueda no vacía y memoria activa undefined, se ejercita la rama
    // `if (!memory) return words;` dentro del propio filteredWords (no solo la de memoryWords).
    component.searchQuery.set('ab');
    expect(component.filteredWords()).toEqual([]);
  });

  // Los tests anteriores fijan las señales directamente sobre la instancia; los siguientes
  // disparan los eventos DOM reales ((input), (click), (ngModelChange), (selectedIndexChange))
  // para cubrir los listeners generados por la plantilla.
  it('escribir en el buscador (evento input real) filtra las palabras de memoria', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();
    processor.dataMemory.write(0, 240, 4);

    const fixture = TestBed.createComponent(MemoryViewGroupComponent);
    fixture.componentRef.setInput('memories', [processor.dataMemory, processor.instructionsMemory]);
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('.search-input');
    input.value = '240';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.searchQuery()).toBe('240');
  });

  it('el botón de limpiar búsqueda (clic real) vacía searchQuery', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();

    const fixture = TestBed.createComponent(MemoryViewGroupComponent);
    fixture.componentRef.setInput('memories', [processor.dataMemory, processor.instructionsMemory]);
    fixture.detectChanges();
    fixture.componentInstance.searchQuery.set('algo');
    fixture.detectChanges();

    const clearBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.clear-btn');
    expect(clearBtn).not.toBeNull();
    clearBtn.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.searchQuery()).toBe('');
  });

  it('pulsar el botón HEX del selector de modo (clic real) cambia displayMode', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();

    const fixture = TestBed.createComponent(MemoryViewGroupComponent);
    fixture.componentRef.setInput('memories', [processor.dataMemory, processor.instructionsMemory]);
    fixture.detectChanges();

    const toggles: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('mat-button-toggle'));
    const hexToggle = toggles.find(t => t.textContent?.trim() === 'HEX');
    expect(hexToggle).toBeTruthy();
    (hexToggle!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.displayMode()).toBe('hex');
  });

  it('pulsar la pestaña de instrucciones (clic real) cambia activeTabIndex y la memoria activa', async () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();

    const fixture = TestBed.createComponent(MemoryViewGroupComponent);
    fixture.componentRef.setInput('memories', [processor.dataMemory, processor.instructionsMemory]);
    fixture.detectChanges();

    const tabs: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.mat-mdc-tab'));
    expect(tabs.length).toBe(2);
    tabs[1].click();
    fixture.detectChanges();
    // selectedIndexChange se emite dentro de un microtask (Promise.resolve().then(...)) en
    // ngAfterContentChecked de MatTabGroup, no de forma síncrona tras el clic.
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.componentInstance.activeTabIndex()).toBe(1);
    expect(fixture.componentInstance.activeMemory()).toBe(processor.instructionsMemory);
  });
});
