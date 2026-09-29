import { TestBed } from '@angular/core/testing';
import { AsgProcessorFactoryService } from '../../src/app/core/services/processor/asg.processor-factory';
import { AsgConfigService } from '../../src/app/core/services/asg.config';
import { AsgPipelinedProcessorService } from '../../src/app/core/services/processor/asg.pipelined.processor';
import { AsgNonPipelinedProcessorService } from '../../src/app/core/services/processor/asg.non-pipelined.processor';
import { AsgSuperscalarProcessorService } from '../../src/app/core/services/processor/asg.superscalar.processor';

describe('AsgProcessorFactoryService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('selecciona el procesador segmentado (pipelined) por defecto', () => {
    const factory = TestBed.inject(AsgProcessorFactoryService);

    expect(factory.getCurrentType()).toBe('pipelined');
    expect(factory.getProcessor()).toBeInstanceOf(AsgPipelinedProcessorService);
    expect(factory.isSuperscalar()).toBe(false);
    expect(factory.isNonPipelined()).toBe(false);
  });

  it('selecciona el procesador monociclo cuando la configuración lo indica', () => {
    TestBed.inject(AsgConfigService).updateConfig({ processorType: 'non-pipelined' });
    const factory = TestBed.inject(AsgProcessorFactoryService);

    expect(factory.getProcessor()).toBeInstanceOf(AsgNonPipelinedProcessorService);
    expect(factory.isNonPipelined()).toBe(true);
    expect(factory.isSuperscalar()).toBe(false);
  });

  it('selecciona el procesador superescalar cuando la configuración lo indica', () => {
    TestBed.inject(AsgConfigService).updateConfig({ processorType: 'superscalar' });
    const factory = TestBed.inject(AsgProcessorFactoryService);

    expect(factory.getProcessor()).toBeInstanceOf(AsgSuperscalarProcessorService);
    expect(factory.isSuperscalar()).toBe(true);
    expect(factory.isNonPipelined()).toBe(false);
  });
});
