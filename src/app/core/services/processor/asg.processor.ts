import {effect, inject, signal, untracked} from '@angular/core';
import {LogEntry, TrapStdinRequest, TimelineEntry} from '../../models/asg.models';
import {CODE_BASE} from '../../models/asg.exceptions';
import {LastModifiedRegister, AsgRegisterFileService} from '../asg.register-file';
import {AsgMemoryService} from '../asg.memory';
import {AsgConfigService} from '../asg.config';
import {LogService} from '../../../services/log';
import {AsgBranchPredictorService} from '../asg.bp';

/** Velocidades de reloj seleccionables en la interfaz, en ciclos por segundo (Hz) */
export const CLOCK_SPEEDS = [0.5, 1, 2, 3, 5, 10, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000];

export function formatClockSpeed(cyclesPerSecond: number): string {
  return cyclesPerSecond >= 1000 ? `${cyclesPerSecond / 1000} kHz` : `${cyclesPerSecond} Hz`;
}

// Tiempo de cada frame dedicado a simular; el resto queda para que la interfaz se pinte
const FRAME_BUDGET_MS = 10;
// Tope de ciclos por frame en velocidad máxima (por si el reloj no avanza, p. ej. con temporizadores simulados)
const MAX_CYCLES_PER_FRAME = 50000;
// Intervalo de frame inicial (60 Hz) y máximo que se tiene en cuenta: tras un frame lento no se recupera
// el tiempo perdido de golpe, para no ejecutar una ráfaga de ciclos que se vería como un salto
const DEFAULT_FRAME_MS = 1000 / 60;
const MAX_FRAME_MS = 50;

export abstract class AsgProcessorService {
  // Estado del hardware: ciclo actual y contador de programa
  cycle = signal<number>(0); // necesito un signal aqui para notificar el nuevo ciclo a los componentes que tengan que actualizar la interfaz (principalmente el timeline)
  pc = CODE_BASE;
  isRunning = signal(false);
  finished = signal(false);
  //true cuando el usuario ha pulsado Stop: la ejecución está pausada y el próximo Run/Step debe hacer un reset completo antes de empezar.
  isStopped = signal(false);
  // Velocidad del reloj en ciclos por segundo, y modo velocidad máxima (tantos ciclos como quepan en cada frame)
  cyclesPerSecond = signal<number>(2);
  maxSpeed = signal(false);
  private runFrame: number | null = null;
  private pendingCycles = 0;
  private lastFrameTime = 0;
  private frameInterval = DEFAULT_FRAME_MS;
  //IAR — Interrupt Address Register: almacena la dirección de retorno (PC+4) de la instrucción TRAP cuando se ejecuta.
  iar = signal<number>(0);
  // CAUSE — Almacena el motivo de la última excepción (en estos procesadores, el codigo de excepcion)
  cause = signal<string>('');
  // Solicitud de lectura de stdin pendiente (TRAP 3, fd=0). La UI la observa para pedir el dato por la consola
  trapStdinRequest = signal<TrapStdinRequest | null>(null);
  // Salida de consola del programa (producida por TRAP 4 y TRAP 5).
  consoleOutput = signal<string[]>([]);
  //flag para saber si el procesador estaba en marcha cuando se interrumpió por TRAP
  protected wasRunningBeforeTrap = false;

  // Banco de registros unificado (int-float-vectorial-especiales)
  registerFile!: AsgRegisterFileService;
  // Bancos de memoria de datos e instrucciones
  dataMemory: AsgMemoryService;
  instructionsMemory: AsgMemoryService;
  // Predictor
  branchPredictor = new AsgBranchPredictorService('none');

  // Configuración vectorial
  public aluLanes = signal<number>(4);
  public memoryLanes = signal<number>(4);
  // MVL (Maximum Vector Length): Longitud máxima de un vector (configurable)
  public get MVL(): number {
    return this.configService.getCurrentConfig().mvl;
  }

  // Configuracion editable del procesador y logs
  protected configService = inject(AsgConfigService);
  protected logService = inject(LogService);

  // Debug
  breakpoints = new Set<number>();
  private fetchedPcs: number[] = [];
  // Mapa PC → número de línea real en el editor (construido al cargar el programa)
  protected pcToLine = new Map<number, number>();

