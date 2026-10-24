import { Component, ElementRef, afterRenderEffect, inject, computed, viewChild } from '@angular/core';
import { MatCard, MatCardContent, MatCardHeader, MatCardTitle } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';

import { TranslocoDirective } from '@jsverse/transloco';
import { AsgConfigService } from '../../core/services/asg.config';
import { exportCronogramaCSV, exportCronogramaPNG } from '../../core/services/utils/asg.exporter';
import { CANVAS_LAYOUT } from '../../core/services/utils/asg.timeline-canvas';
import { AsgProcessorService } from '../../core/services/processor/asg.processor';
import { AsgProcessorFactoryService } from '../../core/services/processor/asg.processor-factory';
import { TimelineEntry } from '../../core/models/asg.models';

const ALLOC_CHUNK = 128;

interface RowView {
  entry: TimelineEntry;
  row: HTMLDivElement;
  label: HTMLDivElement;
  cells: Map<number, HTMLDivElement>;
  flushed: boolean;
}

interface SheetDom {
  sheet: HTMLDivElement;
  instrCol: HTMLDivElement;
  grid: HTMLDivElement;
  head: HTMLDivElement;
  body: HTMLDivElement;
}

@Component({
  selector: 'app-timeline-view',
  imports: [MatCard, MatCardContent, MatCardHeader, MatCardTitle, MatIcon, MatIconButton, MatTooltip, TranslocoDirective],
  templateUrl: './timeline-view.component.html',
  styleUrl: './timeline-view.component.scss'
})
export class TimelineViewComponent {

  private processorFactory = inject(AsgProcessorFactoryService);
  private configService = inject(AsgConfigService);

  private readonly viewportRef = viewChild<ElementRef<HTMLDivElement>>('viewport');
  private readonly probeRef = viewChild<ElementRef<HTMLTableElement>>('probe');
  private readonly sheetRef = viewChild<ElementRef<HTMLDivElement>>('sheet');
  private readonly instrColRef = viewChild<ElementRef<HTMLDivElement>>('instrCol');
  private readonly gridRef = viewChild<ElementRef<HTMLDivElement>>('grid');
  private readonly headRef = viewChild<ElementRef<HTMLDivElement>>('head');
  private readonly bodyRef = viewChild<ElementRef<HTMLDivElement>>('body');

  // El cronograma se pinta de forma incremental fuera del sistema de plantillas: en cada ciclo solo
  // se crean las celdas nuevas y se revisan las filas aún vivas; lo ya pintado no se vuelve a tocar.
  private dom: SheetDom | null = null;
  private rowViews: RowView[] = [];
  private activeRows: RowView[] = [];
  private headCells: HTMLDivElement[] = [];
  // Cabeceras, filas y etiquetas se agrupan en bloques aislados (contain) de ALLOC_CHUNK elementos:
  // añadir uno solo obliga al navegador a recolocar su bloque, no todos los anteriores.
  private headChunks: HTMLDivElement[] = [];
  private rowChunks: HTMLDivElement[] = [];
  private labelChunks: HTMLDivElement[] = [];
  private renderedCycles = 0;
  private cellWidth = 0;
  private rowHeight = 0;
  private headHeight = 0;
  private measured = false;
  // Tamaño reservado (en ciclos/filas) de la rejilla interior; crece por bloques para que el
  // navegador no tenga que recolocar todas las celdas ya pintadas cada vez que avanza un ciclo.
  private allocCycles = 0;
  private allocRows = 0;

  protected get processor(): AsgProcessorService {
    return this.processorFactory.getProcessor();
  }

  protected timelineMode = computed(() => this.configService.getCurrentConfig().timelineMode);

  protected displayTimeline = computed(() => {
    const mode = this.timelineMode();
    const finished = this.processor.finished();

    if (mode === 'disabled') return [];
    if (mode === 'on-finish' && !finished) return [];

    return this.processor.timeline();
  });

  protected displayCycleCount = computed(() => {
    const mode = this.timelineMode();
    const finished = this.processor.finished();

    if (mode === 'disabled') return 0;
    if (mode === 'on-finish' && !finished) return 0;

    return this.processor.cycle();
  });

  protected hasData = computed(() => {
    return this.processor.cycle() > 0;
  });

  protected showLiveOff = computed(() => {
    const mode = this.timelineMode();
    return mode === 'on-finish' && !this.processor.finished() && this.processor.cycle() > 0;
  });

