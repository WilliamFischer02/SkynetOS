import { describe, expect, it } from 'vitest';
import { composeSnapshot, type GpuReading, type HardwareSnapshot, type Sensors } from '../packages/shared/hardware.js';
import { layoutMonitorWidget, shortMHz, widgetData, type WidgetOp } from '../src/renderer/board/monitor-widget.js';

/**
 * The monitor widget's layout. William: "I want the actual node to be a monitor / show live update
 * data like a widget."
 *
 * What is pinned: what each footprint shows, that nothing is drawn outside the face or off the
 * pixel grid, and that an unreadable value is a dash and never a number.
 */

/** Departure Mono at 11px advances six pixels a character. */
const measure = (text: string): number => text.length * 6;

const gpu = (over: Partial<GpuReading> = {}): GpuReading => ({
  name: 'NVIDIA GeForce RTX 5070', driver: '616.64', tempC: 52, slowdownMarginC: 33, usage: 78,
  memoryControllerUsage: 20, clockMHz: 2805, maxClockMHz: 3090, memoryClockMHz: 14001, fanPct: 0,
  vramUsedMiB: 3800, vramTotalMiB: 12227, powerW: 27.7, powerLimitW: 250, pstate: 'P0', resolution: null,
  source: 'nvidia-smi', ...over
});

const sensors = (over: Partial<Sensors> = {}): Sensors => ({
  total: { perfPct: 131, baseMHz: 3500 },
  threads: [],
  temperatures: [{ part: 'board', label: 'ACPI \\_TZ.TZ00', celsius: 27.9, source: 'ACPI' }],
  fans: [],
  diskActivity: [],
  volumes: [],
  lhmAvailable: false,
  ...over
});

const snapshot = (over: { gpus?: GpuReading[]; sensors?: Sensors; threads?: (number | null)[] } = {}): HardwareSnapshot =>
  composeSnapshot({
    now: 1_000_000,
    inventory: null, inventoryAt: null, inventoryError: null,
    sensors: over.sensors ?? sensors(), sensorsAt: 1_000_000, sensorsError: null,
    gpus: over.gpus ?? [gpu()], gpuAt: 1_000_000, gpuError: null, nvidiaAbsent: false,
    threadUsage: over.threads ?? Array.from({ length: 20 }, (_, i) => (i * 5) % 100),
    memory: { totalBytes: 64 * 2 ** 30, freeBytes: 25 * 2 ** 30 }
  });

const texts = (ops: WidgetOp[]): string[] => ops.flatMap((op) => (op.t === 'text' ? [op.text] : []));
const labels = ['CPU', 'GPU', 'RAM', 'GFX', 'VRAM', 'CLK', 'DIE', 'BRD', 'GCK', 'PWR'];
const valueOps = (ops: WidgetOp[]) => ops.filter((op): op is Extract<WidgetOp, { t: 'text' }> => op.t === 'text' && !labels.includes(op.text));

function inBounds(ops: WidgetOp[], w: number, h: number): boolean {
  return ops.every((op) => {
    const width = op.t === 'rect' ? op.w : measure(op.text);
    const height = op.t === 'rect' ? op.h : 11;
    return [op.x, op.y, width, height].every(Number.isInteger) &&
      op.x >= 0 && op.y >= 0 && op.x + width <= w && op.y + height <= h;
  });
}

describe('what each footprint shows', () => {
  it('fits CPU, GPU and RAM on a 4x4 node, in that order, and stops there', () => {
    const ops = layoutMonitorWidget(64, 64, widgetData(snapshot()), measure);
    const shown = texts(ops).filter((t) => labels.includes(t));
    expect(shown).toEqual(['CPU', 'GPU', 'RAM']);
    expect(inBounds(ops, 64, 64)).toBe(true);
  });

  it('adds the GPU load, VRAM, a column per thread and the clock lines on a 6x10 node', () => {
    const ops = layoutMonitorWidget(96, 160, widgetData(snapshot()), measure);
    const shown = texts(ops);
    for (const label of ['CPU', 'GPU', 'RAM', 'GFX', 'VRAM', 'CLK']) expect(shown).toContain(label);
    // 131% of a 3500 MHz base is 4585 MHz.
    expect(shown.some((t) => /^4\.5[89]G$/.test(t))).toBe(true);
    // One column per thread: twenty thread bars below the rows.
    expect(ops.filter((op) => op.t === 'rect' && op.w === 3).length).toBeGreaterThanOrEqual(20);
    expect(inBounds(ops, 96, 160)).toBe(true);
  });

  it('draws nothing but the screen on a node too small to hold a line', () => {
    expect(layoutMonitorWidget(16, 16, widgetData(snapshot()), measure)).toEqual([
      { t: 'rect', x: 0, y: 0, w: 16, h: 16, color: 'screen' }
    ]);
  });

  it('stays on the grid and inside the face at every size a monitor can be', () => {
    for (let w = 1; w <= 12; w++) {
      for (let h = 1; h <= 12; h++) {
        expect(inBounds(layoutMonitorWidget(w * 16, h * 16, widgetData(snapshot()), measure), w * 16, h * 16), `${w}x${h}`).toBe(true);
      }
    }
  });
});

