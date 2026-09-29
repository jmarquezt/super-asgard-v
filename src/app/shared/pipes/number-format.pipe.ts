import {Pipe, PipeTransform} from '@angular/core';

@Pipe({ name: 'numberFormat' })
export class NumberFormatPipe implements PipeTransform {
  transform(value: number | undefined, mode: 'hex' | 'dec' | 'bin' | 'ascii' = 'dec', type: 'R' | 'F' | 'D' = 'R'): string {
    if (value === undefined || value === null) return 'N/A';

    // En decimal simplemente devolvemos el número tal cual (humano)
    if (mode === 'dec') {
      return type === 'R' ? Math.floor(value).toString() : value.toString();
    }

    // Para HEX, BIN y ASCII, necesitamos los bits "crudos" del hardware
    const is64Bit = type === 'D';
    const buffer = new ArrayBuffer(is64Bit ? 8 : 4);
    const view = new DataView(buffer);

    // Escribimos el valor en el buffer según su naturaleza original
    if (type === 'D') {
      view.setFloat64(0, value, false); // Big Endian para ser fiel a ASG
    } else if (type === 'F') {
      view.setFloat32(0, value, false);
    } else {
      view.setInt32(0, value, false);
    }

    if (mode === 'hex') {
      // Extraemos los bytes uno a uno para garantizar el orden visual 40 09 21 FB
      const bytes = new Uint8Array(view.buffer);
      const hex = Array.from(bytes)
        .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
        .join('');
      return '0x' + hex;
    }

    if (mode === 'bin') {
      const bytes = new Uint8Array(view.buffer);
      return Array.from(bytes)
        .map(b => b.toString(2).padStart(8, '0'))
        .join(' ');
    }

    if (mode === 'ascii') {
      const bytes = new Uint8Array(view.buffer);
      // Convertir bytes a caracteres ASCII (imprimibles 32-126, resto como '.')
      return Array.from(bytes)
        .map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.')
        .join('');
    }

    return value.toString();
  }
}
