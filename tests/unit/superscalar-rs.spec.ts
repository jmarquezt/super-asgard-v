import {
  CentralizedRS,
  ClusteredRS,
  DistributedRS,
  IReservationStations,
  RSEntry,
  createEmptyRSEntry,
  createReservationStations,
} from '../../src/app/core/models/superscalar/rs';
import { ROBTag } from '../../src/app/core/models/superscalar/rob';
import { AsgInstruction } from '../../src/app/core/models/instructions/asg.instruction';
import { DEFAULT_SUPERSCALAR_CONFIG } from '../../src/app/core/models/asg.config';

const tag = (slot: number, generation = 0): ROBTag => ({ slot, generation });

function entry(overrides: Partial<RSEntry> = {}): RSEntry {
  return {
    ...createEmptyRSEntry(),
    opcode: 'ADD',
    fuType: 'INT_ALU',
    destino: tag(1),
    instrRef: { opcode: 'ADD' } as unknown as AsgInstruction,
    cycleDispatched: 0,
    ...overrides,
  };
}

// Las tres organizaciones de RS comparten la misma interfaz (IReservationStations) y el mismo
// comportamiento esperado; solo cambia CÓMO agrupan las entradas por dentro (una única cola,
// una cola por UF, o una cola por cluster). Por eso el grueso de los tests corre igual sobre
// las tres, parametrizado, y solo lo específico de cada organización va aparte.
const VARIANTS: [string, () => IReservationStations][] = [
  ['centralizada', () => new CentralizedRS(4)],
  ['distribuida', () => new DistributedRS(4)],
  ['clustered', () => new ClusteredRS({ intCluster: 4, fpCluster: 4, memCluster: 4, vecCluster: 4 })],
];

describe.each(VARIANTS)('Estaciones de reserva — %s', (_name, makeRS) => {
  it('empieza con espacio libre para cualquier tipo de UF', () => {
    const rs = makeRS();
    expect(rs.hasSpace('INT_ALU')).toBe(true);
    expect(rs.freeEntries('INT_ALU')).toBe(4);
  });

  it('dispatch() ocupa una entrada y la marca lista si no espera ningún operando', () => {
    const rs = makeRS();
    const idx = rs.dispatch(entry({ v1: 1, v2: 2, q1: null, q2: null }), 'INT_ALU');

    expect(idx).toBeGreaterThanOrEqual(0);
    expect(rs.freeEntries('INT_ALU')).toBe(3);
    expect(rs.getReadyToIssue('INT_ALU', 10)).toHaveLength(1);
  });

  it('una entrada que espera un operando (Q1) no está lista hasta que llega por el CDB', () => {
    const rs = makeRS();
    rs.dispatch(entry({ v1: null, q1: tag(5), v2: 10, q2: null }), 'INT_ALU');

    expect(rs.getReadyToIssue('INT_ALU', 10)).toHaveLength(0);

    rs.updateFromCDB({ robTag: tag(5), value: 99, vectorValue: null, fuType: 'INT_ALU', cycle: 1 });

    const ready = rs.getReadyToIssue('INT_ALU', 10);
    expect(ready).toHaveLength(1);
    expect(ready[0].v1).toBe(99);
  });

  it('getReadyToIssue respeta el límite y prioriza las entradas más antiguas', () => {
    const rs = makeRS();
    rs.dispatch(entry({ cycleDispatched: 5 }), 'INT_ALU');
    rs.dispatch(entry({ cycleDispatched: 1 }), 'INT_ALU');
    rs.dispatch(entry({ cycleDispatched: 3 }), 'INT_ALU');

    const ready = rs.getReadyToIssue('INT_ALU', 2);
    expect(ready).toHaveLength(2);
    expect(ready[0].cycleDispatched).toBe(1);
    expect(ready[1].cycleDispatched).toBe(3);
  });

  it('getReadyToIssue no mezcla entradas de otro tipo de UF', () => {
    const rs = makeRS();
    rs.dispatch(entry({ fuType: 'FP_MUL', opcode: 'MULTD' }), 'FP_MUL');
    expect(rs.getReadyToIssue('INT_ALU', 10)).toHaveLength(0);
    expect(rs.getReadyToIssue('FP_MUL', 10)).toHaveLength(1);
  });

  it('release() libera una entrada por su índice', () => {
    const rs = makeRS();
    const idx = rs.dispatch(entry(), 'INT_ALU');
    rs.release(idx);
    expect(rs.getAllOccupied()).toHaveLength(0);
  });

  it('releaseByRobTag libera la entrada cuyo destino coincide', () => {
    const rs = makeRS();
    rs.dispatch(entry({ destino: tag(7) }), 'INT_ALU');
    rs.dispatch(entry({ destino: tag(8) }), 'INT_ALU');

    rs.releaseByRobTag(tag(7));

    const remaining = rs.getAllOccupied();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].destino).toEqual(tag(8));
  });

  it('flushFrom descarta las entradas especulativas posteriores a un punto del ROB', () => {
    const rs = makeRS();
    rs.dispatch(entry({ destino: tag(2) }), 'INT_ALU'); // anterior al flush: se conserva
    rs.dispatch(entry({ destino: tag(5) }), 'INT_ALU'); // == fromTag: se descarta
    rs.dispatch(entry({ destino: tag(6) }), 'INT_ALU'); // posterior: se descarta

    const flushed = rs.flushFrom(5, 0, 8);

    expect(flushed).toBe(2);
    expect(rs.getAllOccupied().map(e => e.destino)).toEqual([tag(2)]);
  });

  it('reset() vacía todas las entradas', () => {
    const rs = makeRS();
    rs.dispatch(entry(), 'INT_ALU');
    rs.reset();
    expect(rs.getAllOccupied()).toHaveLength(0);
    expect(rs.getUtilization()).toBe(0);
  });
});

