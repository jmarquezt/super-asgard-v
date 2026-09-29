import {effect, inject, signal, untracked} from '@angular/core';
import {LogEntry, TrapStdinRequest, TimelineEntry} from '../../models/asg.models';
import {CODE_BASE} from '../../models/asg.exceptions';
import {LastModifiedRegister, AsgRegisterFileService} from '../asg.register-file';
import {AsgMemoryService} from '../asg.memory';
import {AsgConfigService} from '../asg.config';
import {LogService} from '../../../services/log';
import {AsgBranchPredictorService} from '../asg.bp';

export abstract class AsgProcessorService {
  // Estado del hardware: ciclo actual y contador de programa
  cycle = signal<number>(0); // necesito un signal aqui para notificar el nuevo ciclo a los componentes que tengan que actualizar la interfaz (principalmente el timeline)
  pc = CODE_BASE;
  isRunning = signal(false);
  finished = signal(false);
  //true cuando el usuario ha pulsado Stop: la ejecución está pausada y el próximo Run/Step debe hacer un reset completo antes de empezar.
  isStopped = signal(false);
  protected runInterval: ReturnType<typeof setInterval> | null = null;
  // Velocidad en milisegundos (ms)
  speed = signal<number>(500);
  // Ciclos por tick (modo rendimiento)
  cyclesPerTick = signal<number>(1);
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

  // Actualiza la velocidad y reinicia el intervalo si está en ejecución desde la UI
  updateSpeed(newSpeed: number) {
    this.speed.set(newSpeed);
    if (this.isRunning()) {
      this.pause();
      this.run(); // Reinicia con el nuevo delay
    }
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

  /**
   * Comprueba si la instrucción que va a entrar en IF tiene un breakpoint.
   * Usa el mapa PC → línea real del editor para una correspondencia exacta.
   */
  shouldStopAtBreakpoint(): boolean {
    const currentLine = this.getCurrentSourceLine();
    return this.breakpoints.has(currentLine);
  }

  /** Devuelve la línea del editor correspondiente al PC actual. */
  getCurrentSourceLine(): number {
    return this.pcToLine.get(this.pc) ?? ((this.pc / 4) + 1);
  }

  /** Devuelve la linea del editor correspondiente a la instruccion en la etapa ex o null si no hay ninguna */
  getExSourceLine(): number | null {
    return null;
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
    if (this.runInterval) {
      clearInterval(this.runInterval);
      this.runInterval = null;
    }
    this.isRunning.set(false);
  }

  /** Detiene la ejecución sin borrar el estado. El próximo Run hará un reset. */
  stop() {
    this.pause();
    this.isStopped.set(true);
  }

  abstract run(): void;

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
