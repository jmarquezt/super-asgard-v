import { FU_TO_CLUSTER, DEFAULT_FU_LATENCIES, getFunctionalUnitType } from '../../src/app/core/models/superscalar/fu';
import { FunctionalUnitType } from '../../src/app/core/models/asg.map';

describe('fu.ts (tipos y latencias de Unidades Funcionales)', () => {
  it('getFunctionalUnitType devuelve el tipo de UF real de un opcode conocido', () => {
    expect(getFunctionalUnitType('ADD')).toBe('INT_ALU');
    expect(getFunctionalUnitType('MULT')).toBe('INT_MUL');
    expect(getFunctionalUnitType('MULTD')).toBe('FP_MUL');
    expect(getFunctionalUnitType('LW')).toBe('MEM');
    expect(getFunctionalUnitType('BNEZ')).toBe('BRANCH');
    expect(getFunctionalUnitType('MULTV')).toBe('VEC_MUL');
  });

  it('getFunctionalUnitType es insensible a mayúsculas/minúsculas', () => {
    expect(getFunctionalUnitType('add')).toBe('INT_ALU');
  });

  it('getFunctionalUnitType usa INT_ALU como valor por defecto para un opcode desconocido', () => {
    expect(getFunctionalUnitType('NO_EXISTE')).toBe('INT_ALU');
  });

  it('FU_TO_CLUSTER cubre los 12 tipos de UF sin huecos', () => {
    const types: FunctionalUnitType[] = [
      'INT_ALU', 'INT_MUL', 'INT_DIV', 'BRANCH',
      'FP_ADD', 'FP_MUL', 'FP_DIV',
      'MEM', 'VEC_MEM', 'VEC_INT', 'VEC_MUL', 'VEC_DIV',
    ];
    for (const type of types) {
      expect(FU_TO_CLUSTER[type]).toBeDefined();
    }
  });

  it('agrupa correctamente las UF enteras y de salto en el cluster "int"', () => {
    expect(FU_TO_CLUSTER['INT_ALU']).toBe('int');
    expect(FU_TO_CLUSTER['INT_MUL']).toBe('int');
    expect(FU_TO_CLUSTER['INT_DIV']).toBe('int');
    expect(FU_TO_CLUSTER['BRANCH']).toBe('int');
  });

  it('agrupa las UF vectoriales en el cluster "vec" y las de memoria escalar en "mem"', () => {
    expect(FU_TO_CLUSTER['VEC_MEM']).toBe('vec');
    expect(FU_TO_CLUSTER['VEC_MUL']).toBe('vec');
    expect(FU_TO_CLUSTER['MEM']).toBe('mem');
  });

  it('las latencias por defecto son todas positivas y las operaciones de división son las más lentas de su dominio', () => {
    for (const type of Object.keys(DEFAULT_FU_LATENCIES) as FunctionalUnitType[]) {
      expect(DEFAULT_FU_LATENCIES[type]).toBeGreaterThan(0);
    }
    expect(DEFAULT_FU_LATENCIES.INT_DIV).toBeGreaterThan(DEFAULT_FU_LATENCIES.INT_MUL);
    expect(DEFAULT_FU_LATENCIES.FP_DIV).toBeGreaterThan(DEFAULT_FU_LATENCIES.FP_MUL);
    expect(DEFAULT_FU_LATENCIES.VEC_DIV).toBeGreaterThan(DEFAULT_FU_LATENCIES.VEC_MUL);
  });
});
