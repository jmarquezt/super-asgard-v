# Super Asgard-V

**Un simulador moderno para aprender arquitectura de computadores, directamente en el navegador.**

Super Asgard-V te permite escribir código ensamblador ASG, ejecutarlo ciclo a ciclo y ver qué ocurre dentro del procesador: cómo avanzan las instrucciones por el pipeline, dónde aparecen los riesgos, cuándo actúa el forwarding, cómo acierta (o falla) el predictor de saltos o cómo se maneja una excepción. Está pensado para estudiantes y docentes de asignaturas de arquitectura e ingeniería de computadores.

---

## ✨ Características

### Tres modelos de procesador

| Modelo | Descripción |
| --- | --- |
| **No segmentado** | Cada instrucción completa todas sus fases antes de empezar la siguiente. Sirve como referencia para comparar. |
| **Segmentado** (por defecto) | Pipeline clásico de 5 etapas: **IF → ID → EX → MEM → WB**. |
| **Superescalar** | Ejecución fuera de orden estilo Tomasulo, con estaciones de reserva, Reorder Buffer (ROB), renombrado de registros y Common Data Bus (CDB). Dispone de 6 etapas: **IF → ID → II → EX → WB → RI**. |

### Pipeline y riesgos
- Detección de riesgos **RAW**, **WAW**, **WAR** y **estructurales**.
- **Forwarding** activable o desactivable, para ver su efecto sobre las detenciones.
- **Branch delay slot** opcional.
- Latencias configurables para cada unidad funcional: multiplicación y división entera, punto flotante simple y doble, y operaciones vectoriales (memoria, suma, multiplicación, división y comparación).

### Predicción de saltos
Varias estrategias para comparar:
`none` · `always-taken` · `BTFN` · `1-bit` · `2-bit` · `gshare` · `hybrid` (tournament) · `RAS`

En `gshare` y `hybrid` puedes elegir el número de bits del historial global (GHR).

### Procesador vectorial
- 8 registros vectoriales con longitud máxima de vector (MVL) configurable.
- **Encadenamiento (chaining)** de operaciones vectoriales configurable.
- Número configurable de carriles de ALU y de memoria.
- Accesos con stride (`LVWS`/`SVWS`) e indexados (`LVI`/`SVI`).
- Comparaciones vectoriales en sus formas vector-vector, escalar-vector y vector-escalar.

### Excepciones e interrupciones
- **Tabla de vectores** en `0x00–0x5F` con 24 entradas y un manejador por defecto en `0x60`. El código del usuario empieza en `0x64`.
- Detección de desbordamiento aritmético, división por cero, excepciones IEEE 754 (overflow, underflow, operación inválida), accesos a memoria desalineados o fuera de rango, e instrucciones ilegales.
- Puedes escribir **tus propios manejadores** definiendo etiquetas como `__divzero_handler`, `__mem_align_handler` o `__trap_write_handler`. Si no defines ninguno, se usa el manejador por defecto, que detiene la ejecución.

### Modo superescalar
- Ancho de emisión de 1, 2, 4 u 8 instrucciones simultáneas por ciclo.
- Estaciones de reserva **centralizadas**, **distribuidas** o **en clústeres**.
- Tamaño del ROB, unidades funcionales (escalares y vectoriales) y ancho del CDB configurables.
- Presets `minimal`, `balanced` y `aggressive` para una configuración rápida.
- Vistas dedicadas del ROB, las estaciones de reserva y el CDB.

### Planificación estática
Un optimizador que reescribe tu código aplicando:
- Reordenación de instrucciones (scheduling).
- Desenrollado de bucles con factor configurable.
- Renombrado de registros.
- Relleno de delay slots.

El resultado indica qué líneas se reordenaron y cuáles se añadieron, para compararlo con el original.

