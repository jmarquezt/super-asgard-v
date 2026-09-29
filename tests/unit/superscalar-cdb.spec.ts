import { CDB } from '../../src/app/core/models/superscalar/cdb';
import { ROBTag } from '../../src/app/core/models/superscalar/rob';

const tag = (slot: number): ROBTag => ({ slot, generation: 0 });

describe('CDB (Common Data Bus)', () => {
  it('acepta resultados hasta el ancho configurado', () => {
    const cdb = new CDB(2);
    cdb.startCycle();

    expect(cdb.publish(tag(1), 10, null, 'INT_ALU', 0)).toBe(true);
    expect(cdb.publish(tag(2), 20, null, 'INT_ALU', 0)).toBe(true);
    expect(cdb.canAccept()).toBe(false);
    expect(cdb.availableSlots()).toBe(0);
  });

  it('encola (no descarta) los resultados que exceden el ancho, para el siguiente ciclo', () => {
    const cdb = new CDB(1);
    cdb.startCycle();
    expect(cdb.publish(tag(1), 10, null, 'INT_ALU', 0)).toBe(true);
    expect(cdb.publish(tag(2), 20, null, 'INT_ALU', 0)).toBe(false); // no cabe, se encola

    expect(cdb.getResults()).toHaveLength(1);
    expect(cdb.getPendingCount()).toBe(1);

    cdb.startCycle(); // nuevo ciclo: promueve el resultado encolado
    expect(cdb.getResults().map(r => r.robTag)).toEqual([tag(2)]);
    expect(cdb.getPendingCount()).toBe(0);
  });

  it('hasResult encuentra un resultado publicado este ciclo por su ROBTag', () => {
    const cdb = new CDB(4);
    cdb.startCycle();
    cdb.publish(tag(5), 99, null, 'FP_MUL', 2);

    expect(cdb.hasResult(tag(5))?.value).toBe(99);
    expect(cdb.hasResult(tag(6))).toBeNull();
  });

  it('startCycle limpia los resultados del ciclo anterior que ya se publicaron', () => {
    const cdb = new CDB(4);
    cdb.startCycle();
    cdb.publish(tag(1), 1, null, 'INT_ALU', 0);
    cdb.startCycle();
    expect(cdb.getResults()).toEqual([]);
  });

  it('calcula utilización y estadísticas', () => {
    const cdb = new CDB(4);
    cdb.startCycle();
    cdb.publish(tag(1), 1, null, 'INT_ALU', 0);

    expect(cdb.getUtilization()).toBe(0.25);
    expect(cdb.getStats()).toEqual({ used: 1, width: 4, pending: 0 });
  });

  it('reset limpia resultados publicados y pendientes', () => {
    const cdb = new CDB(1);
    cdb.startCycle();
    cdb.publish(tag(1), 1, null, 'INT_ALU', 0);
    cdb.publish(tag(2), 2, null, 'INT_ALU', 0); // se encola

    cdb.reset();
    expect(cdb.getResults()).toEqual([]);
    expect(cdb.getPendingCount()).toBe(0);
  });
});