describe('createReservationStations (fábrica según configuración)', () => {
  it('crea una CentralizedRS cuando rsType="centralized"', () => {
    const rs = createReservationStations({ ...DEFAULT_SUPERSCALAR_CONFIG, rsType: 'centralized' });
    expect(rs).toBeInstanceOf(CentralizedRS);
    expect(rs.type).toBe('centralized');
  });

  it('crea una DistributedRS cuando rsType="distributed"', () => {
    const rs = createReservationStations({ ...DEFAULT_SUPERSCALAR_CONFIG, rsType: 'distributed' });
    expect(rs).toBeInstanceOf(DistributedRS);
  });

  it('crea una ClusteredRS cuando rsType="clustered"', () => {
    const rs = createReservationStations({ ...DEFAULT_SUPERSCALAR_CONFIG, rsType: 'clustered' });
    expect(rs).toBeInstanceOf(ClusteredRS);
  });
});

describe('DistributedRS — detalle específico', () => {
  it('dos tipos de UF distintos tienen cupos independientes (no comparten cola)', () => {
    const rs = new DistributedRS(1); // 1 hueco por UF
    expect(rs.dispatch(entry({ fuType: 'INT_ALU' }), 'INT_ALU')).toBeGreaterThanOrEqual(0);
    // INT_ALU ya está lleno (1 hueco), pero eso no afecta a INT_MUL, que sigue vacía
    expect(rs.hasSpace('INT_ALU')).toBe(false);
    expect(rs.hasSpace('INT_MUL')).toBe(true);
  });

  it('getUtilizationByType calcula la ocupación de cada estación por separado', () => {
    const rs = new DistributedRS(2);
    rs.dispatch(entry({ fuType: 'INT_ALU' }), 'INT_ALU');
    const util = rs.getUtilizationByType();
    expect(util.get('INT_ALU')).toBe(0.5);
    expect(util.get('FP_MUL')).toBe(0);
  });
});

describe('ClusteredRS — detalle específico', () => {
  it('INT_ALU e INT_MUL comparten el mismo cluster "int" (SÍ compiten por espacio)', () => {
    const rs = new ClusteredRS({ intCluster: 1, fpCluster: 1, memCluster: 1, vecCluster: 1 });
    expect(rs.dispatch(entry({ fuType: 'INT_ALU' }), 'INT_ALU')).toBeGreaterThanOrEqual(0);
    // El cluster "int" ya está lleno (1 hueco compartido), así que INT_MUL tampoco tiene espacio
    expect(rs.hasSpace('INT_MUL')).toBe(false);
  });

  it('getUtilizationByCluster calcula la ocupación de cada cluster por separado', () => {
    const rs = new ClusteredRS({ intCluster: 2, fpCluster: 2, memCluster: 2, vecCluster: 2 });
    rs.dispatch(entry({ fuType: 'INT_ALU' }), 'INT_ALU');
    const util = rs.getUtilizationByCluster();
    expect(util.get('int')).toBe(0.5);
    expect(util.get('fp')).toBe(0);
  });
});
