import { TestBed } from '@angular/core/testing';
import { LogService } from '../../src/app/services/log';
import { AsgConfigService } from '../../src/app/core/services/asg.config';

describe('LogService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('añade entradas al principio del log (más reciente primero)', () => {
    const log = TestBed.inject(LogService);
    // Con el logLevel por defecto ('relevant') solo pasan 'error' y 'success' (ver shouldLog()).
    log.log('primero', 'success', 1);
    log.log('segundo', 'success', 2);

    const entries = log.eventLog();
    expect(entries[0].message).toBe('segundo');
    expect(entries[1].message).toBe('primero');
  });

  it('respeta el nivel de log configurado', () => {
    TestBed.inject(AsgConfigService).updateConfig({ logLevel: 'error' });
    const log = TestBed.inject(LogService);

    log.log('info ignorado', 'info', 1);
    log.log('warning ignorado', 'warning', 1);
    log.log('error registrado', 'error', 1);

    const messages = log.eventLog().map(e => e.message);
    expect(messages).toEqual(['error registrado']);
  });

  it('no registra nada si el logging está desactivado', () => {
    TestBed.inject(AsgConfigService).updateConfig({ loggingEnabled: false });
    const log = TestBed.inject(LogService);

    log.log('no debería aparecer', 'error', 1);

    expect(log.eventLog()).toEqual([]);
  });

  it('agrupa los logs durante un ciclo y los libera con flushLogs', () => {
    const log = TestBed.inject(LogService);
    log.beginCycle();
    log.log('durante el ciclo', 'success', 1);

    // Mientras el ciclo está "abierto" el mensaje se retiene, no se publica todavía
    expect(log.eventLog()).toEqual([]);

    log.flushLogs();
    expect(log.eventLog().map(e => e.message)).toEqual(['durante el ciclo']);
  });

  it('limpia el log con clearLog', () => {
    const log = TestBed.inject(LogService);
    log.log('algo', 'success', 1);
    log.clearLog();
    expect(log.eventLog()).toEqual([]);
  });

  it('reset limpia el log y el estado de agrupación por ciclo', () => {
    const log = TestBed.inject(LogService);
    log.beginCycle();
    log.log('pendiente', 'success', 1);
    log.reset();

    expect(log.eventLog()).toEqual([]);

    // Tras reset ya no estamos "dentro" de un ciclo: un nuevo log se publica directamente
    log.log('tras reset', 'success', 2);
    expect(log.eventLog().map(e => e.message)).toEqual(['tras reset']);
  });
});