  protected showDisabled = computed(() => {
    const mode = this.timelineMode();
    return mode === 'disabled' && this.processor.cycle() > 0;
  });

  constructor() {
    afterRenderEffect(() => this.renderTimeline());
  }

  protected cellClass(stage: string | undefined): string {
    if (!stage) return 'cell';

    // Fases vectoriales: Init[n], Proc[n], Wait[n], WaitFU, End[n]
    if (stage.startsWith('Init[')) {
      return 'cell EX vector-init';
    }
    if (stage.startsWith('Proc[')) {
      return 'cell EX vector-processing';
    }
    if (stage.startsWith('Wait[')) {
      return 'cell EX vector-wait';
    }
    if (stage === 'WaitFU') {
      return 'cell EX vector-wait-fu';
    }
    if (stage.startsWith('End[')) {
      return 'cell EX vector-end';
    }

    // Latencia inicial: EX[3] o MEM[2]
    if (stage.includes('[')) {
      const name = stage.split('[')[0].trim();
      return `cell ${name} latency`;
    }
    // Procesando elementos: EX(0) o MEM(1) (legacy scalar)
    if (stage.includes('(')) {
      const name = stage.split('(')[0].trim();
      return `cell ${name} vector`;
    }
    return `cell ${stage}`;
  }

  /** Devuelve true si la celda es un ciclo de stall:
   *  - La instrucción en ID permanece bloqueada (RAW hazard).
   *  - La instrucción en IF no puede avanzar porque ID está bloqueado. */
  protected isStallCell(row: Pick<TimelineEntry, 'stages'>, cycle: number): boolean {
    const cur  = row.stages[cycle];
    const prev = row.stages[cycle - 1];
    return (cur === 'ID' || cur === 'IF') && cur === prev;
  }

  protected onExportCSV(): void {
    exportCronogramaCSV(this.processor.timeline(),
      Array.from({ length: this.processor.cycle() }, (_, i) => i + 1));
  }

  protected onExportPNG(): void {
    exportCronogramaPNG(this.processor.timeline(),
      Array.from({ length: this.processor.cycle() }, (_, i) => i + 1));
  }

  /**
   * Al pulsar una instrucción, desplaza el cronograma (horizontal y/o vertical, lo que haga falta) para
   * mostrar su secuencia de etapas: centrada si cabe, o desde su inicio si es más ancha que la vista.
   * Con la ejecución en marcha en modo directo no hace nada, porque manda el auto-scroll.
   */
  protected onInstructionClick(event: MouseEvent): void {
    if (this.processor.isRunning() && this.timelineMode() === 'live') return;

    const label = (event.target as HTMLElement).closest<HTMLElement>('.tl-label');
    const index = Number(label?.dataset['row']);
    const view = this.rowViews[index];
    const vp = this.viewportRef()?.nativeElement;
    const instrCol = this.instrColRef()?.nativeElement;
    if (!view || !vp || !instrCol) return;

    const cycles = Object.keys(view.entry.stages).map(Number).filter(c => c <= this.renderedCycles);
    if (cycles.length === 0) return;

    // Coordenadas dentro de la rejilla de ciclos: lo visible empieza en scrollLeft/scrollTop, a la
    // derecha de la columna de instrucciones y debajo de la cabecera (ambas fijas)
    const visibleWidth = vp.clientWidth - instrCol.offsetWidth;
    const visibleHeight = vp.clientHeight - this.headHeight;
    const start = (Math.min(...cycles) - 1) * this.cellWidth;
    const end = Math.max(...cycles) * this.cellWidth;
    const top = index * this.rowHeight;
    const bottom = top + this.rowHeight;

    let left = vp.scrollLeft;
    if (start < left || end > left + visibleWidth) {
      left = end - start <= visibleWidth
        ? start - (visibleWidth - (end - start)) / 2
        : start - this.cellWidth;
    }
    let scrollTop = vp.scrollTop;
    if (top < scrollTop || bottom > scrollTop + visibleHeight) {
      scrollTop = top - (visibleHeight - this.rowHeight) / 2;
    }

    vp.scrollTo({ left: Math.max(0, left), top: Math.max(0, scrollTop), behavior: 'smooth' });
  }