  timeline = signal<TimelineEntry[]>([]);
  protected timelineIndex: Map<number, TimelineEntry> = new Map();

  constructor(enableRRF: boolean) {

    const config = this.configService.getCurrentConfig();

    // Inicializar banco de registros unificado
    this.registerFile = new AsgRegisterFileService({
      mvl: config.mvl,
      enableRRF: enableRRF // Solo el superescalar incluye renombramiento, el resto pasara false
    });

    // Configurar carriles de ejecución vectorial
    this.aluLanes.set(config.aluLanes);
    this.memoryLanes.set(config.memLanes);

    //inicializo las memorias con sus tamaños
    this.dataMemory = new AsgMemoryService(config.memorySize, 'Datos');
    this.instructionsMemory = new AsgMemoryService(0, 'Instrucciones');

    // Usamos un effect() para escuchar los cambios en la configuración dinámicamente
    effect(() => {
      const config = this.configService.getCurrentConfig() // Leemos la config actual
      // Si cambia el tamaño de memoria, seteamos el nuevo tamaño
      this.dataMemory.set(new Uint8Array(config.memorySize));
      this.aluLanes.set(config.aluLanes);
      this.memoryLanes.set(config.memLanes);
      this.branchPredictor.setStrategy(config.branchPredictionStrategy, config.ghrBits);
      untracked(() => {
        // untracked impide que si una señal cambia dentro de el, se ejecuten los effect asociados a esa señal, reseteamos el procesador de forma segura
        this.reset();
      });
    });
  }

  // Métodos para gestionar breakpoints desde el componente
  toggleBreakpoint(line: number) {
    if (this.breakpoints.has(line)) {
      this.breakpoints.delete(line);
    } else {
      this.breakpoints.add(line);
    }
  }

  getBreakpoints(): number[] {
    return Array.from(this.breakpoints);
  }

  setBreakpointLines(lines: number[]): void {
    this.breakpoints.clear();
    lines.forEach(l => this.breakpoints.add(l));
  }

  /** Cada procesador lo llama al capturar (IF) una instrucción, para que run() pueda parar en sus breakpoints */
  protected recordFetch(pc: number): void {
    this.fetchedPcs.push(pc);
  }

  /** Línea con breakpoint de alguna instrucción capturada en el último ciclo, o null si no hay ninguna */
  private fetchedBreakpointLine(): number | null {
    for (const pc of this.fetchedPcs) {
      const line = this.pcToLine.get(pc) ?? ((pc / 4) + 1);
      if (this.breakpoints.has(line)) return line;
    }
    return null;
  }

  /**
   * Líneas del editor que marca la flecha de ejecución: las de las últimas instrucciones que han entrado
   * al procesador (las mismas que las últimas filas del cronograma), de la más antigua a la más joven.
   */
  getActiveSourceLines(): number[] {
    return [];
  }

  /** Líneas del editor de las instrucciones en `pcs`, sin las que no vienen del código del usuario (p. ej. la tabla de vectores) */
  protected sourceLinesOf(pcs: number[]): number[] {
    const lines: number[] = [];
    for (const pc of pcs) {
      const line = this.pcToLine.get(pc);
      if (line !== undefined && line > 0) lines.push(line);
    }
    return lines;
  }

  addLog(message: string, type: LogEntry['type'] = 'info') {
    const logConfig = this.configService.getCurrentConfig();
    if (!logConfig.loggingEnabled) return;

    this.logService.log(message, type, this.cycle());
  }

  clearLog() {
    this.logService.clearLog();
  }

  pause(): void {
    if (this.runFrame !== null) {
      cancelAnimationFrame(this.runFrame);
      this.runFrame = null;
    }
    this.isRunning.set(false);
  }

  /**
   * Ejecución continua. En cada frame de pantalla se ejecutan los ciclos que corresponden al tiempo
   * transcurrido según la velocidad (o los que quepan en el presupuesto en velocidad máxima), y la
   * interfaz se pinta una sola vez por frame con todos ellos.
   */
  run(): void {
    if (this.isRunning()) return;
    this.isStopped.set(false);
    this.isRunning.set(true);
    this.pendingCycles = 0;
    this.lastFrameTime = performance.now();
    this.runFrame = requestAnimationFrame(this.runLoop);
  }

