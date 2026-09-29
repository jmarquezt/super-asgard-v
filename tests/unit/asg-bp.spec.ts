import { AsgBranchPredictorService } from '../../src/app/core/services/asg.bp';

describe('AsgBranchPredictorService', () => {
  it('never predicts a branch as taken with the "none" strategy', () => {
    const bp = new AsgBranchPredictorService('none');
    expect(bp.predict(100).taken).toBe(false);
  });

  it('always predicts a branch as taken with the "always-taken" strategy', () => {
    const bp = new AsgBranchPredictorService('always-taken');
    expect(bp.predict(100).taken).toBe(true);
  });

  it('learns the branch target through the BTB once the branch is taken', () => {
    const bp = new AsgBranchPredictorService('always-taken');
    bp.update(100, true, 200);
    expect(bp.predict(100).target).toBe(200);
  });

  it('falls back to pc+4 when there is no learned BTB entry', () => {
    const bp = new AsgBranchPredictorService('always-taken');
    expect(bp.predict(100).target).toBe(104);
  });

  it('1-bit predictor flips its prediction immediately after a miss', () => {
    const bp = new AsgBranchPredictorService('1-bit');
    bp.update(100, true, 200);
    expect(bp.predict(100).taken).toBe(true);

    bp.update(100, false, 104);
    expect(bp.predict(100).taken).toBe(false);
  });

  it('2-bit predictor requires two consecutive misses to flip its prediction once fully trained', () => {
    const bp = new AsgBranchPredictorService('2-bit');
    // Tres aciertos seguidos (tomado) llevan el contador saturante 0 -> 1 -> 2 -> 3 (Strongly Taken)
    bp.update(100, true, 200);
    bp.update(100, true, 200);
    bp.update(100, true, 200);
    expect(bp.predict(100).taken).toBe(true);

    // Un solo fallo baja el contador a 2 (Weakly Taken), sigue prediciendo "tomado"
    bp.update(100, false, 104);
    expect(bp.predict(100).taken).toBe(true);

    // Un segundo fallo baja el contador a 1 (Weakly Not Taken), ahora predice "no tomado"
    bp.update(100, false, 104);
    expect(bp.predict(100).taken).toBe(false);
  });

  it('resets all learned state', () => {
    const bp = new AsgBranchPredictorService('2-bit');
    bp.update(100, true, 200);
    bp.update(100, true, 200);
    bp.reset();
    expect(bp.predict(100).taken).toBe(false);
    expect(bp.getBTB().size).toBe(0);
  });

  it('btfn predicts taken for backward branches (target < pc) and not-taken for forward ones', () => {
    const bp = new AsgBranchPredictorService('btfn');
    bp.update(200, true, 100); // aprende un destino hacia atrás para pc=200
    expect(bp.predict(200).taken).toBe(true);

    bp.update(100, true, 300); // destino hacia adelante para pc=100
    expect(bp.predict(100).taken).toBe(false);
  });

  it('btfn no actualiza el BHT (solo el BTB); update() no lanza para esa rama', () => {
    const bp = new AsgBranchPredictorService('btfn');
    expect(() => bp.update(100, true, 200)).not.toThrow();
    expect(bp.getBHT().size).toBe(0);
  });

  it('gshare predice según el historial global (GHR) combinado con el PC, no solo por PC', () => {
    const bp = new AsgBranchPredictorService('gshare');

    // Entrena fuertemente "tomado" para el índice actual (ghr=0 al principio)
    bp.update(100, true, 200);
    bp.update(100, true, 200);
    bp.update(100, true, 200);
    expect(bp.predict(100).taken).toBe(true);

    // Cambiar el historial global (simulando otros saltos tomados) cambia el índice
    // gshare (PC ^ GHR) usado, así que la misma PC puede predecir distinto.
    bp.updateGHRSpeculative(true);
    bp.updateGHRSpeculative(true);
    expect(bp.predict(100).taken).toBe(false); // índice distinto, todavía sin entrenar -> not-taken
  });

  it('updateGHRSpeculative/rollbackGHR solo afectan al GHR en gshare/hybrid, no en otras estrategias', () => {
    const none = new AsgBranchPredictorService('none');
    none.updateGHRSpeculative(true);
    expect(none.getGHR()).toBe(0); // "none" ignora el GHR

    const gshare = new AsgBranchPredictorService('gshare');
    gshare.updateGHRSpeculative(true);
    expect(gshare.getGHR()).toBe(1);

    gshare.rollbackGHR(0, false); // deshace la actualización especulativa
    expect(gshare.getGHR()).toBe(0);
  });

  describe('estrategia "hybrid" (predictor en torneo local/global)', () => {
    it('cuando el global acierta y el local falla repetidamente, el selector satura hacia "usar global"', () => {
      const bp = new AsgBranchPredictorService('hybrid');

      // Simulamos, llamada tras llamada, que el componente local predijo mal y el
      // global predijo bien (localTaken=false, globalTaken=true, actuallyTaken=true):
      // localCorrect=false, globalCorrect=true -> discrepancia -> el selector se
      // desplaza hacia "global" (0 -> 1 -> 2 -> 3) hasta saturar.
      for (let i = 0; i < 3; i++) {
        bp.update(100, true, 200, 0, false, true);
      }

      expect(bp.getSelectorTable().get(100)).toBe(3); // saturado en "usar global"
    });

    it('cuando el local acierta y el global falla repetidamente, el selector satura hacia "usar local"', () => {
      const bp = new AsgBranchPredictorService('hybrid');

      for (let i = 0; i < 3; i++) {
        bp.update(100, true, 200, 0, true, false); // localCorrect=true, globalCorrect=false
      }

      expect(bp.getSelectorTable().get(100)).toBe(0); // saturado en "usar local"
    });

    it('no mueve el selector cuando local y global coinciden (ambos aciertan o ambos fallan)', () => {
      const bp = new AsgBranchPredictorService('hybrid');

      // Ambos predijeron "no tomado" y la rama realmente no se toma: ambos aciertan
      // a la vez -> la rama `if (globalCorrect !== localCorrect)` no se ejecuta y la
      // tabla selectora se queda sin entrada para este pc.
      bp.update(100, false, 104, 0, false, false);

      expect(bp.getSelectorTable().has(100)).toBe(false);
    });
  });

  describe('estrategia "ras" (Return Address Stack para JR)', () => {
    it('JAL/JALR apilan la dirección de retorno y predicen "tomado"', () => {
      const bp = new AsgBranchPredictorService('ras');
      const result = bp.predict(100, 'JAL');

      expect(result.taken).toBe(true);
      expect(bp.getRAS()).toEqual([104]); // pc+4
    });

    it('JR con la pila no vacía predice el destino apilado por la última llamada (JAL/JALR)', () => {
      const bp = new AsgBranchPredictorService('ras');
      bp.predict(100, 'JAL'); // apila retorno 104

      const result = bp.predict(999, 'JR');

      expect(result.taken).toBe(true);
      expect(result.target).toBe(104);
      expect(bp.getRAS()).toEqual([]); // el JR desapila
    });

    it('JR con la pila vacía cae de vuelta al BTB (o pc+4 si no hay entrada aprendida)', () => {
      const bp = new AsgBranchPredictorService('ras');

      const result = bp.predict(999, 'JR');

      expect(result.target).toBe(1003); // pc+4, sin entrada en BTB
    });

    it('la pila del RAS es circular: no crece más allá de su tamaño máximo', () => {
      const bp = new AsgBranchPredictorService('ras');
      for (let i = 0; i < 20; i++) {
        bp.predict(i * 4, 'JAL');
      }

      expect(bp.getRAS().length).toBeLessThanOrEqual(8);
    });

    it('update() con estrategia ras también entrena el BHT (para saltos condicionales)', () => {
      const bp = new AsgBranchPredictorService('ras');
      expect(() => bp.update(100, true, 200)).not.toThrow();
      expect(bp.getBHT().size).toBeGreaterThan(0);
    });
  });

  it('setStrategy() cambia la estrategia, el tamaño del GHR y resetea todo el estado aprendido', () => {
    const bp = new AsgBranchPredictorService('2-bit');
    bp.update(100, true, 200);
    expect(bp.getBTB().size).toBe(1);

    bp.setStrategy('gshare', 4);

    expect(bp.strategy).toBe('gshare');
    expect(bp.getBTB().size).toBe(0); // reset() se llama dentro de setStrategy
  });

  it('los getters exponen las estructuras internas (BHT, BHT global, tabla selectora, BTB, GHR, RAS)', () => {
    const bp = new AsgBranchPredictorService('hybrid');
    bp.update(100, true, 200, 0, false, true); // discrepancia local/global -> toca la selectorTable

    expect(bp.getBHT()).toBeInstanceOf(Map);
    expect(bp.getGlobalBHT()).toBeInstanceOf(Map);
    expect(bp.getSelectorTable()).toBeInstanceOf(Map);
    expect(bp.getBTB().get(100)).toBe(200);
    expect(typeof bp.getGHR()).toBe('number');
    expect(Array.isArray(bp.getRAS())).toBe(true);
  });
});
