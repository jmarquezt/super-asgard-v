import { SymbolTable } from '../../src/app/core/models/asg.symbol-table';

describe('SymbolTable', () => {
  afterEach(() => {
    SymbolTable.clear();
  });

  it('adds and retrieves a symbol', () => {
    SymbolTable.add('LOOP', 104, 'TEXT');
    expect(SymbolTable.get('LOOP')).toEqual({ name: 'LOOP', address: 104, segment: 'TEXT' });
  });

  it('resolves the address of a defined symbol', () => {
    SymbolTable.add('DATA1', 8, 'DATA');
    expect(SymbolTable.getAddress('DATA1')).toBe(8);
  });

  it('throws when resolving the address of an undefined symbol', () => {
    expect(() => SymbolTable.getAddress('UNKNOWN')).toThrow(/no definido/);
  });

  it('strips the module prefix used to disambiguate multi-module labels', () => {
    expect(SymbolTable.cleanName('__m0__LOOP')).toBe('LOOP');
    expect(SymbolTable.cleanName('LOOP')).toBe('LOOP');
  });

  it('finds a symbol name by address and segment', () => {
    SymbolTable.add('__m1__EXIT', 200, 'TEXT');
    expect(SymbolTable.getName(200, 'TEXT')).toBe('EXIT');
    expect(SymbolTable.getName(200, 'DATA')).toBeUndefined();
  });

  it('clears all registered symbols', () => {
    SymbolTable.add('X', 4, 'DATA');
    SymbolTable.clear();
    expect(SymbolTable.getAll().size).toBe(0);
  });
});
