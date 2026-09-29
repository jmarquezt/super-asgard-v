import { TestBed } from '@angular/core/testing';
import { PipelineViewComponent } from '../../src/app/shared/pipeline-view/pipeline-view.component';
import { AsgConfigService } from '../../src/app/core/services/asg.config';
import { AsgAssemblerService } from '../../src/app/core/services/assembly/asg.assembler';
import { AsgPipelinedProcessorService } from '../../src/app/core/services/processor/asg.pipelined.processor';
import { AsgNonPipelinedProcessorService } from '../../src/app/core/services/processor/asg.non-pipelined.processor';
import { integrationTestProviders, resetIntegrationEnvironment } from './test-providers';

describe('PipelineViewComponent (integración)', () => {
  beforeEach(async () => {
    resetIntegrationEnvironment();
    await TestBed.configureTestingModule({
      imports: [PipelineViewComponent],
      providers: [integrationTestProviders()],
    }).compileComponents();
  });

  it('se crea y renderiza las etapas del pipeline por defecto (pipelined)', () => {
    TestBed.inject(AsgPipelinedProcessorService);
    const fixture = TestBed.createComponent(PipelineViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.processor).toBeInstanceOf(AsgPipelinedProcessorService);

    const stageBoxes = fixture.nativeElement.querySelectorAll('.stage-box');
    expect(stageBoxes.length).toBe(5);
  });

  it('devuelve el procesador no segmentado cuando la configuración cambia a non-pipelined', () => {
    TestBed.inject(AsgPipelinedProcessorService);
    const fixture = TestBed.createComponent(PipelineViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    TestBed.inject(AsgConfigService).updateConfig({ processorType: 'non-pipelined' });
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.processor).toBeInstanceOf(AsgNonPipelinedProcessorService);
  });

  it('muestra el badge de estado como pausado cuando el procesador no está corriendo', () => {
    TestBed.inject(AsgPipelinedProcessorService);
    const fixture = TestBed.createComponent(PipelineViewComponent);
    TestBed.tick();
    fixture.detectChanges();

    const statusBadge = fixture.nativeElement.querySelector('.status-badge');
    expect(statusBadge).toBeTruthy();
    expect(statusBadge.classList.contains('running')).toBe(false);
  });

  it('con una instrucción real en EX/MEM, muestra el opcode en vez del mensaje vacío', () => {
    const assembler = TestBed.inject(AsgAssemblerService);
    const processor = TestBed.inject(AsgPipelinedProcessorService);
    TestBed.tick();

    const result = assembler.assembleProgram([{
      name: 'main', source: `
      .text
      ADDI R1, R0, #5
      ADDI R2, R0, #10
      ADD  R3, R1, R2
      TRAP 0
    `}]);
    expect(result.success).toBe(true);
    processor.load(result.instructionBinary, result.dataBuffer, result.initialCodePtr);
    processor.nextCycle();
    processor.nextCycle();
    processor.nextCycle(); // tras 3 ciclos, la 1ª instrucción (ADDI) debería estar en EX

    const fixture = TestBed.createComponent(PipelineViewComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.processor.pipeline.EX).not.toBeNull();
    const exBox = fixture.nativeElement.querySelector('.stage-box.stage-EX');
    expect(exBox.classList.contains('active')).toBe(true);
    expect(exBox.textContent).toContain('ADDI');
  });
});
