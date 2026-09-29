import { runAcrossMachines } from '../run-program';

// Programa raíz: test-scheduling.asm
// R1 y R2 arrancan sin inicializar (0). Tras la primera vuelta del bucle quedan en -8, y en la
// SEGUNDA vuelta "LD F0, 0(R1)" intenta leer la dirección -8: AsgMemoryService.read() rechaza
// cualquier dirección negativa con MemoryOutOfBoundsError, así que el procesador dispara
// MEMORY_OUT_OF_BOUNDS, salta al manejador por defecto (TRAP 6) y el programa se detiene tras
// completar solo una iteración — no es el bucle infinito que sugiere el comentario original del
// fichero (pensado para observarse en la UI, no para ejecutarse hasta el final).
//
// BUG CONOCIDO (monociclo): falla en la variante [monociclo (non-pipelined)] con R1=0 (y
// presumiblemente R2=0) en vez de -8 — como si el manejo de MEMORY_OUT_OF_BOUNDS en
// asg.non-pipelined.processor.ts reseteara los registros al saltar al manejador, en vez de solo
// detener/redirigir el PC como hace el pipelined. No confirmado línea a línea. Se deja en rojo a
// propósito como marcador del bug hasta investigarlo.
describe('test-scheduling.asm', () => {
  runAcrossMachines(
    'se detiene por acceso fuera de límites al decrementar el puntero por debajo de 0, en cualquier configuración de máquina',
    `
      .text
      ; R1 y R2 son punteros a arrays de doubles
      ; F2 contiene una constante

      inicio:
          LD    F0, 0(R1)       ; Carga A[i]
          ADDD  F4, F0, F2      ; A[i] + constante (STALL: espera a F0)
          SD    0(R1), F4       ; Guarda A[i] (STALL: espera 5 ciclos a ADDD)

          LD    F6, 0(R2)       ; Carga B[i]
          SUBD  F8, F6, F2      ; B[i] - constante (STALL: espera a F6)
          SD    0(R2), F8       ; Guarda B[i] (STALL: espera 5 ciclos a SUBD)

          SUBI  R1, R1, #8      ; Siguiente elemento A
          SUBI  R2, R2, #8      ; Siguiente elemento B
          BNEZ  R1, inicio      ; Lazo
    `,
    (processor) => {
      const regs = processor.getRegisters();
      expect(regs[1]).toBe(-8);
      expect(regs[2]).toBe(-8);
      expect(processor.cause()).toBe('MEMORY_OUT_OF_BOUNDS');
    },
  );
});
