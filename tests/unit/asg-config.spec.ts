import { AsgConfigService } from '../../src/app/core/services/asg.config';

describe('AsgConfigService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with the default configuration when nothing is stored', () => {
    const config = new AsgConfigService();
    const current = config.getCurrentConfig();

    expect(current.processorType).toBe('pipelined');
    expect(current.memorySize).toBe(4096);
    expect(current.enableForwarding).toBe(true);
    expect(current.branchPredictionStrategy).toBe('none');
  });

  it('merges a partial update into the current configuration', () => {
    const config = new AsgConfigService();
    config.updateConfig({ enableForwarding: false, memorySize: 8192 });

    const current = config.getCurrentConfig();
    expect(current.enableForwarding).toBe(false);
    expect(current.memorySize).toBe(8192);
    // El resto de propiedades no tocadas se conservan
    expect(current.processorType).toBe('pipelined');
  });

  it('persists the updated configuration to localStorage', () => {
    const config = new AsgConfigService();
    config.updateConfig({ memorySize: 2048 });

    const stored = JSON.parse(localStorage.getItem('asg_config')!);
    expect(stored.memorySize).toBe(2048);
  });

  it('loads a previously stored configuration on construction', () => {
    const first = new AsgConfigService();
    first.updateConfig({ processorType: 'superscalar' });

    const second = new AsgConfigService();
    expect(second.getCurrentConfig().processorType).toBe('superscalar');
  });

  it('fills in defaults for latency fields missing from a stored configuration', () => {
    localStorage.setItem('asg_config', JSON.stringify({ memorySize: 1234 }));

    const config = new AsgConfigService();
    const current = config.getCurrentConfig();

    expect(current.memorySize).toBe(1234);
    expect(current.latencies).toBeDefined();
    expect(current.superscalar).toBeDefined();
  });
});