### Interfaz
- **Editor Monaco** (el de VS Code) con resaltado de sintaxis ASG.
- **Cronograma** interactivo del pipeline, en vivo o al terminar la ejecución, exportable a **PNG** y **CSV**.
- Vistas de **registros** (enteros, flotantes y vectoriales), **memoria**, **eventos** y **estadísticas** (CPI, detenciones...)
- **Consola** para la E/S de los `TRAP`.
- Documentación integrada del ISA en `/docs`.
- **Versión para móvil** con controles de ejecución adaptados.
- Tema claro y oscuro.
- Interfaz en **español** e **inglés**.
- La configuración se guarda automáticamente en el navegador.

---

## 🧩 Juego de instrucciones

Basado en DLX:

| Categoría | Instrucciones |
| --- | --- |
| Aritmética entera | `ADD`, `SUB`, `MULT`, `DIV` (y sus variantes inmediatas y sin signo), desplazamientos, operaciones lógicas |
| Comparaciones | `SEQ`, `SNE`, `SLT`, `SGT`, `SLE`, `SGE` y variantes sin signo |
| Memoria | `LB`, `LH`, `LW`, `SB`, `SH`, `SW`, `LF`, `LD`, `SF`, `SD` |
| Saltos | `BEQZ`, `BNEZ`, `BGTZ`, `BLTZ`, `J`, `JAL`, `JR`, `JALR` |
| Punto flotante | `ADDF`, `SUBF`, `MULTF`, `DIVF` y las variantes de doble precisión (`ADDD`, `SUBD`, `MULTD`, `DIVD`) |
| Vectoriales | `LV`, `SV`, `LVWS`, `SVWS`, `LVI`, `SVI`, `ADDV`, `SUBV`, `MULTV`, `DIVV`, `SEQV`, `SLTV`… y las variantes vector-escalar |
| Conversiones | `CVTI2F`, `CVTF2I`, `CVTF2D`, … |
| Llamadas al sistema | `TRAP 0` (exit), `TRAP 3` (read), `TRAP 4` (write), `TRAP 5` (printf), `TRAP 6` (parada inmediata) |

**Directivas del ensamblador:** `.text` (obligatoria), `.data`, `.align`, `.byte`, `.word`, `.float`, `.double`, `.ascii`, `.asciiz`, `.space`, `.global`

El ensamblador admite **varios módulos**: las etiquetas son locales a cada módulo salvo que se exporten con `.global`.

---

## 🚀 Puesta en marcha

### Requisitos
- [Node.js](https://nodejs.org/) (versión compatible con Angular 21)
- npm

### Instalación

```bash
git clone <url-del-repositorio>
cd super-asgard-v
npm ci
```

### Comandos

```bash
npm start      # Servidor de desarrollo en http://localhost:4200/
npm run build  # Compilación de producción en dist/
npm test       # Tests unitarios con Vitest
```

---

## 🏗️ Arquitectura

```
src/app/
├── core/
│   ├── models/
│   │   ├── instructions/   # Una clase por tipo de instrucción (R, I, J, M, B, V, C)
│   │   ├── superscalar/    # ROB, estaciones de reserva, CDB, unidades funcionales
│   │   ├── asg.map.ts      # Tabla de opcodes: ISA → tipo, latencia, unidad
│   │   ├── asg.config.ts   # Tipos y valores por defecto de la configuración
│   │   └── asg.exceptions.ts  # Códigos de excepción y tabla de vectores
│   └── services/
│       ├── assembly/       # Lexer, analizador semántico, ensamblador y planificador estático
│       ├── processor/      # Procesadores no segmentado, segmentado y superescalar
│       ├── utils/          # Exportación del cronograma (PNG / CSV)
│       └── asg.bp.ts       # Predictores de salto
├── features/               # Simulador (escritorio y móvil), documentación, 404
├── layout/                 # Estructura de página, ajustes y pantalla de carga
└── shared/                 # Componentes de visualización (pipeline, cronograma, registros, memoria…)
```

**Tecnologías:** Angular 21 (componentes standalone y signals) · Angular Material · Monaco Editor · Transloco · Vitest

---

## 📚 Referencias

Todos los modelos de procesadores implementados siguen la descripción del libro *Ingeniería de Computadores II* (UNED). El juego de instrucciones se basa en la arquitectura DLX de Hennessy y Patterson.