  private renderTimeline(): void {
    const rows = this.displayTimeline();
    const cycles = this.displayCycleCount();
    const autoScroll = this.timelineMode() === 'live' && !this.processor.finished();
    const dom = this.readDom();

    if (!dom) {
      this.dom = null;
      return;
    }

    // Si la vista estaba oculta al crearse (sin tamaño medible), se rehace en cuanto se pueda medir
    const nowMeasurable = !this.measured && this.probeCellWidth() > 0;
    if (this.dom?.body !== dom.body || nowMeasurable || this.isStale(rows)) {
      this.resetSheet(dom);
    }

    // Las escrituras de los procesadores afectan al ciclo actual o, como mucho, al anterior (flush)
    const windowStart = Math.max(1, this.renderedCycles - 1);

    this.syncCycles(cycles);

    const stillActive: RowView[] = [];
    for (const view of this.activeRows) {
      for (let c = windowStart; c <= cycles; c++) this.paintCell(view, c);
      this.syncFlushed(view);
      if (this.isLive(view)) stillActive.push(view);
    }

    for (let i = this.rowViews.length; i < rows.length; i++) {
      const view = this.createRow(rows[i], i);
      for (const key in view.entry.stages) {
        const c = Number(key);
        if (c <= cycles) this.paintCell(view, c);
      }
      this.rowViews.push(view);
      if (this.isLive(view)) stillActive.push(view);
    }
    this.activeRows = stillActive;

    if (rows.length > this.allocRows) {
      this.allocRows = Math.ceil(rows.length / ALLOC_CHUNK) * ALLOC_CHUNK;
      dom.body.style.height = `${this.allocRows * this.rowHeight}px`;
    }
    dom.grid.style.height = `${this.headHeight + rows.length * this.rowHeight}px`;

    const vp = this.viewportRef()?.nativeElement;
    if (autoScroll && cycles > 0 && vp) {
      vp.scrollLeft = vp.scrollWidth;
      vp.scrollTop = vp.scrollHeight;
    }
  }

  private readDom(): SheetDom | null {
    const sheet = this.sheetRef()?.nativeElement;
    const instrCol = this.instrColRef()?.nativeElement;
    const grid = this.gridRef()?.nativeElement;
    const head = this.headRef()?.nativeElement;
    const body = this.bodyRef()?.nativeElement;
    if (!sheet || !instrCol || !grid || !head || !body) return null;
    return { sheet, instrCol, grid, head, body };
  }

  /** Detecta un reset del procesador (o cambio de procesador): las filas pintadas ya no son las actuales. */
  private isStale(rows: TimelineEntry[]): boolean {
    const n = this.rowViews.length;
    if (rows.length < n) return true;
    return n > 0 && (rows[0] !== this.rowViews[0].entry || rows[n - 1] !== this.rowViews[n - 1].entry);
  }

  private resetSheet(dom: SheetDom): void {
    this.dom = dom;
    this.measure(dom.sheet);

    for (const chunk of this.labelChunks) chunk.remove();
    dom.head.replaceChildren();
    dom.body.replaceChildren();
    this.rowViews = [];
    this.activeRows = [];
    this.headCells = [];
    this.headChunks = [];
    this.rowChunks = [];
    this.labelChunks = [];
    this.renderedCycles = 0;
    this.allocCycles = 0;
    this.allocRows = 0;
    dom.body.style.height = '0px';
  }

  private probeCellWidth(): number {
    return this.probeRef()?.nativeElement.querySelector('td.cell')?.getBoundingClientRect().width ?? 0;
  }

  /** Mide una tabla oculta con los estilos originales para que cada celda tenga el mismo tamaño que tenía en la tabla. */
  private measure(sheet: HTMLDivElement): void {
    const probe = this.probeRef()?.nativeElement;
    const cell = probe?.querySelector<HTMLElement>('td.cell');
    const head = probe?.querySelector<HTMLElement>('th.cycle-head');

    const cellRect = cell?.getBoundingClientRect();
    this.measured = !!cellRect && cellRect.width > 0;

    this.cellWidth = this.measured ? cellRect!.width : CANVAS_LAYOUT.CW;
    this.rowHeight = this.measured ? cellRect!.height : CANVAS_LAYOUT.RH;
    const headHeight = this.headHeight = (this.measured && head?.getBoundingClientRect().height) || CANVAS_LAYOUT.HH;
    const line = (cell && parseFloat(getComputedStyle(cell).borderRightWidth)) || 0.5;

    sheet.style.setProperty('--tl-cw', `${this.cellWidth}px`);
    sheet.style.setProperty('--tl-rh', `${this.rowHeight}px`);
    sheet.style.setProperty('--tl-hh', `${headHeight}px`);
    sheet.style.setProperty('--tl-line', `${line}px`);
  }

