import { FunctionalUnitPool } from '../../src/app/core/models/superscalar/fu-pool';
import { DEFAULT_SUPERSCALAR_CONFIG } from '../../src/app/core/models/asg.config';
import { ROBTag } from '../../src/app/core/models/superscalar/rob';
import { RSEntry, createEmptyRSEntry } from '../../src/app/core/models/superscalar/rs';
import { AsgInstruction } from '../../src/app/core/models/instructions/asg.instruction';

const tag = (slot: number, generation = 0): ROBTag => ({ slot, generation });

function scalarEntry(cyclesRemaining = 3): RSEntry {
  return {
    ...createEmptyRSEntry(),
    opcode: 'MULT',
    fuType: 'INT_MUL',
    instrRef: { opcode: 'MULT', isVector: false, cyclesRemaining } as unknown as AsgInstruction,
  };
}

function vectorEntry(opcode = 'ADDV'): RSEntry {
  return {
    ...createEmptyRSEntry(),
    opcode,
    fuType: 'VEC_INT',
    instrRef: { opcode, isVector: true } as unknown as AsgInstruction,
  };
}

describe('FunctionalUnitPool', () => {
  it('crea exactamente el número de unidades configurado por tipo', () => {
    const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, intALUs: 2, intMulUnits: 1 });
    expect(pool.getUnits('INT_ALU')).toHaveLength(2);
    expect(pool.getUnits('INT_MUL')).toHaveLength(1);
    expect(pool.countAvailable('INT_ALU')).toBe(2);
  });

  it('reserve() ocupa una unidad libre y hasAvailable refleja la ocupación', () => {
    const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, intMulUnits: 1 });
    const unitId = pool.reserve('INT_MUL', tag(1), 0, scalarEntry(3));

    expect(unitId).toBeGreaterThanOrEqual(0);
    expect(pool.hasAvailable('INT_MUL')).toBe(false);
    expect(pool.countAvailable('INT_MUL')).toBe(0);
  });

  it('reserve() devuelve -1 cuando no hay ninguna unidad libre del tipo pedido', () => {
    const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, intMulUnits: 1 });
    pool.reserve('INT_MUL', tag(1), 0, scalarEntry());
    expect(pool.reserve('INT_MUL', tag(2), 0, scalarEntry())).toBe(-1);
  });

  it('tick() decrementa la latencia y libera la unidad cuando llega a 0', () => {
    const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, intMulUnits: 1 });
    const unitId = pool.reserve('INT_MUL', tag(5), 0, scalarEntry(2)); // 2 ciclos de latencia
    pool.setResult(unitId, 42);

    expect(pool.tick(1)).toEqual([]); // 1er ciclo: aún no termina
    expect(pool.hasAvailable('INT_MUL')).toBe(false);

    const finished = pool.tick(2); // 2º ciclo: termina
    expect(finished).toEqual([{ unitId, robTag: tag(5), result: 42, vectorResult: null }]);
    expect(pool.hasAvailable('INT_MUL')).toBe(true);
  });

  it('cancel() libera la unidad asociada a un ROBTag concreto (ej. tras un flush)', () => {
    const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, intMulUnits: 1 });
    pool.reserve('INT_MUL', tag(3), 0, scalarEntry());
    pool.cancel(tag(3));
    expect(pool.hasAvailable('INT_MUL')).toBe(true);
  });

  it('flushFrom libera las unidades cuyo ROBTag queda por delante del punto de flush', () => {
    const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, intALUs: 2 });
    pool.reserve('INT_ALU', tag(2), 0, scalarEntry()); // anterior: se conserva ocupada
    pool.reserve('INT_ALU', tag(6), 0, scalarEntry()); // posterior al flush: se libera

    const flushed = pool.flushFrom(5, 0, 8);

    expect(flushed).toBe(1);
    expect(pool.countAvailable('INT_ALU')).toBe(1);
  });

  it('getUtilizationByType / getTotalUtilization reflejan las unidades ocupadas', () => {
    const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, intALUs: 2, intMulUnits: 2 });
    pool.reserve('INT_ALU', tag(1), 0, scalarEntry());

    expect(pool.getUtilizationByType().get('INT_ALU')).toBe(0.5);
    expect(pool.getUtilizationByType().get('INT_MUL')).toBe(0);
    expect(pool.getBusyUnits()).toHaveLength(1);
  });

  it('reset() libera todas las unidades y limpia las operaciones en curso', () => {
    const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, intMulUnits: 1 });
    pool.reserve('INT_MUL', tag(1), 0, scalarEntry());
    pool.reset();
    expect(pool.getTotalUtilization()).toBe(0);
  });

  it('getVectorLatency() sin latencyConfig usa el valor por defecto ceil(vl/aluLanes)+1', () => {
    // Sin pasar latencyConfig (3er argumento del constructor): ejercita la rama por defecto
    // de getVectorLatency(), que no depende de la configuración de latencias del usuario.
    const pool = new FunctionalUnitPool(
      { ...DEFAULT_SUPERSCALAR_CONFIG, vecIntUnits: 1 },
      undefined,
      { vl: 8, aluLanes: 4, memLanes: 4 },
    );

    const unitId = pool.reserve('VEC_INT', tag(1), 0, vectorEntry('ADDV'));

    expect(unitId).toBeGreaterThanOrEqual(0);
    // ceil(8/4) + 1 = 3 ciclos; no hay forma pública de leer cyclesRemaining directamente,
    // pero sí de comprobar que la unidad sigue ocupada tras 2 ciclos y libre al 3º.
    expect(pool.getAllUnits().find(u => u.id === unitId)?.cyclesRemaining).toBe(3);
  });

  describe('solapamiento de instrucciones vectoriales (init overlap)', () => {
    it('hasAvailableForVectorOverlap/getOverlappableFU detectan una FU ocupada sin operación pendiente', () => {
      const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, vecIntUnits: 1 });
      const unitId = pool.reserve('VEC_INT', tag(1), 0, vectorEntry());

      expect(pool.hasAvailable('VEC_INT')).toBe(false); // ninguna libre del todo
      expect(pool.hasAvailableForVectorOverlap('VEC_INT')).toBe(true); // pero sí solapable
      expect(pool.getOverlappableFU('VEC_INT')).toBe(unitId);
    });

    it('reservePending() reserva la operación en la FU ocupada; hasPendingOp/getPendingOp la reflejan', () => {
      const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, vecIntUnits: 1 });
      const unitId = pool.reserve('VEC_INT', tag(1), 0, vectorEntry());

      expect(pool.hasPendingOp(unitId)).toBe(false);

      const reservedId = pool.reservePending('VEC_INT', tag(2), 1, vectorEntry());

      expect(reservedId).toBe(unitId);
      expect(pool.hasPendingOp(unitId)).toBe(true);
      expect(pool.getPendingOp(unitId)?.robTag).toEqual(tag(2));

      // Con una operación pendiente ya reservada, esa misma FU deja de ofrecerse para solapar otra.
      expect(pool.hasAvailableForVectorOverlap('VEC_INT')).toBe(false);
      expect(pool.getOverlappableFU('VEC_INT')).toBe(-1);
    });

    it('reservePending() devuelve -1 si no hay ninguna FU ocupada disponible para solapar', () => {
      const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, vecIntUnits: 1 });
      // Ninguna unidad reservada todavía: no hay FU "ocupada" que solapar.
      expect(pool.reservePending('VEC_INT', tag(1), 0, vectorEntry())).toBe(-1);
    });

    it('promotePending() mueve la operación pendiente a principal y libera el hueco pendiente', () => {
      const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, vecIntUnits: 1 });
      const unitId = pool.reserve('VEC_INT', tag(1), 0, vectorEntry());
      pool.reservePending('VEC_INT', tag(2), 1, vectorEntry());

      const promoted = pool.promotePending(unitId);

      expect(promoted?.robTag).toEqual(tag(2));
      expect(pool.hasPendingOp(unitId)).toBe(false);
      // Tras promocionar, la FU ya vuelve a estar disponible para solapar otra futura reserva.
      expect(pool.hasAvailableForVectorOverlap('VEC_INT')).toBe(true);
    });

    it('promotePending() devuelve null si no había ninguna operación pendiente en esa FU', () => {
      const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, vecIntUnits: 1 });
      const unitId = pool.reserve('VEC_INT', tag(1), 0, vectorEntry());
      expect(pool.promotePending(unitId)).toBeNull();
    });

    it('finishVectorInstruction() promueve la operación pendiente en vez de liberar la FU', () => {
      const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, vecIntUnits: 1 });
      const unitId = pool.reserve('VEC_INT', tag(1), 0, vectorEntry());
      pool.reservePending('VEC_INT', tag(2), 1, vectorEntry());

      const finished = pool.finishVectorInstruction(unitId);

      expect(finished?.robTag).toEqual(tag(1));
      expect(pool.hasAvailable('VEC_INT')).toBe(false); // la FU sigue ocupada: la tomó la pendiente
      expect(pool.hasPendingOp(unitId)).toBe(false); // ya no está "pendiente", ahora es la principal
    });

    it('cancel() de la operación principal promueve la pendiente en su lugar (no libera la FU)', () => {
      const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, vecIntUnits: 1 });
      const unitId = pool.reserve('VEC_INT', tag(1), 0, vectorEntry());
      pool.reservePending('VEC_INT', tag(2), 1, vectorEntry());

      pool.cancel(tag(1));

      expect(pool.hasAvailable('VEC_INT')).toBe(false); // la pendiente ocupa el hueco
      expect(pool.hasPendingOp(unitId)).toBe(false);
    });

    it('cancel() de una operación pendiente (sin cancelar la principal) solo la retira a ella', () => {
      const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, vecIntUnits: 1 });
      const unitId = pool.reserve('VEC_INT', tag(1), 0, vectorEntry());
      pool.reservePending('VEC_INT', tag(2), 1, vectorEntry());

      pool.cancel(tag(2));

      expect(pool.hasPendingOp(unitId)).toBe(false);
      expect(pool.hasAvailable('VEC_INT')).toBe(false); // la principal (tag 1) sigue en curso
    });

    it('flushFrom() descarta una operación pendiente por delante del punto de flush sin tocar la principal', () => {
      const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, vecIntUnits: 1 });
      const unitId = pool.reserve('VEC_INT', tag(1), 0, vectorEntry()); // posUnit=1 < posFrom=5: sobrevive
      pool.reservePending('VEC_INT', tag(6), 1, vectorEntry()); // posOp=6 >= posFrom=5: se descarta

      const flushed = pool.flushFrom(5, 0, 8);

      expect(flushed).toBe(1); // solo la pendiente
      expect(pool.hasPendingOp(unitId)).toBe(false);
      expect(pool.getUnits('VEC_INT')[0].robTag).toEqual(tag(1)); // la principal no se ha tocado
    });

    it('flushFrom() promueve la operación pendiente cuando la principal se descarta pero la pendiente sobrevive', () => {
      // La operación PRINCIPAL (tag 6) queda por delante del punto de flush (posUnit=6 >= posFrom=5)
      // y se descartaría; la PENDIENTE (tag 2) queda por detrás (posOp=2 < posFrom=5) y sobrevive al
      // primer bucle de flushFrom (el que limpia pendingVectorOp). Al llegar al segundo bucle (el que
      // limpia las FUs principales), sigue existiendo esa pendiente para esa FU, así que se promueve
      // en vez de simplemente liberar la unidad.
      const pool = new FunctionalUnitPool({ ...DEFAULT_SUPERSCALAR_CONFIG, vecIntUnits: 1 });
      const unitId = pool.reserve('VEC_INT', tag(6), 0, vectorEntry());
      pool.reservePending('VEC_INT', tag(2), 1, vectorEntry());

      const flushed = pool.flushFrom(5, 0, 8);

      expect(flushed).toBe(1); // solo la principal cuenta como flusheada (la pendiente sobrevivió)
      expect(pool.hasPendingOp(unitId)).toBe(false); // promotePending() la retira de "pendiente"
      // promotePending() deja unit.busy=true con el robTag de la operación promovida: la FU
      // sigue ocupada (ahora por la que era la pendiente), no queda libre.
      expect(pool.hasAvailable('VEC_INT')).toBe(false);
      expect(pool.getUnits('VEC_INT')[0].robTag).toEqual(tag(2));
    });
  });
});
