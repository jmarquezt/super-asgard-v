import { ROB, robTagEquals, robTagMatches } from '../../src/app/core/models/superscalar/rob';
import { AsgInstruction } from '../../src/app/core/models/instructions/asg.instruction';
import { ExceptionCode } from '../../src/app/core/models/asg.exceptions';

// Instrucción mínima falsa: el ROB solo lee `instr.opcode` en allocate(), así que no hace falta
// una AsgInstruction real (que exige encoding válido) para estos tests.
function fakeInstr(opcode = 'ADD'): AsgInstruction {
  return { opcode } as unknown as AsgInstruction;
}

describe('ROB (Reorder Buffer del superescalar)', () => {
  it('empieza vacío y con toda la capacidad libre', () => {
    const rob = new ROB(4);
    expect(rob.isEmpty()).toBe(true);
    expect(rob.isFull()).toBe(false);
    expect(rob.freeEntries()).toBe(4);
    expect(rob.occupiedEntries()).toBe(0);
  });

  it('allocate() ocupa una entrada en orden FIFO y se llena tras `size` asignaciones', () => {
    const rob = new ROB(2);
    const tag1 = rob.allocate(fakeInstr(), 100, 1, 'R', 0);
    const tag2 = rob.allocate(fakeInstr(), 104, 2, 'R', 0);

    expect(tag1).toEqual({ slot: 0, generation: 0 });
    expect(tag2).toEqual({ slot: 1, generation: 0 });
    expect(rob.isFull()).toBe(true);
    expect(rob.allocate(fakeInstr(), 108, 3, 'R', 0)).toBeNull();
  });

  it('una entrada recién asignada no puede hacer commit hasta que se marque finalizada', () => {
    const rob = new ROB(2);
    rob.allocate(fakeInstr('ADDI'), 100, 1, 'R', 0);

    expect(rob.canCommit()).toBe(false);

    rob.markFinished(0, 42, null, 5);
    expect(rob.canCommit()).toBe(true);
    expect(rob.getHead()?.valor).toBe(42);
  });

  it('commit() respeta el orden del programa (FIFO) y libera la entrada', () => {
    const rob = new ROB(2);
    rob.allocate(fakeInstr('ADDI'), 100, 1, 'R', 0);
    rob.allocate(fakeInstr('ADDI'), 104, 2, 'R', 0);
    rob.markFinished(1, 20, null, 1); // La 2ª entrada termina ANTES que la 1ª (fuera de orden)

    // Aunque la 2ª ya está lista, no puede hacer commit porque la cabeza (la 1ª) no lo está
    expect(rob.canCommit()).toBe(false);

    rob.markFinished(0, 10, null, 2);
    expect(rob.canCommit()).toBe(true);

    const first = rob.commit();
    expect(first?.regDestino).toBe(1);
    expect(first?.valor).toBe(10);
    expect(rob.occupiedEntries()).toBe(1);

    expect(rob.canCommit()).toBe(true); // la 2ª ya estaba finalizada
    const second = rob.commit();
    expect(second?.regDestino).toBe(2);
    expect(rob.isEmpty()).toBe(true);
  });

  it('markException marca la entrada como inválida sin impedir el commit (la excepción se resuelve en RI)', () => {
    const rob = new ROB(2);
    rob.allocate(fakeInstr('LW'), 100, 1, 'R', 0);
    rob.markException(0, ExceptionCode.MEMORY_ALIGNMENT_ERROR);
    rob.markFinished(0, 0, null, 1);

    expect(rob.canCommit()).toBe(true);
    expect(rob.getHead()?.valida).toBe(false);
    expect(rob.getHead()?.excepcion).toBe(ExceptionCode.MEMORY_ALIGNMENT_ERROR);
  });

  describe('lookupValue (consulta de operandos pendientes)', () => {
    it('no encuentra un valor mientras la entrada no está finalizada', () => {
      const rob = new ROB(2);
      const tag = rob.allocate(fakeInstr(), 100, 1, 'R', 0)!;
      expect(rob.lookupValue(tag)).toEqual({ found: false });
    });

    it('encuentra el valor una vez finalizada la entrada', () => {
      const rob = new ROB(2);
      const tag = rob.allocate(fakeInstr(), 100, 1, 'R', 0)!;
      rob.markFinished(tag.slot, 77, null, 3);
      expect(rob.lookupValue(tag)).toEqual({ found: true, value: 77, vectorValue: null });
    });

    it('detecta un tag obsoleto (stale) cuando el slot se reutilizó tras un commit', () => {
      const rob = new ROB(1);
      const oldTag = rob.allocate(fakeInstr(), 100, 1, 'R', 0)!;
      rob.markFinished(oldTag.slot, 1, null, 1);
      rob.commit(); // libera el slot 0 e incrementa su generación

      rob.allocate(fakeInstr(), 200, 2, 'R', 0); // reutiliza el slot 0 con generación 1

      const result = rob.lookupValue(oldTag);
      expect(result.found).toBe(false);
      expect(result.stale).toBe(true);
    });
  });

  it('flushFrom descarta las entradas especulativas e incrementa su generación (invalidando tags antiguos)', () => {
    const rob = new ROB(4);
    const tag0 = rob.allocate(fakeInstr(), 100, 1, 'R', 0)!;
    rob.allocate(fakeInstr(), 104, 2, 'R', 0);
    const tagToFlush = rob.allocate(fakeInstr(), 108, 3, 'R', 0)!;
    rob.allocate(fakeInstr(), 112, 4, 'R', 0);

    const flushed = rob.flushFrom(tagToFlush.slot);

    expect(flushed).toBe(2); // las entradas en slot 2 y 3
    expect(rob.occupiedEntries()).toBe(2); // solo quedan las 2 primeras
    expect(rob.isOccupied(tag0.slot)).toBe(true);
    expect(rob.isOccupied(tagToFlush.slot)).toBe(false);
    // Un tag antiguo hacia una entrada descartada debe leerse como "no encontrado"
    expect(rob.lookupValue(tagToFlush).found).toBe(false);
  });

  it('hasStoreToAddress encuentra el store pendiente más reciente a una dirección (store-to-load forwarding)', () => {
    const rob = new ROB(4);
    rob.allocate(fakeInstr('SW'), 100, null, null, 0, true);
    rob.setStoreInfo(0, 0x100, 111);
    const loadTag = rob.allocate(fakeInstr('LW'), 104, 5, 'R', 0)!;

    const found = rob.hasStoreToAddress(0x100, loadTag.slot);
    expect(found?.storeValue).toBe(111);
    expect(rob.hasStoreToAddress(0x200, loadTag.slot)).toBeNull();
  });

  it('reset() vacía el ROB por completo', () => {
    const rob = new ROB(2);
    rob.allocate(fakeInstr(), 100, 1, 'R', 0);
    rob.reset();
    expect(rob.isEmpty()).toBe(true);
    expect(rob.getHeadTag()).toBe(0);
    expect(rob.getTailTag()).toBe(0);
  });

  it('isOccupied() devuelve false para tags fuera de rango', () => {
    const rob = new ROB(2);
    expect(rob.isOccupied(-1)).toBe(false);
    expect(rob.isOccupied(2)).toBe(false);
  });

  it('getEntry() devuelve null para tags fuera de rango', () => {
    const rob = new ROB(2);
    expect(rob.getEntry(-1)).toBeNull();
    expect(rob.getEntry(2)).toBeNull();
  });

  it('markIssued() marca una entrada ocupada como emitida (y no hace nada sobre una libre)', () => {
    const rob = new ROB(2);
    rob.allocate(fakeInstr(), 100, 1, 'R', 0);

    rob.markIssued(0);
    expect(rob.getEntry(0)?.emitida).toBe(true);

    expect(() => rob.markIssued(1)).not.toThrow(); // slot 1 libre: no-op seguro
    expect(rob.getEntry(1)?.emitida).toBe(false);
  });

  describe('predicción de saltos (setBranchInfo / updateBranchResult)', () => {
    it('sin branchInfo previo, updateBranchResult() devuelve false sin lanzar', () => {
      const rob = new ROB(2);
      rob.allocate(fakeInstr('BEQZ'), 100, null, null, 0);
      expect(rob.updateBranchResult(0, true, 200)).toBe(false);
    });

    it('predicción acertada (misma dirección y mismo destino): no hay misprediction', () => {
      const rob = new ROB(2);
      rob.allocate(fakeInstr('BEQZ'), 100, null, null, 0);
      rob.setBranchInfo(0, true, 200);

      const mispredicted = rob.updateBranchResult(0, true, 200);

      expect(mispredicted).toBe(false);
      expect(rob.getEntry(0)?.branchInfo?.mispredicted).toBe(false);
    });

    it('predicción acertada de "no tomado": no hay misprediction (el target no se compara)', () => {
      const rob = new ROB(2);
      rob.allocate(fakeInstr('BEQZ'), 100, null, null, 0);
      rob.setBranchInfo(0, false, 104);

      expect(rob.updateBranchResult(0, false, 999)).toBe(false);
    });

    it('misprediction de dirección (se predijo tomado y no se tomó, o viceversa)', () => {
      const rob = new ROB(2);
      rob.allocate(fakeInstr('BEQZ'), 100, null, null, 0);
      rob.setBranchInfo(0, true, 200);

      expect(rob.updateBranchResult(0, false, 104)).toBe(true);
      expect(rob.getEntry(0)?.branchInfo?.mispredicted).toBe(true);
    });

    it('misprediction de destino (se tomó como se predijo, pero el destino real es otro)', () => {
      const rob = new ROB(2);
      rob.allocate(fakeInstr('J'), 100, null, null, 0);
      rob.setBranchInfo(0, true, 200);

      expect(rob.updateBranchResult(0, true, 300)).toBe(true);
    });
  });

  describe('lookupValueBySlot (consulta legacy por slot, sin generación)', () => {
    it('no encuentra valor en un slot libre o no finalizado', () => {
      const rob = new ROB(2);
      expect(rob.lookupValueBySlot(0)).toEqual({ found: false });

      rob.allocate(fakeInstr(), 100, 1, 'R', 0);
      expect(rob.lookupValueBySlot(0)).toEqual({ found: false });
    });

    it('encuentra el valor de un slot finalizado', () => {
      const rob = new ROB(2);
      rob.allocate(fakeInstr(), 100, 1, 'R', 0);
      rob.markFinished(0, 55, null, 1);

      expect(rob.lookupValueBySlot(0)).toEqual({ found: true, value: 55, vectorValue: null });
    });
  });

  it('getOccupiedEntries() devuelve las entradas ocupadas empezando por la cabeza, en orden de programa', () => {
    const rob = new ROB(4);
    rob.allocate(fakeInstr('A'), 100, 1, 'R', 0);
    rob.allocate(fakeInstr('B'), 104, 2, 'R', 0);
    rob.markFinished(0, 1, null, 1);
    rob.commit(); // libera slot 0; head avanza a 1
    rob.allocate(fakeInstr('C'), 108, 3, 'R', 0); // ocupa slot 2

    const occupied = rob.getOccupiedEntries();
    expect(occupied.map(e => e.opcode)).toEqual(['B', 'C']);
  });

  it('getAllEntries() siempre devuelve `size` entradas (ocupadas o no)', () => {
    const rob = new ROB(3);
    rob.allocate(fakeInstr(), 100, 1, 'R', 0);
    expect(rob.getAllEntries()).toHaveLength(3);
  });

  it('getUtilization()/getSize() reflejan la ocupación actual', () => {
    const rob = new ROB(4);
    expect(rob.getSize()).toBe(4);
    expect(rob.getUtilization()).toBe(0);

    rob.allocate(fakeInstr(), 100, 1, 'R', 0);
    expect(rob.getUtilization()).toBe(0.25);
  });

  it('getGeneration()/getROBTag() reflejan la generación tras un commit (reutilización de slot)', () => {
    const rob = new ROB(1);
    rob.allocate(fakeInstr(), 100, 1, 'R', 0);
    expect(rob.getGeneration(0)).toBe(0);

    rob.markFinished(0, 1, null, 1);
    rob.commit();

    expect(rob.getGeneration(0)).toBe(1);
    expect(rob.getROBTag(0)).toEqual({ slot: 0, generation: 1 });
  });

  describe('getPendingStoresBefore (dependencias de memoria)', () => {
    it('encuentra un store ocupado y sin finalizar entre la cabeza y el tag dado', () => {
      const rob = new ROB(4);
      rob.allocate(fakeInstr('SW'), 100, null, null, 0, true); // slot 0: store pendiente
      const loadTag = rob.allocate(fakeInstr('LW'), 104, 5, 'R', 0)!;

      const pending = rob.getPendingStoresBefore(loadTag.slot);
      expect(pending).toHaveLength(1);
      expect(pending[0].opcode).toBe('SW');
    });

    it('no incluye stores ya finalizados', () => {
      const rob = new ROB(4);
      rob.allocate(fakeInstr('SW'), 100, null, null, 0, true);
      rob.markFinished(0, 0, null, 1); // el store ya terminó
      const loadTag = rob.allocate(fakeInstr('LW'), 104, 5, 'R', 0)!;

      expect(rob.getPendingStoresBefore(loadTag.slot)).toHaveLength(0);
    });
  });

  describe('hasStoreToAddress con dirección aún desconocida', () => {
    it('devuelve null (hay que esperar) si el store más reciente todavía no tiene dirección calculada', () => {
      const rob = new ROB(4);
      rob.allocate(fakeInstr('SW'), 100, null, null, 0, true);
      rob.setStoreInfo(0, 0x100, 111); // store antiguo, SÍ tiene dirección conocida
      rob.allocate(fakeInstr('SW'), 104, null, null, 0, true); // store más reciente, dirección aún null
      const loadTag = rob.allocate(fakeInstr('LW'), 108, 5, 'R', 0)!;

      // El store más reciente (slot 1) bloquea la búsqueda aunque el más antiguo (slot 0)
      // sí tenga la dirección que buscamos: hay que esperar a que se resuelva primero.
      expect(rob.hasStoreToAddress(0x100, loadTag.slot)).toBeNull();
    });
  });

  describe('isAfter / isTagAfter (orden de programa en el buffer circular)', () => {
    it('sin wraparound (head <= tail), compara directamente por posición de slot', () => {
      const rob = new ROB(4);
      rob.allocate(fakeInstr(), 100, 1, 'R', 0); // slot 0
      rob.allocate(fakeInstr(), 104, 2, 'R', 0); // slot 1
      // head=0, tail=2

      expect(rob.isAfter(1, 0)).toBe(true);
      expect(rob.isAfter(0, 1)).toBe(false);
      expect(rob.isTagAfter(1, 0)).toBe(true);
      expect(rob.isTagAfter(0, 1)).toBe(false);
    });

    it('con wraparound (head > tail), respeta el orden circular real de asignación', () => {
      const rob = new ROB(4);
      // Ocupa las 4 entradas y confirma 3, dejando solo el slot 3 ocupado (head=3).
      rob.allocate(fakeInstr(), 100, 1, 'R', 0); // slot 0
      rob.allocate(fakeInstr(), 104, 2, 'R', 0); // slot 1
      rob.allocate(fakeInstr(), 108, 3, 'R', 0); // slot 2
      rob.allocate(fakeInstr(), 112, 4, 'R', 0); // slot 3
      for (let i = 0; i < 3; i++) {
        rob.markFinished(i, i, null, 0);
        rob.commit();
      }
      // head=3, tail=0 (todavía). Asignamos 2 más para que tail avance y quede head(3) > tail(2).
      rob.allocate(fakeInstr(), 200, 10, 'R', 0); // reutiliza slot 0
      rob.allocate(fakeInstr(), 204, 20, 'R', 0); // reutiliza slot 1
      // Orden de programa actual (del más antiguo al más nuevo): slot 3, slot 0, slot 1.

      expect(rob.isAfter(0, 3)).toBe(true);  // slot 0 es más nuevo que el slot 3 (cabeza)
      expect(rob.isAfter(3, 0)).toBe(false); // slot 3 (cabeza) no es "posterior" a slot 0
      expect(rob.isAfter(1, 0)).toBe(true);  // slot 1 es más nuevo que slot 0
      expect(rob.isAfter(3, 3)).toBe(false); // un slot nunca es "posterior" a sí mismo

      expect(rob.isTagAfter(0, 3)).toBe(true);
      expect(rob.isTagAfter(3, 0)).toBe(false);
      expect(rob.isTagAfter(1, 0)).toBe(true);
    });
  });
});

describe('robTagEquals / robTagMatches', () => {
  it('dos tags son iguales solo si coinciden slot y generación', () => {
    expect(robTagEquals({ slot: 1, generation: 0 }, { slot: 1, generation: 0 })).toBe(true);
    expect(robTagEquals({ slot: 1, generation: 0 }, { slot: 1, generation: 1 })).toBe(false);
    expect(robTagEquals(null, null)).toBe(true);
    expect(robTagEquals({ slot: 1, generation: 0 }, null)).toBe(false);
  });

  it('robTagMatches compara un tag contra un slot/generación sueltos', () => {
    expect(robTagMatches({ slot: 2, generation: 3 }, 2, 3)).toBe(true);
    expect(robTagMatches({ slot: 2, generation: 3 }, 2, 4)).toBe(false);
    expect(robTagMatches(null, 2, 3)).toBe(false);
  });
});