  /** Ajusta las columnas de ciclo (cabecera y ancho) al número de ciclos actual. */
  private syncCycles(cycles: number): void {
    const dom = this.dom!;

    while (this.headCells.length < cycles) {
      const c = this.headCells.length + 1;
      const th = document.createElement('div');
      th.className = 'tl-head-cell';
      th.style.left = `${((c - 1) % ALLOC_CHUNK) * this.cellWidth}px`;
      th.textContent = String(c);
      this.chunkFor(this.headChunks, c - 1, dom.head, 'tl-head-chunk', (el, k) => {
        el.style.left = `${k * ALLOC_CHUNK * this.cellWidth}px`;
        el.style.width = `${ALLOC_CHUNK * this.cellWidth}px`;
      }).appendChild(th);
      this.headCells.push(th);
    }
    while (this.headCells.length > cycles) {
      this.headCells.pop()!.remove();
    }

    // Al terminar, el procesador descuenta el ciclo extra: se retiran las celdas que quedaran fuera
    for (let c = cycles + 1; c <= this.renderedCycles; c++) {
      for (const view of this.rowViews) {
        const cell = view.cells.get(c);
        if (cell) {
          cell.remove();
          view.cells.delete(c);
        }
      }
    }

    this.renderedCycles = cycles;
    if (cycles > this.allocCycles) {
      this.allocCycles = Math.ceil(cycles / ALLOC_CHUNK) * ALLOC_CHUNK;
      const width = `${this.allocCycles * this.cellWidth}px`;
      dom.head.style.width = width;
      dom.body.style.width = width;
    }
    dom.grid.style.width = `${cycles * this.cellWidth}px`;
  }

  private createRow(entry: TimelineEntry, index: number): RowView {
    const dom = this.dom!;

    const label = document.createElement('div');
    label.className = 'tl-label';
    label.textContent = entry.raw;
    label.dataset['row'] = String(index);
    this.chunkFor(this.labelChunks, index, dom.instrCol, 'tl-label-chunk').appendChild(label);

    const row = document.createElement('div');
    row.className = 'tl-row';
    row.style.top = `${(index % ALLOC_CHUNK) * this.rowHeight}px`;
    this.chunkFor(this.rowChunks, index, dom.body, 'tl-row-chunk', (el, k) => {
      el.style.top = `${k * ALLOC_CHUNK * this.rowHeight}px`;
      el.style.height = `${ALLOC_CHUNK * this.rowHeight}px`;
    }).appendChild(row);

    const view: RowView = { entry, row, label, cells: new Map(), flushed: false };
    this.syncFlushed(view);
    return view;
  }

  /** Devuelve el bloque de ALLOC_CHUNK elementos al que pertenece `index`, creándolo si aún no existe. */
  private chunkFor(chunks: HTMLDivElement[], index: number, parent: HTMLElement, className: string,
                   place?: (el: HTMLDivElement, k: number) => void): HTMLDivElement {
    const k = Math.floor(index / ALLOC_CHUNK);
    while (chunks.length <= k) {
      const el = document.createElement('div');
      el.className = className;
      place?.(el, chunks.length);
      parent.appendChild(el);
      chunks.push(el);
    }
    return chunks[k];
  }

  /** Una fila completada o descartada ya no recibe más etapas. */
  private isLive(view: RowView): boolean {
    return !view.entry.completed && !view.entry.flushed;
  }

  private syncFlushed(view: RowView): void {
    const flushed = !!view.entry.flushed;
    if (flushed === view.flushed) return;
    view.flushed = flushed;
    view.row.classList.toggle('flushed', flushed);
    view.label.classList.toggle('flushed', flushed);
    view.label.textContent = view.entry.raw + (flushed ? ' [FL]' : '');
  }

  private paintCell(view: RowView, c: number): void {
    const stage = view.entry.stages[c];
    let cell = view.cells.get(c);

    if (!stage) {
      if (cell) {
        cell.remove();
        view.cells.delete(c);
      }
      return;
    }

    const stall = this.isStallCell(view.entry, c);
    const className = `${stall ? 'cell ST' : this.cellClass(stage)} tl-cell`;
    const text = stall ? 'ST' : stage;

    if (!cell) {
      cell = document.createElement('div');
      cell.style.left = `${(c - 1) * this.cellWidth}px`;
      view.row.appendChild(cell);
      view.cells.set(c, cell);
    }
    if (cell.className !== className) cell.className = className;
    if (cell.textContent !== text) cell.textContent = text;
  }
}
