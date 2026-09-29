import { AsgMemoryService, MemoryAlignmentError, MemoryOutOfBoundsError } from '../../src/app/core/services/asg.memory';

describe('AsgMemoryService', () => {
  let memory: AsgMemoryService;

  beforeEach(() => {
    memory = new AsgMemoryService(64, 'Datos');
  });

  it('writes and reads back a word (SW/LW)', () => {
    memory.write(0, 0x12345678, 4);
    expect(memory.read(0, 4)).toBe(0x12345678);
  });

  it('stores words in big-endian order', () => {
    memory.write(0, 0x12345678, 4);
    expect(memory.get()[0]).toBe(0x12);
    expect(memory.get()[1]).toBe(0x34);
    expect(memory.get()[2]).toBe(0x56);
    expect(memory.get()[3]).toBe(0x78);
  });

  it('sign-extends a byte read with LB but not with LBU', () => {
    memory.write(0, -1, 4); // 0xFFFFFFFF
    expect(memory.read(0, 1, true)).toBe(-1);  // LB
    expect(memory.read(0, 1, false)).toBe(255); // LBU
  });

  it('sign-extends a halfword read with LH but not with LHU', () => {
    memory.write(0, 0x1234FFFF, 4);
    expect(memory.read(2, 2, false)).toBe(0xFFFF); // LHU
    expect(memory.read(2, 2, true)).toBe(-1);       // LH
  });

  it('reads and writes a double-precision value (SD/LD)', () => {
    memory.write(0, 3.5, 8);
    expect(memory.read(0, 8)).toBe(3.5);
  });

  it('throws MemoryAlignmentError on an unaligned word access', () => {
    expect(() => memory.read(2, 4)).toThrow(MemoryAlignmentError);
  });

  it('throws MemoryAlignmentError on an unaligned double access', () => {
    expect(() => memory.read(4, 8)).toThrow(MemoryAlignmentError);
  });

  it('throws MemoryOutOfBoundsError when reading past the end of memory', () => {
    expect(() => memory.read(64, 4)).toThrow(MemoryOutOfBoundsError);
  });

  it('throws MemoryOutOfBoundsError when writing past the end of memory', () => {
    expect(() => memory.write(63, 1, 4)).toThrow(MemoryOutOfBoundsError);
  });

  it('resets all memory to zero', () => {
    memory.write(0, 42, 4);
    memory.reset();
    expect(memory.read(0, 4)).toBe(0);
  });

  it('loads a buffer at a given start index', () => {
    memory.load(new Uint8Array([1, 2, 3]), 10);
    expect(memory.get().slice(10, 13)).toEqual(new Uint8Array([1, 2, 3]));
  });
});
