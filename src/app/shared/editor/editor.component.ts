import {
  Component,
  ElementRef,
  inject,
  effect,
  AfterViewInit,
  OnDestroy,
  viewChild,
  signal,
  computed,
  input
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/list';
import { MatToolbar } from '@angular/material/toolbar';
import { MatTooltip } from '@angular/material/tooltip';
import { MatSlider, MatSliderThumb } from '@angular/material/slider';
import { MatDialog } from '@angular/material/dialog';
import { v4 as uuidv4 } from 'uuid';
import * as monaco from 'monaco-editor';
import { TranslocoDirective } from '@jsverse/transloco';
import { AsgProcessorService } from '../../core/services/processor/asg.processor';
import { AsgProcessorFactoryService } from '../../core/services/processor/asg.processor-factory';
import { AsgAssemblerService } from '../../core/services/assembly/asg.assembler';
import { StaticSchedulingDialogComponent } from '../static-scheduling-dialog/static-scheduling-dialog.component';
import { asgLanguageConfig, asgLanguageTokens } from '../../core/helpers/asg.languaje';
import { ThemeService } from '../../services/theme';

interface TabState {
  id: string;
  name: string;
  model: monaco.editor.ITextModel;
  breakpoints: Set<number>; // líneas locales (base 1)
}

@Component({
  selector: 'app-editor',
  templateUrl: './editor.component.html',
  imports: [
    MatIcon,
    MatButton,
    MatIconButton,
    MatDivider,
    MatToolbar,
    MatTooltip,
    MatSlider,
    MatSliderThumb,
    TranslocoDirective,
  ],
  styleUrl: './editor.component.scss',
})
export class EditorComponent implements AfterViewInit, OnDestroy {

  // flag para controlar si hay que ocultar la botonera de ejecucion (para movil se oculta y aparece la flotante)
  readonly hideControls = input(false);
  private editor!: monaco.editor.IStandaloneCodeEditor;
  private readonly editorElement = viewChild<ElementRef<HTMLDivElement>>('editorContainer');

  private currentLineDecorations!: monaco.editor.IEditorDecorationsCollection;
  private breakpointDecorationsCollection!: monaco.editor.IEditorDecorationsCollection;
  private hoverBreakpointDecoration!: monaco.editor.IEditorDecorationsCollection;
  private errorLineDecoration!: monaco.editor.IEditorDecorationsCollection;
  private lastHoveredLine: number | null = null;

  private processorFactory = inject(AsgProcessorFactoryService);
  protected asgAssembler = inject(AsgAssemblerService);
  private themeService = inject(ThemeService);
  private dialog = inject(MatDialog);

  /**
   * Devuelve el tipo de procesador actual basado en la configuracion del usuario
   * @protected
   */
  protected get processor(): AsgProcessorService {
    return this.processorFactory.getProcessor();
  }

  /**
   * PC actual
   * @protected
   */
  protected currentPC = computed(() => {
    return this.processor.pc;
  });

  /**
   * Velocidad de ejecucion actual
   * @protected
   */
  protected currentSpeed = computed(() => {
    return this.processor.speed();
  });

  /**
   * Signal para el modo performance
   */
  performanceMode = signal(false);

  /**
   * TABS del editor
   * @protected
   */
  protected tabs = signal<TabState[]>([]);
  protected activeTabIndex = signal(0);

  /** lineOffsets[i] = número de líneas acumuladas antes del módulo i (offset de línea global). */
  private lineOffsets: number[] = [0];

  constructor() {
    effect(() => {
      const dark = this.themeService.isDark();
      if (this.editor)
        monaco.editor.setTheme(dark ? 'asg-dark' : 'asg-light');
    });

    // Effect para manejar los decorators de monaco para los procesadores segmentado y no-segmentado
    effect(() => {
      if (this.processorFactory.isSuperscalar()) return;
      // Access processor to track signals
      const currentCycle = this.processor.cycle();
      const running = this.processor.isRunning();
      const finished = this.processor.finished();
      if (!this.editor) return;

      if (currentCycle === 0 || finished) {
        this.currentLineDecorations?.set([]);
        return;
      }

      if (running) {
        const line = this.processor.getExSourceLine();
        if (line !== null) {
          this.highlightCurrentLine(line, true);
        } else {
          this.currentLineDecorations?.set([]);
        }
      }
    });

    // Effect para manejar los decoratos de monaco para el procesador superescalar
    effect(() => {
      if (!this.processorFactory.isSuperscalar()) return;
      const currentCycle = this.processor.cycle();
      const running = this.processor.isRunning();
      const finished = this.processor.finished();
      if (!this.editor) return;

      if (currentCycle === 0 || finished) {
        this.currentLineDecorations?.set([]);
        return;
      }

      if (running) {
        // En superscalar, resaltar todas las instrucciones en ejecución (EX)
        this.highlightMultipleLines();
      }
    });
  }

  ngAfterViewInit() {
    setTimeout(() => this.initMonaco(), 0);
  }

  private initMonaco() {
    const element = this.editorElement();
    if (!element) {
      console.error('Editor container element not found');
      return;
    }
    monaco.languages.register({ id: 'asg' });
    monaco.languages.setMonarchTokensProvider('asg', asgLanguageTokens as monaco.languages.IMonarchLanguage);
    monaco.languages.setLanguageConfiguration('asg', asgLanguageConfig as monaco.languages.LanguageConfiguration);

    monaco.editor.defineTheme('asg-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword',             foreground: '569cd6', fontStyle: 'bold'   },
        { token: 'variable.predefined', foreground: '9cdcfe'                      },
        { token: 'metatag',             foreground: 'dcdcaa'                      },
        { token: 'comment',             foreground: '6a9955', fontStyle: 'italic' },
        { token: 'number',              foreground: 'b5cea8'                      },
        { token: 'keyword.directive',   foreground: 'c586c0', fontStyle: 'bold'   },
        { token: 'string',              foreground: 'ce9178'                      },
        { token: 'number.hex',          foreground: 'b5cea8'                      },
        { token: 'number.float',        foreground: 'b5cea8'                      },
        { token: 'delimiter',           foreground: 'd4d4d4'                      },
      ],
      colors: { 'editor.background': '#1e1e1e' },
    });

    monaco.editor.defineTheme('asg-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'keyword',             foreground: '0000ff', fontStyle: 'bold'   },
        { token: 'variable.predefined', foreground: '001080'                      },
        { token: 'metatag',             foreground: '795E26'                      },
        { token: 'comment',             foreground: '008000', fontStyle: 'italic' },
        { token: 'number',              foreground: '098658'                      },
        { token: 'keyword.directive',   foreground: 'af00db', fontStyle: 'bold'   },
        { token: 'string',              foreground: 'a31515'                      },
        { token: 'number.hex',          foreground: '098658'                      },
        { token: 'number.float',        foreground: '098658'                      },
        { token: 'delimiter',           foreground: '000000'                      },
      ],
      colors: { 'editor.background': '#ffffff' },
    });

    const firstModel = monaco.editor.createModel(
      `; Ejemplo ASG\n.text\nADDI R1, R0, #10\nLOOP: SUBI R1, R1, #1\nBNEZ R1, LOOP`,
      'asg',
    );
    this.tabs.set([{ id: uuidv4(), name: 'main.asg', model: firstModel, breakpoints: new Set() }]);

    this.editor = monaco.editor.create(element.nativeElement, {
      theme: this.themeService.isDark() ? 'asg-dark' : 'asg-light',
      automaticLayout: true,
      glyphMargin: true,
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 4,
      minimap: { enabled: false },
    });
    this.editor.setModel(firstModel);

    this.currentLineDecorations = this.editor.createDecorationsCollection([]);
    this.breakpointDecorationsCollection = this.editor.createDecorationsCollection([]);
    this.hoverBreakpointDecoration = this.editor.createDecorationsCollection([]);
    this.errorLineDecoration = this.editor.createDecorationsCollection([]);

    this.editor.onMouseDown((e: monaco.editor.IEditorMouseEvent) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const line = e.target.position?.lineNumber;
        if (line && this.isInstructionLine(line)) this.toggleBreakpoint(line);
      }
    });

    this.editor.onMouseMove((e: monaco.editor.IEditorMouseEvent) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const line = e.target.position?.lineNumber;
        if (line === this.lastHoveredLine) return;
        this.lastHoveredLine = line ?? null;

        const tab = this.tabs()[this.activeTabIndex()];
        if (line && this.isInstructionLine(line) && !tab.breakpoints.has(line)) {
          this.hoverBreakpointDecoration.set([{
            range: new monaco.Range(line, 1, line, 1),
            options: { isWholeLine: false, glyphMarginClassName: 'breakpoint-glyph-hover' },
          }]);
        } else {
          this.hoverBreakpointDecoration.set([]);
        }
      } else {
        if (this.lastHoveredLine !== null) {
          this.lastHoveredLine = null;
          this.hoverBreakpointDecoration.set([]);
        }
      }
    });

    this.editor.onMouseLeave(() => {
      this.lastHoveredLine = null;
      this.hoverBreakpointDecoration.set([]);
    });
  }

  addTab() {
    const model = monaco.editor.createModel('', 'asg');
    this.tabs.update(tabs => [
      ...tabs,
      { id: uuidv4(), name: `modulo_${tabs.length + 1}.asg`, model, breakpoints: new Set() },
    ]);
    this._switchModel(this.tabs().length - 1);
  }

  closeTab(index: number, event: MouseEvent) {
    event.stopPropagation();
    if (this.tabs().length <= 1) return;

    this.tabs()[index].model.dispose();
    this.tabs.update(tabs => tabs.filter((_, i) => i !== index));

    const current = this.activeTabIndex();
    const newIndex = index < current ? current - 1
      : index === current ? Math.min(index, this.tabs().length - 1)
        : current;

    this.currentLineDecorations?.set([]);
    this.errorLineDecoration?.set([]);
    this._switchModel(newIndex);
  }

  activateTab(index: number) {
    if (index === this.activeTabIndex()) return;
    this.currentLineDecorations?.set([]);
    this.hoverBreakpointDecoration?.set([]);
    this.errorLineDecoration?.set([]);
    this._switchModel(index);
  }

  private _switchModel(index: number) {
    this.activeTabIndex.set(index);
    if (this.editor) {
      this.editor.setModel(this.tabs()[index].model);
      this.updateBreakpointMarkers();
    }
  }

  toggleBreakpoint(localLine: number) {
    // Actualización inmutable para que el signal notifique el cambio (necesario con OnPush,
    // ya que el evento viene de Monaco y no de una plantilla de Angular)
    const activeIndex = this.activeTabIndex();
    this.tabs.update(tabs => tabs.map((tab, i) => {
      if (i !== activeIndex) return tab;
      const breakpoints = new Set(tab.breakpoints);
      if (breakpoints.has(localLine)) {
        breakpoints.delete(localLine);
      } else {
        breakpoints.add(localLine);
      }
      return { ...tab, breakpoints };
    }));
    this.updateBreakpointMarkers();
  }

  updateBreakpointMarkers() {
    if (!this.editor || !this.breakpointDecorationsCollection) return;
    const tab = this.tabs()[this.activeTabIndex()];
    const decorations = Array.from(tab.breakpoints).map(line => ({
      range: new monaco.Range(line, 1, line, 1),
      options: { isWholeLine: false, glyphMarginClassName: 'breakpoint-glyph' },
    }));
    this.breakpointDecorationsCollection.set(decorations);
  }

  get hasBreakpoints(): boolean {
    return this.tabs().some(tab => tab.breakpoints.size > 0);
  }

  /** Convierte una línea global (post-enlace) a { tabIndex, localLine }. */
  private globalToLocal(globalLine: number): { tabIndex: number; localLine: number } {
    const offsets = this.lineOffsets;
    for (let i = offsets.length - 1; i >= 0; i--) {
      if (i === 0 || globalLine > offsets[i]) {
        return { tabIndex: i, localLine: globalLine - offsets[i] };
      }
    }
    return { tabIndex: 0, localLine: globalLine };
  }

  highlightCurrentLine(globalLine: number, autoSwitch = false) {
    if (!this.editor || !this.currentLineDecorations) return;

    const { tabIndex, localLine } = this.globalToLocal(globalLine);

    if (tabIndex !== this.activeTabIndex()) {
      if (!autoSwitch) {
        this.currentLineDecorations.set([]);
        return;
      }
      this.activateTab(tabIndex);
    }

    this.currentLineDecorations.set([{
      range: new monaco.Range(localLine, 1, localLine, 1),
      options: {
        isWholeLine: true,
        className: 'current-line-highlight',
        glyphMarginClassName: 'current-line-margin',
      },
    }]);
    this.editor.revealLineInCenterIfOutsideViewport(localLine);
  }

  /** Resalta múltiples líneas (para superscalar) */
  highlightMultipleLines() {
    if (!this.editor || !this.currentLineDecorations) return;

    const proc = this.processor as any;
    const executingLines = proc.getExecutingSourceLines?.() || [];

    if (executingLines.length === 0) {
      this.currentLineDecorations.set([]);
      return;
    }

    const decorations = executingLines.map((globalLine: number) => {
      const { tabIndex, localLine } = this.globalToLocal(globalLine);
      return {
        range: new monaco.Range(localLine, 1, localLine, 1),
        options: {
          isWholeLine: true,
          className: 'current-line-highlight',
          glyphMarginClassName: 'current-line-margin',
        },
      };
    });

    this.currentLineDecorations.set(decorations);
  }

  compileAndLoad(): boolean {
    if (!this.editor) return false;

    const modules = this.tabs().map(tab => ({ name: tab.name, source: tab.model.getValue() }));
    const result = this.asgAssembler.assembleProgram(modules);

    if (!result.success) {
      this.processor.addLog(result.message, 'error');
      this.highlightErrorLine(result.errorLine, result.errorModule, result.lineOffsets);
      return false;
    }

    this.lineOffsets = result.lineOffsets;
    this.errorLineDecoration?.set([]);

    const pcToLine = new Map<number, number>();
    result.instructions.forEach(instr => pcToLine.set(instr.pc, instr.id));

    // Convertir breakpoints locales a líneas globales y cargarlos en el procesador
    const globalBreakpoints: number[] = [];
    this.tabs().forEach((tab, i) => {
      tab.breakpoints.forEach(localLine => globalBreakpoints.push(localLine + (this.lineOffsets[i] ?? 0)));
    });

    this.processor.setBreakpointLines(globalBreakpoints);

    this.processor.load(result.instructionBinary, result.dataBuffer, result.initialCodePtr, pcToLine);
    return true;
  }

  private highlightErrorLine(globalLine: number, moduleIndex: number, lineOffsets: number[]) {
    if (globalLine <= 0) return;
    const tabIndex = Math.max(0, Math.min(moduleIndex, this.tabs().length - 1));
    if (tabIndex !== this.activeTabIndex()) this.activateTab(tabIndex);
    const localLine = globalLine - (lineOffsets[tabIndex] ?? 0);
    this.errorLineDecoration?.set([{
      range: new monaco.Range(localLine, 1, localLine, 1),
      options: { isWholeLine: true, className: 'error-line-highlight' },
    }]);
    this.editor.revealLineInCenterIfOutsideViewport(localLine);
  }

  /** Devuelve true si la línea contiene una instrucción ASG (token 'keyword'). */
  private isInstructionLine(line: number): boolean {
    const model = this.editor.getModel();
    if (!model) return false;
    const content = model.getLineContent(line);
    if (!content.trim()) return false;
    const lineTokens = monaco.editor.tokenize(content, 'asg')[0] ?? [];
    return lineTokens.some(t => t.type === 'keyword.asg');
  }

  clearEditor() {
    const tab = this.tabs()[this.activeTabIndex()];
    tab.model.setValue('');
  }

  onRun() {
    const proc = this.processor;
    if (proc.cycle() === 0 || proc.isStopped()) {
      proc.reset();
      if (!this.compileAndLoad()) {
        proc.pause();
        return;
      }
    }
    if (proc.shouldStopAtBreakpoint()) {
      proc.nextCycle();
    }
    proc.run();
  }

  onStop() {
    this.processor.stop();
  }

  onStep() {
    const proc = this.processor;
    if (proc.cycle() === 0 || proc.isStopped()) {
      proc.reset();
      if (!this.compileAndLoad()) return;
    }
    proc.nextCycle();
    if (proc.isFinished()) {
      proc.finished.set(true);
      proc.addLog('Programa finalizado', 'success');
    } else {
      const line = proc.getCurrentSourceLine();
      this.highlightCurrentLine(line, true);
    }
  }

  onRunToBreakpoint() {
    const proc = this.processor;
    if (proc.cycle() === 0 || proc.isStopped()) {
      proc.reset();
      if (!this.compileAndLoad()) return;
    }
    // Breakpoint handling only for scalar
    if (proc.shouldStopAtBreakpoint()) {
      proc.nextCycle();
    }
    proc.run();
  }

  formatLabel(value: number): string {
    return `${value}ms`;
  }

  onSpeedChange(value: number) {
    this.processor.updateSpeed(value);
  }

  togglePerformanceMode() {
    const newMode = !this.performanceMode();
    this.performanceMode.set(newMode);
    this.processor.cyclesPerTick.set(newMode ? 500 : 1);

    // Reiniciar el intervalo si está ejecutándose
    if (this.processor.isRunning()) {
      this.processor.pause();
      this.processor.run();
    }
  }

  openStaticSchedulingDialog() {
    const tab = this.tabs()[this.activeTabIndex()];
    const source = tab.model.getValue();

    const dialogRef = this.dialog.open(StaticSchedulingDialogComponent, {
      width: '70vw',
      maxWidth: '70vw',
      data: { source }
    });

    dialogRef.afterClosed().subscribe(optimizedCode => {
      if (optimizedCode) {
        tab.model.setValue(optimizedCode);
      }
    });
  }

  ngOnDestroy() {
    this.tabs().forEach(tab => tab.model.dispose());
    if (this.editor) this.editor.dispose();
  }

  velocidadHz(): string {
    if (this.currentSpeed() <= 0) return '0 Hz';
    const hz = 1000 / this.currentSpeed();

    // Si es menor a 1000 Hz, muestra Hz; si es mayor, muestra KHz
    return hz >= 1000
      ? `${(hz / 1000).toFixed(2)} kHz`
      : `${hz.toFixed(1)} Hz`;
  }
}
