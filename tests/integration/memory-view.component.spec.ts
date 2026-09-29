import { TestBed } from '@angular/core/testing';
import { MemoryViewComponent } from '../../src/app/shared/memory-view/memory-view.component';
import { AsgPipelinedProcessorService } from '../../src/app/core/services/processor/asg.pipelined.processor';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('MemoryViewComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [MemoryViewComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea y expone las palabras de memoria a partir del AsgMemoryService inyectado', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();

    const fixture = TestBed.createComponent(MemoryViewComponent);
    fixture.componentRef.setInput('memory', processor.dataMemory);
    fixture.componentRef.setInput('titleKey', 'MEMORY.DATA');
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component).toBeTruthy();
    // memoria de datos por defecto: config.memorySize bytes, agrupados en palabras de 4 bytes
    expect(component.memoryWords().length).toBe(processor.dataMemory.get().length / 4);
    // sin búsqueda, filteredWords === memoryWords
    expect(component.filteredWords().length).toBe(component.memoryWords().length);
  });

  it('matchesQuery (vía filteredWords) filtra en modo hex por el valor "0x" indistintamente de mayúsculas', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();

    processor.dataMemory.write(0, 0xf0, 4);

    const fixture = TestBed.createComponent(MemoryViewComponent);
    fixture.componentRef.setInput('memory', processor.dataMemory);
    fixture.componentRef.setInput('titleKey', 'MEMORY.DATA');
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.displayMode.set('hex');
    component.searchQuery.set('0x000000F0');
    fixture.detectChanges();

    const matches = component.filteredWords();
    expect(matches.some(w => w.address === 0)).toBe(true);
  });

  it('en modo dec y ascii el filtrado devuelve solo las palabras que casan con la búsqueda', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();

    processor.dataMemory.write(0, 65, 1); // 'A'
    processor.dataMemory.write(4, 200, 4);

    const fixture = TestBed.createComponent(MemoryViewComponent);
    fixture.componentRef.setInput('memory', processor.dataMemory);
    fixture.componentRef.setInput('titleKey', 'MEMORY.DATA');
    fixture.detectChanges();

    const component = fixture.componentInstance;

    component.displayMode.set('dec');
    component.searchQuery.set('200');
    fixture.detectChanges();
    expect(component.filteredWords().some(w => w.address === 4)).toBe(true);
    expect(component.filteredWords().some(w => w.address === 0)).toBe(false);

    component.displayMode.set('ascii');
    component.searchQuery.set('a');
    fixture.detectChanges();
    expect(component.filteredWords().some(w => w.address === 0)).toBe(true);
  });

  it('una búsqueda vacía (tras trim) devuelve todas las palabras sin filtrar', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();

    const fixture = TestBed.createComponent(MemoryViewComponent);
    fixture.componentRef.setInput('memory', processor.dataMemory);
    fixture.componentRef.setInput('titleKey', 'MEMORY.DATA');
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.searchQuery.set('   ');
    fixture.detectChanges();

    expect(component.filteredWords().length).toBe(component.memoryWords().length);
  });

  // Los tests anteriores fijan searchQuery/displayMode directamente sobre la instancia; los
  // siguientes disparan los eventos DOM reales ((input), (click), (ngModelChange)) para cubrir
  // los listeners generados por la plantilla.
  it('escribir en el buscador (evento input real) filtra las palabras de memoria', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();
    processor.dataMemory.write(4, 200, 4);

    const fixture = TestBed.createComponent(MemoryViewComponent);
    fixture.componentRef.setInput('memory', processor.dataMemory);
    fixture.componentRef.setInput('titleKey', 'MEMORY.DATA');
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('.search-input');
    input.value = '200';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.searchQuery()).toBe('200');
  });

  it('el botón de limpiar búsqueda (clic real) vacía searchQuery', () => {
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();

    const fixture = TestBed.createComponent(MemoryViewComponent);
    fixture.componentRef.setInput('memory', processor.dataMemory);
    fixture.componentRef.setInput('titleKey', 'MEMORY.DATA');
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

    const fixture = TestBed.createComponent(MemoryViewComponent);
    fixture.componentRef.setInput('memory', processor.dataMemory);
    fixture.componentRef.setInput('titleKey', 'MEMORY.DATA');
    fixture.detectChanges();

    const toggles: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('mat-button-toggle'));
    const hexToggle = toggles.find(t => t.textContent?.trim() === 'HEX');
    expect(hexToggle).toBeTruthy();
    (hexToggle!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.displayMode()).toBe('hex');
  });
});