  private readonly runLoop = (now: number): void => {
    this.runFrame = null;
    if (!this.isRunning()) return;

    // Se usa la media móvil del intervalo entre frames (no el de este frame): las pequeñas variaciones
    // del navegador no alternan frames con más y menos ciclos, y el reparto queda uniforme
    const elapsed = Math.min(MAX_FRAME_MS, Math.max(0, now - this.lastFrameTime));
    this.lastFrameTime = now;
    this.frameInterval += (elapsed - this.frameInterval) * 0.1;
    this.pendingCycles = this.maxSpeed()
      ? MAX_CYCLES_PER_FRAME
      : this.pendingCycles + this.frameInterval / 1000 * this.cyclesPerSecond();

    const deadline = performance.now() + FRAME_BUDGET_MS;
    while (this.pendingCycles >= 1) {
      // Si el equipo no da para la velocidad pedida, se descarta el retraso en vez de acumularlo
      if (performance.now() >= deadline) {
        this.pendingCycles = 0;
        break;
      }
      this.pendingCycles--;
      if (!this.runCycle()) return;
    }

    this.runFrame = requestAnimationFrame(this.runLoop);
  };

  /** Ejecuta un ciclo dentro de run(); devuelve false si la ejecución se ha detenido */
  private runCycle(): boolean {
    this.fetchedPcs = [];
    this.nextCycle();

    // El ciclo pudo pausar el procesador (TRAP, excepción...)
    if (!this.isRunning()) return false;

    if (this.checkRunFinished()) return false;

    // Se para justo después de capturar la instrucción con breakpoint: queda en IF y marcada en el editor.
    // Al continuar no se vuelve a parar en ella salvo que se capture de nuevo (p. ej. otra vuelta de un bucle)
    const breakpointLine = this.fetchedBreakpointLine();
    if (breakpointLine !== null) {
      this.pause();
      this.addLog(`Breakpoint alcanzado en línea ${breakpointLine}`, 'warning');
      return false;
    }
    return true;
  }

  /** Comprueba tras cada ciclo de run() si el programa ha terminado; si es así detiene la ejecución y devuelve true */
  protected checkRunFinished(): boolean {
    if (!this.isFinished()) return false;
    this.pause();
    this.finished.set(true);
    this.addLog('Programa finalizado', 'success');
    // eliminar el ciclo adicional sumado
    this.cycle.update(c => c - 1);
    return true;
  }

  /** Detiene la ejecución sin borrar el estado. El próximo Run hará un reset. */
  stop() {
    this.pause();
    this.isStopped.set(true);
  }

  abstract reset(): void;

  abstract isFinished(): boolean

  abstract nextCycle(): void;

  abstract load(instructions: Uint8Array, dataMemory: Uint8Array, initialCodePtr: number, pcToLine?: Map<number, number>): void;

  abstract resolveTrapStdin(input: string): void

  getRegisters(): Int32Array {
    return this.registerFile.registers();
  }

  getFloatRegisters(): Float32Array {
    return this.registerFile.floatRegisters()
  }

  getVectorRegisters(): Float64Array[] {
    return this.registerFile.vectorRegisters();
  }

  getLastModifiedRegister(): LastModifiedRegister | null {
    return this.registerFile.lastModifiedReg();
  }

  getFPConditionBit(): number {
    return this.registerFile.fpConditionBit();
  }

  getVl(): number {
    return this.registerFile.vl();
  }

  getVectorMask(): Float64Array {
    return this.registerFile.vectorMask();
  }

  getFloatValue(index: number, isDouble: boolean): number {
    try {
      return this.registerFile.getFloatRegister(index, isDouble);
    } catch (e: any) {
      this.addLog(e.message, 'error');
      this.pause(); // Detenemos la ejecución por error de hardware
      return 0;
    }
  }

  setFloatValue(index: number, value: number, isDouble: boolean) {
    try {
      return this.registerFile.writeFloatRegister(index, value, isDouble);
    } catch (e: any) {
      this.addLog(e.message, 'error');
      this.pause(); // Detenemos la ejecución por error de hardware
    }
  }

}
