/**
 * Tabla de simbolos del procesador. La uso en tiempo de compilacion para resolver etiquetas y en tiempo de ejecucion para obtener punteros
 */
export class SymbolTable {
  private static symbols = new Map<string, SymbolEntry>();

  static add(name: string, address: number, segment: 'TEXT' | 'DATA') {
    this.symbols.set(name, { name, address, segment });
  }

  static get(name: string): SymbolEntry | undefined {
    return this.symbols.get(name);
  }

  static getAddress(name: string): number {
    const entry = this.symbols.get(name);
    if (!entry) throw new Error(`Símbolo no definido: ${name}`);
    return entry.address;
  }

  /** Elimina el prefijo de módulo (__m0__, __m1__...) para mostrar el nombre original. */
  static cleanName(name: string): string {
    return name.replace(/^__m\d+__/, '');
  }

  static getName(address: number, segment: 'TEXT' | 'DATA'): string | undefined {
    for (const entry of this.symbols.values()) {
      if (entry.address === address && entry.segment === segment) {
        return this.cleanName(entry.name);
      }
    }
    return undefined;
  }

  static getAll(): Map<string, SymbolEntry> {
    return this.symbols;
  }

  static clear() { this.symbols.clear(); }
}

export interface SymbolEntry {
  address: number;
  segment: 'TEXT' | 'DATA';
  name: string;
}
