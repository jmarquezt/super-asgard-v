import { AsgRegisterFileService, RegisterAlignmentError } from '../../src/app/core/services/asg.register-file';

describe('AsgRegisterFileService', () => {
  let regFile: AsgRegisterFileService;

  beforeEach(() => {
    regFile = new AsgRegisterFileService({ mvl: 8 });
  });

  it('always reads R0 as zero, even after a write attempt', () => {
    regFile.writeIntRegister(0, 999);
    expect(regFile.readIntRegister(0)).toBe(0);
  });

  it('writes and reads back an integer register', () => {
    regFile.writeIntRegister(5, 42);
    expect(regFile.readIntRegister(5)).toBe(42);
  });

  it('writes and reads back a single-precision float register', () => {
    regFile.writeFloatRegister(2, 3.5, false);
    expect(regFile.getFloatRegister(2, false)).toBeCloseTo(3.5);
    expect(regFile.isFloatRegisterDouble(2)).toBe(false);
  });

  it('writes and reads back a double-precision float register pair', () => {
    regFile.writeFloatRegister(4, 3.14159, true);
    expect(regFile.getFloatRegister(4, true)).toBeCloseTo(3.14159, 4);
    expect(regFile.isFloatRegisterDouble(4)).toBe(true);
  });

  it('rejects an odd register index for double precision access', () => {
    expect(() => regFile.writeFloatRegister(3, 1.0, true)).toThrow(RegisterAlignmentError);
    expect(() => regFile.getFloatRegister(3, true)).toThrow(RegisterAlignmentError);
  });

  it('writes and reads back a vector register element', () => {
    regFile.writeVectorElement(1, 3, 7.5);
    expect(regFile.readVectorElement(1, 3)).toBe(7.5);
  });

  it('writes and reads back a full vector register', () => {
    const values = new Float64Array([1, 2, 3, 4, 5, 6, 7, 8]);
    regFile.writeVectorRegister(0, values);
    expect(regFile.readVectorRegister(0)).toEqual(values);
  });

  it('tracks the last modified register', () => {
    regFile.writeIntRegister(3, 1);
    expect(regFile.lastModifiedReg()).toEqual({ type: 'R', index: 3 });

    regFile.writeFloatRegister(2, 1.0, false);
    expect(regFile.lastModifiedReg()).toEqual({ type: 'F', index: 2 });
  });

  it('resets registers, vector length and vector mask to their initial state', () => {
    regFile.writeIntRegister(1, 99);
    regFile.vl.set(2);
    regFile.reset();

    expect(regFile.readIntRegister(1)).toBe(0);
    expect(regFile.vl()).toBe(8);
    expect(Array.from(regFile.vectorMask())).toEqual(new Array(8).fill(1));
  });

  it('sets and queries the vector mask element by element', () => {
    const mask = new Float64Array(8).fill(1);
    mask[1] = 0;
    regFile.writeVectorMask(mask);

    expect(regFile.isVectorMaskElementActive(0)).toBe(true);
    expect(regFile.isVectorMaskElementActive(1)).toBe(false);
  });

  it('restores a full mask (all elements active) with resetVectorMask', () => {
    const mask = new Float64Array(8).fill(0);
    regFile.writeVectorMask(mask);
    regFile.resetVectorMask();

    expect(Array.from(regFile.vectorMask())).toEqual(new Array(8).fill(1));
  });

  it('reports RRF as disabled by default and enabled when configured', () => {
    expect(regFile.hasRRF()).toBe(false);
    expect(() => regFile.getRRF()).toThrow();

    const withRrf = new AsgRegisterFileService({ mvl: 8, enableRRF: true });
    expect(withRrf.hasRRF()).toBe(true);
    expect(() => withRrf.getRRF()).not.toThrow();
  });

  it('ignores out-of-range integer register access without throwing', () => {
    expect(regFile.readIntRegister(-1)).toBe(0);
    expect(regFile.readIntRegister(32)).toBe(0);
    expect(() => regFile.writeIntRegister(-1, 1)).not.toThrow();
    expect(() => regFile.writeIntRegister(32, 1)).not.toThrow();
  });

  it('ignores out-of-range vector element/register access without throwing', () => {
    expect(regFile.readVectorElement(-1, 0)).toBe(0);
    expect(regFile.readVectorElement(8, 0)).toBe(0);
    expect(regFile.readVectorElement(0, -1)).toBe(0);
    expect(regFile.readVectorElement(0, 8)).toBe(0); // mvl=8, índices válidos 0-7

    expect(() => regFile.writeVectorElement(-1, 0, 1)).not.toThrow();
    expect(() => regFile.writeVectorElement(8, 0, 1)).not.toThrow();
    expect(() => regFile.writeVectorElement(0, -1, 1)).not.toThrow();
    expect(() => regFile.writeVectorElement(0, 8, 1)).not.toThrow();

    expect(regFile.readVectorRegister(-1)).toEqual(new Float64Array(8));
    expect(regFile.readVectorRegister(8)).toEqual(new Float64Array(8));
    expect(() => regFile.writeVectorRegister(-1, new Float64Array(8))).not.toThrow();
    expect(() => regFile.writeVectorRegister(8, new Float64Array(8))).not.toThrow();
  });

  it('sets the FPU condition bit and returns it as 0/1', () => {
    expect(regFile.setFPCondition(true)).toBe(1);
    expect(regFile.fpConditionBit()).toBe(1);

    expect(regFile.setFPCondition(false)).toBe(0);
    expect(regFile.fpConditionBit()).toBe(0);
  });

  it('setVectorMask() decodes the low 32 bits of a float into the mask, rest left at 0', () => {
    // bits = 0b101 (5): elementos 0 y 2 activos, 1 inactivo. mvl=8 -> hay margen para
    // comprobar también que los índices >= 32 no aplican (aquí no llegamos a 32, pero
    // se ejercita igualmente la rama "i < 32" del bucle).
    const buf = new ArrayBuffer(4);
    new DataView(buf).setInt32(0, 5, false);
    const asFloat = new DataView(buf).getFloat32(0, false);

    const bits = regFile.setVectorMask(asFloat);

    expect(bits).toBe(5);
    expect(regFile.isVectorMaskElementActive(0)).toBe(true);
    expect(regFile.isVectorMaskElementActive(1)).toBe(false);
    expect(regFile.isVectorMaskElementActive(2)).toBe(true);
  });

  it('tracks per-register vector chaining status (set/get/has/delete/clear)', () => {
    expect(regFile.getVectorRegisterStatus(0)).toBeUndefined();
    expect(regFile.hasVectorRegisterStatus(0)).toBe(false);

    regFile.setVectorRegisterStatus(0, { instrId: 7, lastElementReady: 3 });
    expect(regFile.hasVectorRegisterStatus(0)).toBe(true);
    expect(regFile.getVectorRegisterStatus(0)).toEqual({ instrId: 7, lastElementReady: 3 });

    regFile.deleteVectorRegisterStatus(0);
    expect(regFile.hasVectorRegisterStatus(0)).toBe(false);

    regFile.setVectorRegisterStatus(1, { instrId: 1, lastElementReady: 0 });
    regFile.clearVectorRegisterStatus();
    expect(regFile.hasVectorRegisterStatus(1)).toBe(false);
  });

  describe('renombramiento RRF (Reorder Buffer Register File)', () => {
    const tag = (slot: number, generation = 0) => ({ slot, generation });

    it('con RRF deshabilitado, todas las consultas/operaciones de renombrado son no-op seguras', () => {
      expect(regFile.hasRRF()).toBe(false);

      expect(regFile.lookupRename('R', 5)).toEqual({ ocupado: false });
      expect(regFile.lookupVLRRename()).toEqual({ ocupado: false });
      expect(regFile.lookupVMRename()).toEqual({ ocupado: false });
      expect(regFile.snapshotRRF()).toBeNull();
      expect(regFile.getRRFState()).toBeNull();
      expect(regFile.countRenamed()).toEqual({ int: 0, float: 0, vector: 0, fcc: 0, vlr: 0, vm: 0 });

      // Ninguna de estas debe lanzar aunque no haya RRF
      expect(() => regFile.rename('R', 5, tag(0))).not.toThrow();
      expect(() => regFile.clearRename('R', 5, tag(0))).not.toThrow();
      expect(() => regFile.flushRenamesFrom(0, 0, 8)).not.toThrow();
      // restoreRRF() comprueba `!snapshot` en tiempo de ejecución, pero su firma de tipos
      // (ReturnType<RRF['snapshot']>) no admite null explícitamente — cast deliberado.
      expect(() => regFile.restoreRRF(null as any)).not.toThrow();
      expect(() => regFile.renameVLR(tag(0))).not.toThrow();
      expect(() => regFile.renameVM(tag(0))).not.toThrow();
      expect(() => regFile.clearVLRRename(tag(0))).not.toThrow();
      expect(() => regFile.clearVMRename(tag(0))).not.toThrow();
    });

    it('con RRF habilitado, rename()/lookupRename() delegan de verdad en la instancia RRF', () => {
      const withRrf = new AsgRegisterFileService({ mvl: 8, enableRRF: true });

      expect(withRrf.lookupRename('R', 5)).toEqual({ ocupado: false });

      withRrf.rename('R', 5, tag(2));
      expect(withRrf.lookupRename('R', 5)).toEqual({ ocupado: true, robTag: tag(2) });

      withRrf.clearRename('R', 5, tag(2));
      expect(withRrf.lookupRename('R', 5)).toEqual({ ocupado: false });
    });

    it('renameVLR/renameVM y sus lookups/clears dedicados delegan en el RRF real', () => {
      const withRrf = new AsgRegisterFileService({ mvl: 8, enableRRF: true });

      withRrf.renameVLR(tag(1));
      expect(withRrf.lookupVLRRename()).toEqual({ ocupado: true, robTag: tag(1) });
      withRrf.clearVLRRename(tag(1));
      expect(withRrf.lookupVLRRename()).toEqual({ ocupado: false });

      withRrf.renameVM(tag(3));
      expect(withRrf.lookupVMRename()).toEqual({ ocupado: true, robTag: tag(3) });
      withRrf.clearVMRename(tag(3));
      expect(withRrf.lookupVMRename()).toEqual({ ocupado: false });
    });

    it('countRenamed() refleja los registros con renombrado activo', () => {
      const withRrf = new AsgRegisterFileService({ mvl: 8, enableRRF: true });
      withRrf.rename('R', 1, tag(0));
      withRrf.rename('R', 2, tag(1));
      withRrf.rename('F', 3, tag(2));

      expect(withRrf.countRenamed()).toEqual({ int: 2, float: 1, vector: 0, fpbc: 0, vlr: 0, vm: 0 });
    });

    it('flushRenamesFrom() solo limpia los renombrados cuya posición circular sea >= fromTag', () => {
      const withRrf = new AsgRegisterFileService({ mvl: 8, enableRRF: true });
      withRrf.rename('R', 1, tag(0)); // posición circular 0 respecto a robHead=0
      withRrf.rename('R', 2, tag(5)); // posición circular 5

      withRrf.flushRenamesFrom(5, 0, 8); // posFrom = (5-0+8)%8 = 5

      // slot 0 -> posEntry 0 < posFrom(5): sobrevive
      expect(withRrf.lookupRename('R', 1)).toEqual({ ocupado: true, robTag: tag(0) });
      // slot 5 -> posEntry 5 >= posFrom(5): se limpia
      expect(withRrf.lookupRename('R', 2)).toEqual({ ocupado: false });
    });

    it('snapshotRRF()/restoreRRF() permiten guardar y recuperar el estado de renombrado', () => {
      const withRrf = new AsgRegisterFileService({ mvl: 8, enableRRF: true });
      withRrf.rename('R', 1, tag(0));

      const snap = withRrf.snapshotRRF();
      expect(snap).not.toBeNull();

      withRrf.rename('R', 2, tag(1));
      expect(withRrf.lookupRename('R', 2)).toEqual({ ocupado: true, robTag: tag(1) });

      // Mismo motivo que arriba: snapshotRRF() puede devolver null (tipo inferido), pero
      // restoreRRF() no lo admite en su firma aunque sí lo maneje en tiempo de ejecución.
      withRrf.restoreRRF(snap as any);

      expect(withRrf.lookupRename('R', 1)).toEqual({ ocupado: true, robTag: tag(0) });
      expect(withRrf.lookupRename('R', 2)).toEqual({ ocupado: false }); // no estaba en el snapshot
    });

    it('getRRFState() devuelve el estado completo (bancos int/float/vector/fpbc/vlr/vm) cuando RRF está habilitado', () => {
      const withRrf = new AsgRegisterFileService({ mvl: 8, enableRRF: true });
      const state = withRrf.getRRFState();

      expect(state).not.toBeNull();
      expect(state!.intRegs).toHaveLength(32);
      expect(state!.floatRegs).toHaveLength(32);
      expect(state!.vectorRegs).toHaveLength(8);
    });

    it('reset() también limpia el estado de renombrado del RRF cuando está habilitado', () => {
      const withRrf = new AsgRegisterFileService({ mvl: 8, enableRRF: true });
      withRrf.rename('R', 1, tag(0));

      withRrf.reset();

      expect(withRrf.lookupRename('R', 1)).toEqual({ ocupado: false });
    });
  });
});
