import { CANVAS_LAYOUT, CANVAS_COLORS, stageClr } from './asg.timeline-canvas';

const { SCALE, IW, CW, RH, HH } = CANVAS_LAYOUT;
const { HEAD_BG, HEAD_FG, HEAD_SEP, INSTR_BG_E, INSTR_BG_O, INSTR_FG, INSTR_SEP, CELL_SEP, EMPTY_BG } = CANVAS_COLORS;

const TITLE_H  = 52;
const LEGEND_H = 70;

function hline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, color: string, lw = 0.5): void {
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x, y - 0.5); ctx.lineTo(x + w, y - 0.5); ctx.stroke();
}
function vline(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string, lw = 0.5): void {
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x - 0.5, y); ctx.lineTo(x - 0.5, y + h); ctx.stroke();
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

export function exportCronogramaPNG(timeline: any[], cycles: number[]): void {
  const tableW = IW + CW * cycles.length;
  const tableH = HH + RH * timeline.length;
  const totalW = tableW;
  const totalH = TITLE_H + tableH + LEGEND_H;

  const canvas  = document.createElement('canvas');
  canvas.width  = totalW * SCALE;
  canvas.height = totalH * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalW, totalH);

  //Barra de título
  // Gradiente horizontal oscuro
  const grad = ctx.createLinearGradient(0, 0, totalW, 0);
  grad.addColorStop(0,   '#0f172a');
  grad.addColorStop(1,   '#1e3a5f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, totalW, TITLE_H);

  // Línea de acento inferior
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(0, TITLE_H - 3, totalW, 3);

  ctx.fillStyle = '#f8fafc';
  ctx.font = `bold 15px "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Super Asgard-V Simulator — Pipeline Timeline', 18, TITLE_H / 2 + 2);

  ctx.font = `12px "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(`${timeline.length} instrucciones  ·  ${cycles.length} ciclos`, 18, TITLE_H / 2 + 18);

  //Tabla
  const OY = TITLE_H;

  // Cabecera de instrucción
  ctx.fillStyle = HEAD_BG;
  ctx.fillRect(0, OY, IW, HH);
  ctx.fillStyle = HEAD_FG;
  ctx.font = `bold 12px "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('INSTRUCCIÓN', 10, OY + HH / 2);
  hline(ctx, 0, OY + HH, IW, HEAD_SEP, 1);
  vline(ctx, IW, OY, HH, INSTR_SEP, 1.5);

  // Cabeceras de ciclo
  ctx.font = `bold 11px "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  cycles.forEach((c, ci) => {
    const x = IW + ci * CW;
    ctx.fillStyle = HEAD_BG;
    ctx.fillRect(x, OY, CW, HH);
    ctx.fillStyle = HEAD_FG;
    ctx.fillText(String(c), x + CW / 2, OY + HH / 2);
    hline(ctx, x, OY + HH, CW, HEAD_SEP, 1);
    vline(ctx, x + CW, OY, HH, HEAD_SEP, 0.5);
  });

  // Filas
  timeline.forEach((row, ri) => {
    const y = OY + HH + ri * RH;
    const isFlushed = !!row.flushed;

    // Instrucciones vaciadas: 50% opacidad en toda la fila (igual que CSS opacity:0.5)
    if (isFlushed) ctx.globalAlpha = 0.5;

    // Celda instrucción
    ctx.fillStyle = ri % 2 === 0 ? INSTR_BG_E : INSTR_BG_O;
    ctx.fillRect(0, y, IW, RH);
    ctx.save();
    ctx.beginPath(); ctx.rect(8, y + 3, IW - 16, RH - 6); ctx.clip();
    const instrText = isFlushed ? `${row.raw} [FL]` : row.raw;
    ctx.fillStyle = isFlushed ? '#dc2626' : INSTR_FG;
    ctx.font = isFlushed
      ? `italic 11px "Consolas", "Monaco", monospace`
      : `11px "Consolas", "Monaco", monospace`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(instrText, 8, y + RH / 2);
    // Línea tachada manual (canvas no tiene strikethrough nativo)
    if (isFlushed) {
      const textW = Math.min(ctx.measureText(instrText).width, IW - 16);
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(8, y + RH / 2);
      ctx.lineTo(8 + textW, y + RH / 2);
      ctx.stroke();
    }
    ctx.restore();
    hline(ctx, 0, y + RH, IW, CELL_SEP);
    vline(ctx, IW, y, RH, INSTR_SEP, 1.5);

    // Celdas de etapa
    cycles.forEach((c, ci) => {
      const x = IW + ci * CW;
      const stage = (row.stages[c] as string) ?? '';
      const { bg, fg } = stageClr(stage);
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, CW, RH);
      if (stage && fg) {
        // Badge redondeado
        const px = 4, py = 4;
        const badgeX = x + px;
        const badgeY = y + py;
        const badgeW = CW - px * 2;
        const badgeH = RH - py * 2;
        roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 4);
        ctx.fillStyle = bg === EMPTY_BG ? '#e2e8f0' : bg;
        ctx.fill();
        ctx.strokeStyle = fg + '33'; ctx.lineWidth = 0.5; ctx.stroke();
        ctx.fillStyle = fg;
        ctx.font = `bold 10px "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(stage.split('(')[0].trim(), x + CW / 2, y + RH / 2);

        // Línea tachada para instrucciones flushed
        if (isFlushed) {
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(badgeX, y + RH / 2);
          ctx.lineTo(badgeX + badgeW, y + RH / 2);
          ctx.stroke();
        }
      }
      hline(ctx, x, y + RH, CW, CELL_SEP);
      vline(ctx, x + CW, y, RH, CELL_SEP);
    });

    // Restaurar opacidad para la siguiente fila
    if (isFlushed) ctx.globalAlpha = 1.0;
  });

  //Leyenda
  const LY = OY + tableH;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, LY, totalW, LEGEND_H);
  hline(ctx, 0, LY, totalW, '#e2e8f0', 1);

  const LEGEND_STAGES: Array<{ key: string; label: string; bg: string; fg: string }> = [
    // Etapas pipeline escalar
    { key: 'IF',      label: 'IF',            bg: CANVAS_COLORS.IF.bg,      fg: CANVAS_COLORS.IF.fg      },
    { key: 'ID',      label: 'ID',            bg: CANVAS_COLORS.ID.bg,      fg: CANVAS_COLORS.ID.fg      },
    { key: 'EX',      label: 'EX',            bg: CANVAS_COLORS.EX.bg,      fg: CANVAS_COLORS.EX.fg      },
    { key: 'MEM',     label: 'MEM',           bg: CANVAS_COLORS.MEM.bg,     fg: CANVAS_COLORS.MEM.fg     },
    { key: 'WB',      label: 'WB',            bg: CANVAS_COLORS.WB.bg,      fg: CANVAS_COLORS.WB.fg      },
    // Etapas pipeline superescalar
    { key: 'II',      label: 'II',            bg: CANVAS_COLORS.II.bg,      fg: CANVAS_COLORS.II.fg      },
    { key: 'II-D',    label: 'II-D',          bg: CANVAS_COLORS['II-D'].bg, fg: CANVAS_COLORS['II-D'].fg },
    { key: 'II-S',    label: 'II-S',          bg: CANVAS_COLORS['II-S'].bg, fg: CANVAS_COLORS['II-S'].fg },
    { key: 'II-E',    label: 'II-E',          bg: CANVAS_COLORS['II-E'].bg, fg: CANVAS_COLORS['II-E'].fg },
    { key: 'WR',      label: 'WR',            bg: CANVAS_COLORS.WR.bg,      fg: CANVAS_COLORS.WR.fg      },
    { key: 'RI',      label: 'RI',            bg: CANVAS_COLORS.RI.bg,      fg: CANVAS_COLORS.RI.fg      },
    { key: 'FL',      label: 'FL',            bg: CANVAS_COLORS.FL.bg,      fg: CANVAS_COLORS.FL.fg      },
    // Variantes vectoriales
    { key: 'EXv',     label: 'EX (vector)',   bg: CANVAS_COLORS.EX_V.bg,    fg: CANVAS_COLORS.EX_V.fg    },
    { key: 'MEMv',    label: 'MEM (vector)',  bg: CANVAS_COLORS.MEM_V.bg,   fg: CANVAS_COLORS.MEM_V.fg   },
    // Estados con latencia/procesamiento (ejemplos - N varía)
    { key: 'EX(N)',   label: 'EX(N)',         bg: CANVAS_COLORS.EX.bg,      fg: CANVAS_COLORS.EX.fg      },
    { key: 'EX[N]',   label: 'EX[N]',         bg: CANVAS_COLORS.EX_V.bg,    fg: CANVAS_COLORS.EX_V.fg    },
    { key: 'Init[N]', label: 'Init[N]',       bg: CANVAS_COLORS.EX_V.bg,    fg: CANVAS_COLORS.EX_V.fg    },
    { key: 'Proc[N]', label: 'Proc[N]',       bg: CANVAS_COLORS.EX_V.bg,      fg: CANVAS_COLORS.EX_V.fg      },
    { key: 'Wait[N]', label: 'Wait[N]',       bg: CANVAS_COLORS['II-S'].bg,  fg: CANVAS_COLORS['II-S'].fg  },
    { key: 'WaitFU',  label: 'WaitFU',        bg: CANVAS_COLORS['II-S'].bg,  fg: CANVAS_COLORS['II-S'].fg  },
    { key: 'End[N]',  label: 'End[N]',        bg: CANVAS_COLORS.MEM_V.bg,     fg: CANVAS_COLORS.MEM_V.fg     },
  ];

  const SW = 14;
  const LEGEND_SPACING = 14;
  const ROW_HEIGHT = 24;
  let lx = 16;
  let ly = LY + 16;
  let currentRow = 0;
  const maxWidth = totalW - 32;

  ctx.font = `11px "Segoe UI", Roboto, sans-serif`;

  LEGEND_STAGES.forEach(({ label, bg, fg }, idx) => {
    const labelWidth = ctx.measureText(label).width;
    const itemWidth = SW + 5 + labelWidth + LEGEND_SPACING;

    // Si excede el ancho, pasar a la siguiente fila
    if (lx + itemWidth > maxWidth && lx > 16) {
      currentRow++;
      lx = 16;
      ly = LY + 16 + currentRow * ROW_HEIGHT;
    }

    roundRect(ctx, lx, ly - SW / 2, SW, SW, 3);
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 0.5; ctx.stroke();
    ctx.fillStyle = '#374151';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, lx + SW + 5, ly);
    lx += itemWidth;
  });

  //Descarga
  const link = document.createElement('a');
  link.download = `cronograma-superasgardv-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export function exportCronogramaCSV(timeline: any[], cycles: number[]): void {
  const header = ['INSTRUCCIÓN', ...cycles].join(';');
  const rows = timeline.map(row => {
    const instrLabel = row.flushed ? `${row.raw} [FL]` : row.raw;
    const cells = [
      `"${instrLabel}"`,
      ...cycles.map(c => `"${row.stages[c] ?? ''}"`)
    ];
    return cells.join(';');
  });

  const csv  = [header, ...rows].join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = `cronograma-superasgardv-${Date.now()}.csv`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}
