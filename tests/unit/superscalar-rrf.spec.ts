import { RRF } from '../../src/app/core/models/superscalar/rrf';
import { ROBTag } from '../../src/app/core/models/superscalar/rob';

const tag = (slot: number, generation = 0): ROBTag => ({ slot, generation });

describe('RRF (extensión de renombramiento del ARF)', () => {
  it('todos los registros empiezan sin renombrar', () => {
    const rrf = new RRF();
    expect(rrf.lookup('R', 1)).toEqual({ ocupado: false });
    expect(rrf.lookup('F', 2)).toEqual({ ocupado: false });
    expect(rrf.lookup('V', 0)).toEqual({ ocupado: false });
  });

  it('R0 nunca se puede renombrar (siempre vale 0)', () => {
    const rrf = new RRF();
    rrf.rename('R', 0, tag(3));
    expect(rrf.lookup('R', 0)).toEqual({ ocupado: false });
  });

  it('rename() marca el registro como ocupado apuntando al ROB', () => {
    const rrf = new RRF();
    rrf.rename('R', 5, tag(3));
    expect(rrf.lookup('R', 5)).toEqual({ ocupado: true, robTag: tag(3) });
  });

  it('clearRename solo limpia si el índice coincide (no borra un renombrado más reciente)', () => {
    const rrf = new RRF();
    rrf.rename('R', 5, tag(3));
    rrf.rename('R', 5, tag(7)); // una segunda instrucción vuelve a escribir R5 antes de que la primera haga commit

    rrf.clearRename('R', 5, tag(3)); // commit de la instrucción VIEJA: no debe tocar el renombrado actual
    expect(rrf.lookup('R', 5)).toEqual({ ocupado: true, robTag: tag(7) });

    rrf.clearRename('R', 5, tag(7)); // commit de la instrucción correcta
    expect(rrf.lookup('R', 5)).toEqual({ ocupado: false });
  });

  it('VLR y VM son registros únicos: cualquier regNum se normaliza a 0', () => {
    const rrf = new RRF();
    rrf.rename('VLR', 5, tag(1));
    expect(rrf.lookup('VLR', 0)).toEqual({ ocupado: true, robTag: tag(1) });
    expect(rrf.lookup('VLR', 5)).toEqual({ ocupado: true, robTag: tag(1) });
  });

  it('flushFrom limpia los renombramientos especulativos posteriores a un punto del ROB', () => {
    const rrf = new RRF();
    // ROB circular de tamaño 8, head=0: slots 2 y 5 son "posteriores" a partir del 3
    rrf.rename('R', 1, tag(2));
    rrf.rename('R', 2, tag(5));
    rrf.rename('R', 3, tag(6));

    rrf.flushFrom(5, 0, 8); // descarta desde el slot 5 (inclusive) en adelante

    expect(rrf.lookup('R', 1)).toEqual({ ocupado: true, robTag: tag(2) }); // anterior al flush: se conserva
    expect(rrf.lookup('R', 2)).toEqual({ ocupado: false }); // == fromTag: se descarta
    expect(rrf.lookup('R', 3)).toEqual({ ocupado: false }); // posterior: se descarta
  });

  it('snapshot/restore permiten volver a un estado de renombramiento anterior', () => {
    const rrf = new RRF();
    rrf.rename('R', 1, tag(1));
    const snap = rrf.snapshot();

    rrf.rename('R', 2, tag(2));
    expect(rrf.lookup('R', 2).ocupado).toBe(true);

    rrf.restore(snap);
    expect(rrf.lookup('R', 1)).toEqual({ ocupado: true, robTag: tag(1) });
    expect(rrf.lookup('R', 2)).toEqual({ ocupado: false });
  });

  it('countRenamed cuenta los registros ocupados por banco', () => {
    const rrf = new RRF();
    rrf.rename('R', 1, tag(1));
    rrf.rename('R', 2, tag(2));
    rrf.rename('F', 3, tag(3));

    expect(rrf.countRenamed()).toEqual({ int: 2, float: 1, vector: 0, fpbc: 0, vlr: 0, vm: 0 });
  });

  it('reset limpia todos los renombramientos', () => {
    const rrf = new RRF();
    rrf.rename('R', 1, tag(1));
    rrf.reset();
    expect(rrf.lookup('R', 1)).toEqual({ ocupado: false });
  });
});
