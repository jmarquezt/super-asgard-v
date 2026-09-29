/** Layout compartido entre el canvas en vivo y el export PNG */
export const CANVAS_LAYOUT = {
  SCALE: 2,
  IW:    220,  // ancho columna instrucción (px lógicos)
  CW:    44,   // ancho columna ciclo
  RH:    28,   // alto fila
  HH:    34,   // alto cabecera
} as const;

/** Paleta de colores compartida */
export const CANVAS_COLORS = {
  // Etapas pipeline escalar (fondo suave, texto oscuro saturado)
  IF:  { bg: '#dbeafe', fg: '#1e40af' },
  ID:  { bg: '#fef9c3', fg: '#92400e' },
  EX:  { bg: '#dcfce7', fg: '#166534' },
  MEM: { bg: '#fef3c7', fg: '#b45309' },
  WB:  { bg: '#fee2e2', fg: '#991b1b' },
  // Etapas pipeline superescalar (Tomasulo)
  II:    { bg: '#e0e7ff', fg: '#3730a3' },  // Issue - indigo
  'II-D': { bg: '#e0e7ff', fg: '#3730a3' },  // Issue Dispatch
  'II-S': { bg: '#c7d2fe', fg: '#3730a3' },  // Issue Supervisión
  'II-E': { bg: '#a5b4fc', fg: '#1e1b4b' },  // Issue Emit
  WR:    { bg: '#fce7f3', fg: '#9d174d' },  // Write Result - pink
  RI:    { bg: '#d1fae5', fg: '#065f46' },  // Retire - emerald
  FL:    { bg: '#fecaca', fg: '#991b1b' },  // Flush - red
  // Variantes vector (fondo vívido, texto blanco)
  EX_V:  { bg: '#16a34a', fg: '#ffffff' },
  MEM_V: { bg: '#d97706', fg: '#ffffff' },
  // Elementos estructurales
  EMPTY_BG:  '#f8fafc',
  HEAD_BG:   '#1e293b',
  HEAD_FG:   '#f8fafc',
  HEAD_SEP:  '#334155',
  INSTR_BG_E:'#f1f5f9',  // filas pares
  INSTR_BG_O:'#e8eef4',  // filas impares
  INSTR_FG:  '#0f172a',
  INSTR_SEP: '#94a3b8',  // borde derecho columna instrucción
  CELL_SEP:  '#e2e8f0',  // bordes celdas ciclo
} as const;

export function stageClr(stage: string): { bg: string; fg: string } {
  if (!stage) return { bg: CANVAS_COLORS.EMPTY_BG, fg: '' };
  const name = stage.split('(')[0].trim();
  const vec  = stage.includes('(');
  if (vec && name === 'EX')  return CANVAS_COLORS.EX_V;
  if (vec && name === 'MEM') return CANVAS_COLORS.MEM_V;
  const key = name as keyof typeof CANVAS_COLORS;
  const c = CANVAS_COLORS[key] as { bg: string; fg: string } | undefined;
  return c ?? { bg: CANVAS_COLORS.EMPTY_BG, fg: '#64748b' };
}