describe('honesty', () => {
  it('prints a dash for every value before anything has been read', () => {
    const values = valueOps(layoutMonitorWidget(96, 160, widgetData(null), measure));
    expect(values.length).toBeGreaterThan(0);
    for (const op of values) {
      expect(op.text).toBe('-');
      expect(op.color).toBe('dim');
    }
  });

  it('shows the CPU die as a dash when only the motherboard zone is readable', () => {
    // The ACPI zone is 27.9 °C. Printing it as the CPU temperature would be the lie.
    const data = widgetData(snapshot());
    expect(data.lines.find((l) => l.label === 'DIE')?.text).toBe('-');
    expect(data.lines.find((l) => l.label === 'BRD')?.text).toBe('28°');
  });

  it('shows the hottest real CPU sensor when LibreHardwareMonitor provides one', () => {
    const withLhm = sensors({
      lhmAvailable: true,
      temperatures: [
        { part: 'cpu', label: 'CPU Core #1', celsius: 61, source: 'LibreHardwareMonitor' },
        { part: 'cpu', label: 'CPU Package', celsius: 84, source: 'LibreHardwareMonitor' }
      ]
    });
    const die = widgetData(snapshot({ sensors: withLhm })).lines.find((l) => l.label === 'DIE');
    expect(die).toEqual({ label: 'DIE', text: '84°', level: 'warn' });
  });

  it('marks a GPU that nvidia-smi could not read as unreadable, not as zero', () => {
    const blind = gpu({ tempC: null, usage: null, vramUsedMiB: null, source: 'wmi' });
    const rows = widgetData(snapshot({ gpus: [blind] })).rows;
    expect(rows.find((r) => r.label === 'GPU')).toMatchObject({ value: null, text: '-' });
    expect(rows.find((r) => r.label === 'GFX')).toMatchObject({ value: null, text: '-' });
  });
});

describe('levels come from the shared thresholds', () => {
  it('judges the GPU against the card\'s own slowdown margin', () => {
    // 70 °C with 15 °C left: slowdown at 85, so 65 is working hard and 75 is the edge.
    const row = widgetData(snapshot({ gpus: [gpu({ tempC: 70, slowdownMarginC: 15 })] })).rows.find((r) => r.label === 'GPU');
    const op = valueOps(layoutMonitorWidget(64, 64, widgetData(snapshot({ gpus: [gpu({ tempC: 70, slowdownMarginC: 15 })] })), measure))
      .find((o) => o.text === '70°');
    expect(row?.max).toBe(85);
    expect(op?.color).toBe('warn');
  });

  it('lights a saturated CPU into the fault cells and leaves one-pixel ticks where it is not lit', () => {
    const busy = snapshot({ threads: Array.from({ length: 20 }, () => 96) });
    const ops = layoutMonitorWidget(64, 64, widgetData(busy), measure);
    const cpuBar = ops.filter((op) => op.t === 'rect' && op.color !== 'screen' && op.y >= 3 + 11 && op.y < 3 + 11 + 3);
    expect(cpuBar.some((op) => op.t === 'rect' && op.color === 'fault' && op.h === 2)).toBe(true);
    expect(cpuBar.filter((op) => op.t === 'rect' && op.h === 1).length).toBeGreaterThan(0);
  });
});

describe('shortMHz', () => {
  it('fits a clock in five characters', () => {
    expect(shortMHz(4592)).toBe('4.59G');
    expect(shortMHz(800)).toBe('800M');
    expect(shortMHz(null)).toBe('-');
  });
});
