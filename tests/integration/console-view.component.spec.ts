import { TestBed } from '@angular/core/testing';
import { ConsoleViewComponent } from '../../src/app/shared/console-view/console-view.component';
import { AsgProcessorFactoryService } from '../../src/app/core/services/processor/asg.processor-factory';
import { AsgAssemblerService } from '../../src/app/core/services/assembly/asg.assembler';
import { AsgPipelinedProcessorService } from '../../src/app/core/services/processor/asg.pipelined.processor';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('ConsoleViewComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [ConsoleViewComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea con la salida de consola vacía por defecto', () => {
    const factory = TestBed.inject(AsgProcessorFactoryService);
    TestBed.tick();

    const fixture = TestBed.createComponent(ConsoleViewComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    expect(component).toBeTruthy();
    expect(component.consoleOutput()).toEqual([]);
    expect(component.fullOutput).toBe('');
    expect(component.trapStdinRequest()).toBeNull();
    // El componente y el factory apuntan al mismo procesador subyacente
    expect(factory.getProcessor().consoleOutput()).toEqual([]);
  });

  it('clear() vacía la salida de consola del procesador actual', () => {
    const factory = TestBed.inject(AsgProcessorFactoryService);
    TestBed.tick();
    factory.getProcessor().consoleOutput.set(['hola\n', 'mundo\n']);

    const fixture = TestBed.createComponent(ConsoleViewComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    expect(component.consoleOutput().length).toBe(2);

    component.clear();
    fixture.detectChanges();

    expect(component.consoleOutput()).toEqual([]);
  });

  it('submitInput() sin una petición de stdin pendiente añade el texto a la salida y no lanza excepción', () => {
    TestBed.inject(AsgProcessorFactoryService);
    TestBed.tick();

    const fixture = TestBed.createComponent(ConsoleViewComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    (component as any).inputText = 'hola mundo';

    expect(() => component.submitInput()).not.toThrow();
    expect(component.consoleOutput()).toEqual(['hola mundo\n']);
    expect((component as any).inputText).toBe('');
  });

  it('con una petición de stdin real (TRAP 3) pendiente, renderiza la línea de entrada y submitInput() la resuelve', () => {
    const assembler = TestBed.inject(AsgAssemblerService);
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();

    const result = assembler.assembleProgram([{
      name: 'main', source: `
      .data
      params: .word 0, buffer, 80
      buffer: .space 80
      .text
      ADDI R14, R0, params
      TRAP 3
      TRAP 0
    `}]);
    expect(result.success).toBe(true);
    processor.load(result.instructionBinary, result.dataBuffer, result.initialCodePtr);

    let guard = 0;
    while (!processor.trapStdinRequest() && guard < 50) {
      processor.nextCycle();
      guard++;
    }
    expect(guard).toBeLessThan(50);

    const fixture = TestBed.createComponent(ConsoleViewComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance as any;
    expect(component.trapStdinRequest()).not.toBeNull();

    const stdinLine = fixture.nativeElement.querySelector('.stdin-line');
    const stdinInput = fixture.nativeElement.querySelector('.stdin-input');
    expect(stdinLine).toBeTruthy();
    expect(stdinInput).toBeTruthy();

    component.inputText = 'hola';
    component.submitInput();
    fixture.detectChanges();

    expect(processor.trapStdinRequest()).toBeNull();
    expect(component.trapStdinRequest()).toBeNull();
    expect(fixture.nativeElement.querySelector('.stdin-line')).toBeFalsy();
  });

  // Los tests anteriores llaman a clear()/submitInput() directamente sobre la instancia; los
  // siguientes disparan los eventos DOM reales ((click), (ngModelChange) vía input,
  // (keydown.enter)) para cubrir los listeners generados por la plantilla.
  it('el botón CLR (clic real) vacía la salida de consola', () => {
    const factory = TestBed.inject(AsgProcessorFactoryService);
    TestBed.tick();
    factory.getProcessor().consoleOutput.set(['hola\n']);

    const fixture = TestBed.createComponent(ConsoleViewComponent);
    fixture.detectChanges();

    const clearBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.clear-btn');
    clearBtn.click();
    fixture.detectChanges();

    expect(factory.getProcessor().consoleOutput()).toEqual([]);
  });

  it('escribir en la línea de stdin y pulsar Enter (eventos reales) resuelve la petición TRAP 3', () => {
    const assembler = TestBed.inject(AsgAssemblerService);
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();

    const result = assembler.assembleProgram([{
      name: 'main', source: `
      .data
      params: .word 0, buffer, 80
      buffer: .space 80
      .text
      ADDI R14, R0, params
      TRAP 3
      TRAP 0
    `}]);
    expect(result.success).toBe(true);
    processor.load(result.instructionBinary, result.dataBuffer, result.initialCodePtr);

    let guard = 0;
    while (!processor.trapStdinRequest() && guard < 50) {
      processor.nextCycle();
      guard++;
    }
    expect(guard).toBeLessThan(50);

    const fixture = TestBed.createComponent(ConsoleViewComponent);
    fixture.detectChanges();

    const stdinInput: HTMLInputElement = fixture.nativeElement.querySelector('.stdin-input');
    stdinInput.value = 'hola';
    stdinInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect((fixture.componentInstance as any).inputText).toBe('hola');

    stdinInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    expect(processor.trapStdinRequest()).toBeNull();
    expect(fixture.nativeElement.querySelector('.stdin-line')).toBeFalsy();
  });
});
