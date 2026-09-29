import { NumberFormatPipe } from '../../src/app/shared/pipes/number-format.pipe';

// Ningún test existente ejercitaba mode='bin': los tests de integración que fijaban
// displayMode.set('bin') (memory-view-group.component.spec.ts) nunca llamaban a detectChanges()
// después, así que la plantilla nunca volvía a evaluar el pipe con ese modo. Se cubre aquí de
// forma directa, junto con el resto de modos/tipos para tener un spec dedicado del pipe.
describe('NumberFormatPipe', () => {
  const pipe = new NumberFormatPipe();

  it('devuelve "N/A" para undefined y null', () => {
    expect(pipe.transform(undefined)).toBe('N/A');
    expect(pipe.transform(null as unknown as undefined)).toBe('N/A');
  });

  it('en modo "dec" con tipo "R" trunca a entero', () => {
    expect(pipe.transform(5.9, 'dec', 'R')).toBe('5');
  });

  it('en modo "dec" con tipo distinto de "R" devuelve el número tal cual', () => {
    expect(pipe.transform(5.9, 'dec', 'F')).toBe('5.9');
  });

  it('en modo "hex" con tipo "R" devuelve los 4 bytes en big-endian con prefijo 0x', () => {
    expect(pipe.transform(0xf0, 'hex', 'R')).toBe('0x000000F0');
  });

  it('en modo "bin" con tipo "R" devuelve los 32 bits en big-endian separados por byte', () => {
    expect(pipe.transform(0xab, 'bin', 'R')).toBe('00000000 00000000 00000000 10101011');
  });

  it('en modo "bin" con tipo "D" (64 bits) devuelve 8 bytes', () => {
    const result = pipe.transform(1.5, 'bin', 'D');
    expect(result.split(' ')).toHaveLength(8);
  });

  it('en modo "ascii" traduce los bytes imprimibles a carácter y el resto a "."', () => {
    expect(pipe.transform(0x41000000, 'ascii', 'R')).toBe('A...');
  });
});
