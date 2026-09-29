import { signal } from '@angular/core';

export class MemoryAlignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryAlignmentError';
  }
}

export class MemoryOutOfBoundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryOutOfBoundsError';
  }
}

export class AsgMemoryService {
  // inicializo la memoria a un array vacio
  private data = signal<Uint8Array>(new Uint8Array(0));
  private lastAccess = signal<number | null>(null);
  private name: string;

  constructor(size: number, name: string) {
    this.data.set(new Uint8Array(size));
    this.name = name;
  }

  /**
   * Lee de la memoria.
   * @throws MemoryAlignmentError si la dirección está desalineada
   * @throws MemoryOutOfBoundsError si la dirección está fuera de rango
   */
  public read(address: number, size: number, signed: boolean = true): number {
    const mem = this.data();

    // Verificar límites de memoria
    const accessSize = size === 3 ? 4 : size === 9 ? 8 : size; // size 3 = float (4 bytes), size 9 = double syscall (8 bytes)
    if (address < 0 || address + accessSize > mem.length) {
      throw new MemoryOutOfBoundsError(
        `Acceso fuera de límites: dirección 0x${address.toString(16)}, tamaño ${accessSize}, memoria ${mem.length} bytes`
      );
    }

    const view = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);

    switch (size) {
      case 1: // LB / LBU
        const val8 = mem[address];
        return signed ? (val8 << 24) >> 24 : val8;

      case 2: // LH / LHU
        if (address % 2 !== 0) {
          throw new MemoryAlignmentError(`Dirección desalineada (Halfword) 0x${address.toString(16)}`);
        }
        return signed ? view.getInt16(address, false) : view.getUint16(address, false);
      //LF para diferenciarlo de LW
      case 3:
        if (address % 4 !== 0) {
          throw new MemoryAlignmentError(`Dirección desalineada (Float) 0x${address.toString(16)}`);
        }
        return view.getFloat32(address, false);

      case 4: // LW
        if (address % 4 !== 0) {
          throw new MemoryAlignmentError(`Dirección desalineada (Word) 0x${address.toString(16)}`);
        }
        return view.getInt32(address, false);

      case 8: // LD (Load Double) — exige alineación a 8 bytes (hardware)
        if (address % 8 !== 0) {
          throw new MemoryAlignmentError(`Dirección desalineada (Double) 0x${address.toString(16)}`);
        }
        return view.getFloat64(address, false);
      /**
       * Lee un double (64 bits, big-endian) desde una dirección alineada a 4 bytes.
       * A diferencia de read(size=8), no exige alineación a 8 bytes, por lo que
       * es apta para lecturas de syscall/TRAP donde el programa controla la dirección.
       */
      case 9:
        if (address % 4 !== 0) {
          throw new MemoryAlignmentError(`Dirección desalineada (Double syscall) 0x${address.toString(16)}`);
        }
        const hi = view.getUint32(address, false);
        const lo = view.getUint32(address + 4, false);
        const buf = new ArrayBuffer(8);
        const out = new DataView(buf);
        out.setUint32(0, hi, false);
        out.setUint32(4, lo, false);

        return out.getFloat64(0, false);

      default:
        return 0;
    }
  }

  /**
   * Escribe en memoria. Actualiza el signal de data y lastAccess.
   * @throws MemoryOutOfBoundsError si la dirección está fuera de rango
   */
  public write(address: number, value: number, size: number) {
    const mem = this.data();

    // Verificar límites de memoria
    const accessSize = size === 3 ? 4 : size; // size 3 = float (4 bytes)
    if (address < 0 || address + accessSize > mem.length) {
      throw new MemoryOutOfBoundsError(
        `Escritura fuera de límites: dirección 0x${address.toString(16)}, tamaño ${accessSize}, memoria ${mem.length} bytes`
      );
    }

    this.data.update(mem => {
      const newMem = new Uint8Array(mem);

      switch (size) {
        case 1: // SB
          newMem[address] = value & 0xFF;
          break;
        case 2: // SH
          newMem[address]     = (value >>> 8) & 0xFF;
          newMem[address + 1] = value & 0xFF;
          break;
        case 3: { // SF
          const viewF = new DataView(newMem.buffer);
          viewF.setFloat32(address, value, false); // false = Big Endian
          break;
        }
        case 4: // SW
          newMem[address]     = (value >>> 24) & 0xFF;
          newMem[address + 1] = (value >>> 16) & 0xFF;
          newMem[address + 2] = (value >>> 8) & 0xFF;
          newMem[address + 3] = value & 0xFF;
          break;
        case 8: // SD
          const view = new DataView(newMem.buffer);
          view.setFloat64(address, value, false); // false = Big Endian
          break;
      }
      return newMem;
    });

    this.lastAccess.set(Math.floor(address / 4));
  }

  public get()
  {
    return this.data();
  }

  public set(newMemory: Uint8Array) {
    this.data.set(newMemory);
    this.lastAccess.set(null);
  }

  public load(newMemory: Uint8Array, startIndex: number = 0) {
    if (newMemory.length > 0) {
      this.data.update(mem => {
        const next = new Uint8Array(mem);
        next.set(newMemory, startIndex);
        return next;
      });
      this.lastAccess.set(null);
    }
  }

  public reset() {
    this.data.update(mem => new Uint8Array(mem.length));
    this.lastAccess.set(null);
  }

  public at(index: number) {
    return this.data().at(index);
  }

  public getLastAccess() {
    return this.lastAccess();
  }

  public getName() {
    return this.name;
  }
}
