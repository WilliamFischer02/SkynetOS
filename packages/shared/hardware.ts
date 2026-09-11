/**
 * The system monitor: what this machine is, what it is doing, and what it will not tell us.
 *
 * William: "I want the activity / psu monitor to actually show representation of comprehensive
 * data of the device cpu; to read the hardware of the device and maybe even temperatures / usage
 * in each alley - speccy is an excellent example … a simplified temp bar that gradients color based
 * on expected vs actual temp values … this is a literal system monitor".
 *
 * ── What is read, and from where ──────────────────────────────────────────────────────────────
 *
 * All of it non-elevated, and all of it real:
 *
 *   - Per-thread load: Node's `os.cpus()` tick counters, differenced between two samples.
 *   - Effective clock: the `% Processor Performance` counter (Win32_PerfFormattedData_Counters_
 *     ProcessorInformation) times the base frequency. It is how Task Manager's "Speed" is derived,
 *     and it is why a 3.5 GHz part can read 4.9 GHz.
 *   - Inventory: CIM (Win32_Processor, Win32_PhysicalMemory, Win32_BaseBoard, Win32_BIOS,
 *     Win32_VideoController, MSFT_PhysicalDisk), read once.
 *   - GPU: `nvidia-smi`, which ships with the NVIDIA driver. Temperature, load, clocks, VRAM,
 *     power, fan, and the driver's own margin to its slowdown temperature.
 *   - Drive activity and free space: PerfDisk counters and Win32_LogicalDisk.
 *   - ACPI thermal zones: readable, but they are motherboard sensors, not the CPU die, and the UI
 *     says so next to the number.
 *   - CPU die temperatures, fan speeds, drive temperatures: from LibreHardwareMonitor's WMI
 *     namespace WHEN it is running. Windows does not give a non-elevated process any of them.
 *
 * ── What is not read, and is therefore not shown ──────────────────────────────────────────────
 *
 * Prime directive 1. A source that is absent produces a `Missing` entry that says what it is, why
 * it cannot be read, and what would provide it. It never produces a plausible number. A CPU
 * temperature invented from the ACPI zone would be the single most misleading thing on the board.
 *
 * Pure: types, parsing, levels, formatting. The reading is src/main/services/hardware.ts, the
 * drawing is src/renderer/ui/SystemMonitor.tsx, and test/hardware.test.ts holds the arithmetic.
 */

/* ────────────────────────────── levels: expected vs actual ────────────────────────────── */

export type Level = 'ok' | 'warn' | 'fault';

/**
 * Where "expected" ends. A reading below `warn` is what the part is built to do all day; from
 * `warn` it is working hard; from `fault` it is at the edge of what it can sustain.
 *
 * These are declared expectations, and each carries the sentence that says so. The UI shows the
 * sentence as the bar's tooltip, so a coloured cell is never an unexplained verdict.
 */
export interface Band {
  warn: number;
  fault: number;
  note: string;
}

export const BANDS = {
  load: { warn: 70, fault: 90, note: 'Load: above 70% the part is busy; above 90% it is saturated.' },
  memory: { warn: 80, fault: 92, note: 'Memory: above 80% in use Windows starts paging; above 92% it thrashes.' },
  volume: { warn: 85, fault: 95, note: 'Volume: past 85% full it slows down; past 95% it is about to run out.' },
  diskBusy: { warn: 60, fault: 90, note: 'Drive: percent of the last interval the drive was busy.' },
  power: { warn: 80, fault: 95, note: 'Power: percent of the board power limit the driver enforces.' },
  vram: { warn: 85, fault: 95, note: 'VRAM: past 85% a game or model starts spilling into system memory.' },
  cpuTemp: {
    warn: 80,
    fault: 95,
    note: 'CPU die: current Intel and AMD desktop parts throttle at about 100 °C (their TjMax), so 80 °C is working hard and 95 °C is at the limit.'
  },
  gpuTempFallback: {
    warn: 75,
    fault: 85,
    note: 'GPU: a rule of thumb, used only when the driver does not report its own slowdown margin.'
  },
  boardTemp: {
    warn: 60,
    fault: 80,
    note: 'Motherboard or drive sensor: above 60 °C airflow is poor; above 80 °C something is wrong.'
  }
} as const satisfies Record<string, Band>;

export function levelFor(value: number, band: Pick<Band, 'warn' | 'fault'>): Level {
  if (value >= band.fault) return 'fault';
  if (value >= band.warn) return 'warn';
  return 'ok';
}

/**
 * A GPU temperature judged against the card's OWN limit.
 *
 * `nvidia-smi` reports `temperature.gpu.tlimit`: how many degrees are left before the driver starts
 * slowing the card down. That is the real expectation for this particular card, so it beats any
 * rule of thumb. Twenty degrees of margin is comfortable, ten is working hard, less is the edge.
 */
export function gpuTempBand(tempC: number, marginC: number | null): Band & { max: number } {
  if (marginC === null || !Number.isFinite(marginC)) {
    return { ...BANDS.gpuTempFallback, max: 100 };
  }
  const slowdown = tempC + marginC;
  return {
    warn: slowdown - 20,
    fault: slowdown - 10,
    max: slowdown,
    note: `GPU: the driver starts slowing this card at ${Math.round(slowdown)} °C, ${Math.round(marginC)} °C above now. Under 20 °C of margin is working hard; under 10 °C is the edge.`
  };
}

export interface RampCell {
  lit: boolean;
  level: Level;
}

/**
 * A segmented bar: the "gradient" William asked for, made of whole cells.
 *
 * docs/02 forbids smooth gradients and partial alpha. So each cell is one flat palette colour,
 * chosen by the band ITS position on the scale falls in, not by the current value. An empty bar
 * therefore still shows where ok ends and warn begins (the cells' outlines carry the colour), and
 * a filling bar steps through ok cells, then warn cells, then fault cells: expected and actual on
 * one line.
 */
export function rampCells(value: number, max: number, band: Pick<Band, 'warn' | 'fault'>, cells = 16): RampCell[] {
  const fraction = max > 0 && Number.isFinite(value) ? Math.min(1, Math.max(0, value / max)) : 0;
  const lit = Math.round(fraction * cells);
  return Array.from({ length: cells }, (_, i) => ({
    lit: i < lit,
    level: levelFor(((i + 0.5) / cells) * max, band)
  }));
}

/* ─────────────────────────────────── the snapshot ─────────────────────────────────── */

/** Something that could not be read, why not, and what would provide it. */
export interface Missing {
  what: string;
  why: string;
  fix: string;
}

export interface ThreadReading {
  /** Logical processor index, as os.cpus() and Task Manager number them. */
  index: number;
  /** Percent busy over the last sampling interval. Null on the first sample. */
  usage: number | null;
  /** Base frequency times % Processor Performance. Null when the counter was not read. */
  effectiveMHz: number | null;
}

export interface CpuReading {
  name: string | null;
  vendor: string | null;
  coreCount: number | null;
  threadCount: number | null;
  baseMHz: number | null;
  l2KB: number | null;
  l3KB: number | null;
  socket: string | null;
  /** Whole-package load, the mean of the threads. */
  usage: number | null;
  /** Whole-package effective clock. */
  effectiveMHz: number | null;
  /** Effective clock as a percentage of base. Over 100 means boosting. */
  performancePct: number | null;
  threads: ThreadReading[];
}

export interface GpuReading {
  name: string;
  driver: string | null;
  tempC: number | null;
  /** Degrees left before the driver slows the card down. */
  slowdownMarginC: number | null;
  usage: number | null;
  memoryControllerUsage: number | null;
  clockMHz: number | null;
  maxClockMHz: number | null;
  memoryClockMHz: number | null;
  fanPct: number | null;
  vramUsedMiB: number | null;
  vramTotalMiB: number | null;
  powerW: number | null;
  powerLimitW: number | null;
  pstate: string | null;
  resolution: string | null;
  source: 'nvidia-smi' | 'wmi';
}

export interface RamModule {
  slot: string;
  capacityBytes: number | null;
  type: string | null;
  /** The module's own reported speed, MT/s. */
  speedMTs: number | null;
  /** What the memory controller is actually running it at, MT/s. */
  configuredMTs: number | null;
  manufacturer: string | null;
  partNumber: string | null;
}

export interface MemoryReading {
  totalBytes: number;
  usedBytes: number;
  modules: RamModule[];
}

export interface DiskReading {
  id: string;
  model: string;
  media: string;
  bus: string;
  sizeBytes: number | null;
  health: string;
  busyPct: number | null;
  readBps: number | null;
  writeBps: number | null;
  /** Drive letters on this disk, from the PerfDisk instance name. */
  letters: string[];
}

export interface VolumeReading {
  letter: string;
  label: string;
  fileSystem: string | null;
  sizeBytes: number;
  freeBytes: number;
}

export type Part = 'cpu' | 'gpu' | 'storage' | 'board' | 'other';

export interface Temperature {
  part: Part;
  label: string;
  celsius: number;
  source: 'ACPI' | 'LibreHardwareMonitor';
}

export interface FanReading {
  label: string;
  rpm: number;
  source: 'LibreHardwareMonitor';
}

export interface SystemReading {
  os: string | null;
  osVersion: string | null;
  board: string | null;
  bios: string | null;
  /** ISO timestamp of the last boot. */
  bootedAt: string | null;
}

export interface HardwareSnapshot {
  takenAt: number;
  system: SystemReading;
  cpu: CpuReading;
  gpus: GpuReading[];
  memory: MemoryReading;
  disks: DiskReading[];
  volumes: VolumeReading[];
  temperatures: Temperature[];
  fans: FanReading[];
  missing: Missing[];
  /** How old each source's reading is, in ms. Null when that source has never produced one. */
  ages: { inventory: number | null; sensors: number | null; gpu: number | null };
  /** Where the readings came from, for the panel's footer. */
  sources: string[];
}

/* ─────────────────────────────────── parsing ─────────────────────────────────── */

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** ConvertTo-Json writes a one-element array as a bare object on some paths. Accept either. */
function asArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object');
  if (value && typeof value === 'object') return [value as Record<string, unknown>];
  return [];
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** MSFT_PhysicalDisk.MediaType. */
export function mediaTypeName(code: unknown): string {
  switch (num(code)) {
    case 3: return 'HDD';
    case 4: return 'SSD';
    case 5: return 'SCM';
    default: return 'UNSPECIFIED';
  }
}

/** MSFT_PhysicalDisk.BusType. Only the ones a desktop actually has; anything else says its number. */
export function busTypeName(code: unknown): string {
  const n = num(code);
  const names: Record<number, string> = {
    1: 'SCSI', 2: 'ATAPI', 3: 'ATA', 6: 'FIBRE', 7: 'USB', 8: 'RAID', 9: 'ISCSI',
    10: 'SAS', 11: 'SATA', 12: 'SD', 13: 'MMC', 15: 'VIRTUAL', 16: 'SPACES', 17: 'NVME'
  };
  return n !== null && names[n] ? names[n] : n === null ? 'UNKNOWN' : `BUS ${n}`;
}

/** MSFT_PhysicalDisk.HealthStatus. */
export function healthName(code: unknown): string {
  switch (num(code)) {
    case 0: return 'HEALTHY';
    case 1: return 'WARNING';
    case 2: return 'UNHEALTHY';
    default: return 'UNKNOWN';
  }
}

/** Win32_PhysicalMemory.SMBIOSMemoryType, per the SMBIOS spec. */
export function memoryTypeName(code: unknown): string | null {
  const n = num(code);
  const names: Record<number, string> = { 20: 'DDR', 21: 'DDR2', 24: 'DDR3', 26: 'DDR4', 30: 'LPDDR4', 34: 'DDR5', 35: 'LPDDR5' };
  return n !== null && names[n] ? names[n] : null;
}

/** What is read once: the parts list. */
export interface Inventory {
  cpu: Pick<CpuReading, 'name' | 'vendor' | 'coreCount' | 'threadCount' | 'baseMHz' | 'l2KB' | 'l3KB' | 'socket'>;
  system: SystemReading;
  modules: RamModule[];
  video: { name: string; driver: string | null; resolution: string | null }[];
  disks: Omit<DiskReading, 'busyPct' | 'readBps' | 'writeBps' | 'letters'>[];
}

/** The inventory script's JSON, as written by src/main/services/hardware.ts. */
export function parseInventory(raw: unknown): Inventory {
  const root = obj(raw);
  const cpu = obj(root['cpu']);
  const board = obj(root['board']);
  const bios = obj(root['bios']);
  const os = obj(root['os']);

  const boardName = [str(board['Manufacturer']), str(board['Product'])].filter(Boolean).join(' ') || null;
  const biosName = [str(bios['Manufacturer']), str(bios['SMBIOSBIOSVersion'])].filter(Boolean).join(' ') || null;

  return {
    cpu: {
      name: str(cpu['Name']),
      vendor: str(cpu['Manufacturer']),
      coreCount: num(cpu['NumberOfCores']),
      threadCount: num(cpu['NumberOfLogicalProcessors']),
      baseMHz: num(cpu['MaxClockSpeed']),
      l2KB: num(cpu['L2CacheSize']),
      l3KB: num(cpu['L3CacheSize']),
      socket: str(cpu['SocketDesignation'])
    },
    system: {
      os: str(os['Caption']),
      osVersion: str(os['Version']),
      board: boardName,
      bios: biosName,
      bootedAt: str(os['LastBootUpTime'])
    },
    modules: asArray(root['ram']).map((m, i) => ({
      slot: str(m['DeviceLocator']) ?? `SLOT ${i + 1}`,
      capacityBytes: num(m['Capacity']),
      type: memoryTypeName(m['SMBIOSMemoryType']),
      speedMTs: num(m['Speed']),
      configuredMTs: num(m['ConfiguredClockSpeed']),
      manufacturer: str(m['Manufacturer']),
      partNumber: str(m['PartNumber'])
    })),
    video: asArray(root['video']).map((v) => {
      const w = num(v['CurrentHorizontalResolution']);
      const h = num(v['CurrentVerticalResolution']);
      const hz = num(v['CurrentRefreshRate']);
      return {
        name: str(v['Name']) ?? 'UNKNOWN ADAPTER',
        driver: str(v['DriverVersion']),
        resolution: w && h ? `${w}x${h}${hz ? ` @ ${hz} Hz` : ''}` : null
      };
    }),
    disks: asArray(root['disks'])
      .map((d) => ({
        id: String(num(d['DeviceId']) ?? str(d['DeviceId']) ?? '?'),
        model: str(d['FriendlyName']) ?? 'UNKNOWN DRIVE',
        media: mediaTypeName(d['MediaType']),
        bus: busTypeName(d['BusType']),
        sizeBytes: num(d['Size']),
        health: healthName(d['HealthStatus'])
      }))
      .sort((a, b) => Number(a.id) - Number(b.id))
  };
}

/** What is polled: counters and sensors. */
export interface Sensors {
  total: { perfPct: number | null; baseMHz: number | null } | null;
  threads: { index: number; perfPct: number | null; baseMHz: number | null }[];
  temperatures: Temperature[];
  fans: FanReading[];
  diskActivity: { disk: string; letters: string[]; busyPct: number | null; readBps: number | null; writeBps: number | null }[];
  volumes: VolumeReading[];
  lhmAvailable: boolean;
}

/**
 * ACPI zone temperature. The counter carries Kelvin in `Temperature` and tenths of a Kelvin in
 * `HighPrecisionTemperature`; the second is preferred because the first is truncated.
 */
export function zoneCelsius(highPrecision: unknown, kelvin: unknown): number | null {
  const hp = num(highPrecision);
  if (hp !== null && hp > 0) return Math.round((hp / 10 - 273.15) * 10) / 10;
  const k = num(kelvin);
  if (k !== null && k > 0) return Math.round((k - 273.15) * 10) / 10;
  return null;
}

/** Which part a LibreHardwareMonitor sensor belongs to, from its identifier (`/intelcpu/0/...`). */
export function partForIdentifier(identifier: string): Part {
  const id = identifier.toLowerCase();
  if (/^\/(intelcpu|amdcpu|cpu)/.test(id)) return 'cpu';
  if (/^\/(gpu|nvidiagpu|atigpu|amdgpu|intelgpu)/.test(id)) return 'gpu';
  if (/^\/(nvme|hdd|ssd|storage|ata)/.test(id)) return 'storage';
  if (/^\/(lpc|mainboard|motherboard|superio)/.test(id)) return 'board';
  return 'other';
}

/** The sensor script's JSON, as written by src/main/services/hardware.ts. */
export function parseSensors(raw: unknown): Sensors {
  const root = obj(raw);

  /*
   * Processor instances are named "<group>,<index>". Windows numbers threads from zero inside each
   * processor group of up to 64, so a machine with more than one group needs the groups laid end to
   * end to line up with os.cpus(). One group is by far the common case and costs nothing here.
   */
  let total: Sensors['total'] = null;
  const byGroup = new Map<number, { index: number; perfPct: number | null; baseMHz: number | null }[]>();
  for (const p of asArray(root['cpu'])) {
    const name = str(p['Name']) ?? '';
    const perfPct = num(p['PercentProcessorPerformance']);
    const baseMHz = num(p['ProcessorFrequency']);
    if (name === '_Total') { total = { perfPct, baseMHz }; continue; }
    const match = /^(\d+),(\d+)$/.exec(name);
    if (!match) continue;
    const group = Number(match[1]);
    const list = byGroup.get(group) ?? [];
    list.push({ index: Number(match[2]), perfPct, baseMHz });
    byGroup.set(group, list);
  }
  const threads: Sensors['threads'] = [];
  let offset = 0;
  for (const group of [...byGroup.keys()].sort((a, b) => a - b)) {
    const list = (byGroup.get(group) ?? []).sort((a, b) => a.index - b.index);
    for (const t of list) threads.push({ ...t, index: t.index + offset });
    offset += list.length;
  }

  const temperatures: Temperature[] = [];
  for (const z of asArray(root['zones'])) {
    const celsius = zoneCelsius(z['HighPrecisionTemperature'], z['Temperature']);
    if (celsius === null) continue;
    temperatures.push({ part: 'board', label: `ACPI ${str(z['Name']) ?? 'ZONE'}`, celsius, source: 'ACPI' });
  }

  const fans: FanReading[] = [];
  for (const s of asArray(root['lhm'])) {
    const value = num(s['Value']);
    if (value === null) continue;
    const label = str(s['Name']) ?? 'SENSOR';
    const identifier = str(s['Identifier']) ?? str(s['Parent']) ?? '';
    const type = (str(s['SensorType']) ?? 'Temperature').toLowerCase();
    if (type === 'fan') fans.push({ label, rpm: Math.round(value), source: 'LibreHardwareMonitor' });
    else if (type === 'temperature') {
      temperatures.push({ part: partForIdentifier(identifier), label, celsius: Math.round(value * 10) / 10, source: 'LibreHardwareMonitor' });
    }
  }

  const diskActivity: Sensors['diskActivity'] = [];
  for (const d of asArray(root['disks'])) {
    const name = str(d['Name']) ?? '';
    const match = /^(\d+)\s*(.*)$/.exec(name);
    if (!match || name === '_Total') continue;
    diskActivity.push({
      disk: match[1] ?? '',
      letters: (match[2] ?? '').split(/\s+/).filter((l) => /^[A-Za-z]:$/.test(l)),
      busyPct: num(d['PercentDiskTime']),
      readBps: num(d['DiskReadBytesPersec']),
      writeBps: num(d['DiskWriteBytesPersec'])
    });
  }

  const volumes: VolumeReading[] = asArray(root['volumes'])
    .map((v) => ({
      letter: str(v['DeviceID']) ?? '?',
      label: str(v['VolumeName']) ?? '',
      fileSystem: str(v['FileSystem']),
      sizeBytes: num(v['Size']) ?? 0,
      freeBytes: num(v['FreeSpace']) ?? 0
    }))
    .filter((v) => v.sizeBytes > 0)
    .sort((a, b) => a.letter.localeCompare(b.letter));

  return { total, threads, temperatures, fans, diskActivity, volumes, lhmAvailable: root['lhmOk'] === true };
}

/** The columns asked of nvidia-smi, in order. parseNvidiaSmi reads them back in the same order. */
export const NVIDIA_FIELDS = [
  'name', 'driver_version', 'temperature.gpu', 'temperature.gpu.tlimit', 'utilization.gpu',
  'utilization.memory', 'clocks.gr', 'clocks.max.gr', 'clocks.mem', 'fan.speed', 'memory.used',
  'memory.total', 'power.draw', 'power.limit', 'pstate'
] as const;

/**
 * `nvidia-smi --query-gpu=<NVIDIA_FIELDS> --format=csv,noheader,nounits`, one line per GPU.
 *
 * A field the card does not support comes back as `[N/A]` or `[Not Supported]`, and becomes null.
 * It is not a zero: a fan that reads 0% is stopped, a fan that reads N/A is not there to ask.
 */
export function parseNvidiaSmi(text: string): GpuReading[] {
  const out: GpuReading[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split(',').map((c) => c.trim());
    if (cells.length < NVIDIA_FIELDS.length) continue;
    const at = (field: (typeof NVIDIA_FIELDS)[number]): string => cells[NVIDIA_FIELDS.indexOf(field)] ?? '';
    const n = (field: (typeof NVIDIA_FIELDS)[number]): number | null => {
      const cell = at(field);
      return /^\[.*\]$|^n\/a$/i.test(cell) ? null : num(cell);
    };
    const s = (field: (typeof NVIDIA_FIELDS)[number]): string | null => {
      const cell = at(field);
      return /^\[.*\]$|^n\/a$/i.test(cell) ? null : str(cell);
    };
    out.push({
      name: s('name') ?? 'NVIDIA GPU',
      driver: s('driver_version'),
      tempC: n('temperature.gpu'),
      slowdownMarginC: n('temperature.gpu.tlimit'),
      usage: n('utilization.gpu'),
      memoryControllerUsage: n('utilization.memory'),
      clockMHz: n('clocks.gr'),
      maxClockMHz: n('clocks.max.gr'),
      memoryClockMHz: n('clocks.mem'),
      fanPct: n('fan.speed'),
      vramUsedMiB: n('memory.used'),
      vramTotalMiB: n('memory.total'),
      powerW: n('power.draw'),
      powerLimitW: n('power.limit'),
      pstate: s('pstate'),
      resolution: null,
      source: 'nvidia-smi'
    });
  }
  return out;
}

/** The fields of `os.cpus()[i].times` that matter. */
export interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

/**
 * Per-thread load between two samples of `os.cpus()`, in percent.
 *
 * The counters are cumulative milliseconds since boot, so a single sample says nothing about now;
 * the difference between two does. A thread whose counters did not move (or a sample that does not
 * line up, after a CPU was hot-added) reads null rather than 0 or 100.
 */
export function threadUsage(previous: readonly CpuTimes[], next: readonly CpuTimes[]): (number | null)[] {
  return next.map((now, i) => {
    const before = previous[i];
    if (!before) return null;
    const sum = (t: CpuTimes): number => t.user + t.nice + t.sys + t.idle + t.irq;
    const elapsed = sum(now) - sum(before);
    if (elapsed <= 0) return null;
    const idle = now.idle - before.idle;
    return Math.round(Math.min(100, Math.max(0, (1 - idle / elapsed) * 100)));
  });
}

/* ─────────────────────────────────── composing ─────────────────────────────────── */

export interface SnapshotParts {
  now: number;
  inventory: Inventory | null;
  inventoryAt: number | null;
  inventoryError: string | null;
  sensors: Sensors | null;
  sensorsAt: number | null;
  sensorsError: string | null;
  gpus: GpuReading[] | null;
  gpuAt: number | null;
  gpuError: string | null;
  /** True when nvidia-smi is not installed at all, as opposed to failing. */
  nvidiaAbsent: boolean;
  threadUsage: (number | null)[];
  memory: { totalBytes: number; freeBytes: number };
}

const LHM_FIX = 'Run LibreHardwareMonitor as administrator. SkynetOS reads its WMI namespace (root/LibreHardwareMonitor) whenever it is running, with nothing to configure here.';

/** Put the sources together, and say plainly what is missing. */
export function composeSnapshot(parts: SnapshotParts): HardwareSnapshot {
  const { inventory, sensors } = parts;
  const missing: Missing[] = [];
  const sources = ['os.cpus'];

  if (parts.inventoryError) {
    missing.push({
      what: 'Hardware inventory (CPU model, memory modules, drives, motherboard)',
      why: `PowerShell/CIM failed: ${parts.inventoryError}`,
      fix: 'Check that powershell.exe runs. The monitor tries again every minute.'
    });
  }
  if (parts.sensorsError) {
    missing.push({
      what: 'Clocks, drive activity, free space and ACPI temperatures',
      why: `PowerShell/CIM failed: ${parts.sensorsError}`,
      fix: 'The monitor tries again on the next refresh.'
    });
  }
  if (inventory || sensors) sources.push('CIM/WMI');

  /* CPU */
  const base = inventory?.cpu.baseMHz ?? sensors?.total?.baseMHz ?? null;
  const threadCount = Math.max(parts.threadUsage.length, sensors?.threads.length ?? 0);
  const threads: ThreadReading[] = Array.from({ length: threadCount }, (_, index) => {
    const counter = sensors?.threads.find((t) => t.index === index);
    const threadBase = counter?.baseMHz ?? base;
    return {
      index,
      usage: parts.threadUsage[index] ?? null,
      effectiveMHz: counter?.perfPct !== null && counter?.perfPct !== undefined && threadBase
        ? Math.round((threadBase * counter.perfPct) / 100)
        : null
    };
  });
  const usages = threads.map((t) => t.usage).filter((u): u is number => u !== null);
  const perfPct = sensors?.total?.perfPct ?? null;
  const cpu: CpuReading = {
    name: inventory?.cpu.name ?? null,
    vendor: inventory?.cpu.vendor ?? null,
    coreCount: inventory?.cpu.coreCount ?? null,
    threadCount: inventory?.cpu.threadCount ?? (threadCount || null),
    baseMHz: base,
    l2KB: inventory?.cpu.l2KB ?? null,
    l3KB: inventory?.cpu.l3KB ?? null,
    socket: inventory?.cpu.socket ?? null,
    usage: usages.length ? Math.round(usages.reduce((a, b) => a + b, 0) / usages.length) : null,
    effectiveMHz: perfPct !== null && base ? Math.round((base * perfPct) / 100) : null,
    performancePct: perfPct,
    threads
  };

  if (cpu.coreCount && cpu.threadCount && cpu.threadCount !== cpu.coreCount && cpu.threadCount !== cpu.coreCount * 2) {
    missing.push({
      what: 'Which threads are performance cores and which are efficiency cores',
      why: `This CPU reports ${cpu.coreCount} cores and ${cpu.threadCount} threads, so not every core has two threads: a hybrid design. Windows exposes the split through GetLogicalProcessorInformationEx, which SkynetOS does not call yet, so threads are listed by index.`,
      fix: 'Not available yet.'
    });
  }

  /* GPU */
  let gpus: GpuReading[] = [];
  if (parts.gpus?.length) {
    sources.push('nvidia-smi');
    gpus = parts.gpus.map((g) => ({
      ...g,
      resolution: inventory?.video.find((v) => v.name.toLowerCase() === g.name.toLowerCase())?.resolution ?? null
    }));
    // Adapters nvidia-smi does not know about (an iGPU beside the NVIDIA card) still get listed.
    for (const v of inventory?.video ?? []) {
      if (gpus.some((g) => g.name.toLowerCase() === v.name.toLowerCase())) continue;
      gpus.push(wmiOnlyGpu(v));
    }
  } else {
    gpus = (inventory?.video ?? []).map(wmiOnlyGpu);
    if (gpus.length) {
      missing.push({
        what: 'GPU temperature, load, clocks, VRAM and power',
        why: parts.nvidiaAbsent
          ? 'nvidia-smi was not found. It ships with the NVIDIA driver; SkynetOS has no reader for AMD or Intel GPUs yet.'
          : `nvidia-smi failed: ${parts.gpuError ?? 'no output'}`,
        fix: parts.nvidiaAbsent
          ? 'On an NVIDIA card, reinstall the driver. On any card, LibreHardwareMonitor also reports GPU temperature.'
          : 'The monitor tries again on the next refresh.'
      });
    }
  }

  /* Temperatures and fans */
  const temperatures = sensors?.temperatures ?? [];
  const fans = sensors?.fans ?? [];
  if (sensors?.lhmAvailable) sources.push('LibreHardwareMonitor');
  if (sensors && !temperatures.some((t) => t.part === 'cpu')) {
    missing.push({
      what: 'CPU die temperatures (package and per core)',
      why: sensors.lhmAvailable
        ? 'LibreHardwareMonitor is running but published no CPU temperature.'
        : 'Windows gives a non-elevated process no CPU die sensor. MSAcpi_ThermalZoneTemperature needs administrator rights, and the ACPI zone that is readable is a motherboard sensor, not the die.',
      fix: LHM_FIX
    });
  }
  if (sensors && !fans.length) {
    missing.push({
      what: 'Fan speeds (CPU and case)',
      why: 'Fans are read from the motherboard Super I/O chip, which needs a kernel driver. Windows offers no user-mode reading.',
      fix: LHM_FIX
    });
  }
  if (sensors && !temperatures.some((t) => t.part === 'storage')) {
    missing.push({
      what: 'Drive temperatures',
      why: 'Windows only reports drive temperatures (Get-StorageReliabilityCounter) to an elevated process.',
      fix: LHM_FIX
    });
  }

  /* Storage */
  const disks: DiskReading[] = (inventory?.disks ?? []).map((d) => {
    const activity = sensors?.diskActivity.find((a) => a.disk === d.id);
    return {
      ...d,
      busyPct: activity?.busyPct ?? null,
      readBps: activity?.readBps ?? null,
      writeBps: activity?.writeBps ?? null,
      letters: activity?.letters ?? []
    };
  });

  const age = (at: number | null): number | null => (at === null ? null : Math.max(0, parts.now - at));

  return {
    takenAt: parts.now,
    system: inventory?.system ?? { os: null, osVersion: null, board: null, bios: null, bootedAt: null },
    cpu,
    gpus,
    memory: {
      totalBytes: parts.memory.totalBytes,
      usedBytes: Math.max(0, parts.memory.totalBytes - parts.memory.freeBytes),
      modules: inventory?.modules ?? []
    },
    disks,
    volumes: sensors?.volumes ?? [],
    temperatures,
    fans,
    missing,
    ages: { inventory: age(parts.inventoryAt), sensors: age(parts.sensorsAt), gpu: age(parts.gpuAt) },
    sources
  };
}

function wmiOnlyGpu(v: Inventory['video'][number]): GpuReading {
  return {
    name: v.name,
    driver: v.driver,
    tempC: null,
    slowdownMarginC: null,
    usage: null,
    memoryControllerUsage: null,
    clockMHz: null,
    maxClockMHz: null,
    memoryClockMHz: null,
    fanPct: null,
    vramUsedMiB: null,
    vramTotalMiB: null,
    powerW: null,
    powerLimitW: null,
    pstate: null,
    resolution: v.resolution,
    source: 'wmi'
  };
}

/* ─────────────────────────────────── formatting ─────────────────────────────────── */

/** Binary units, labelled the way Windows labels them (a GiB is shown as GB). */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatRate(bytesPerSecond: number | null): string {
  return bytesPerSecond === null ? '—' : `${formatBytes(bytesPerSecond)}/s`;
}

export function formatMHz(mhz: number | null): string {
  if (mhz === null || !Number.isFinite(mhz)) return '—';
  return mhz >= 1000 ? `${(mhz / 1000).toFixed(2)} GHz` : `${Math.round(mhz)} MHz`;
}

export function formatCelsius(c: number | null): string {
  return c === null || !Number.isFinite(c) ? '—' : `${c.toFixed(c % 1 === 0 ? 0 : 1)} °C`;
}

export function formatPercent(p: number | null): string {
  return p === null || !Number.isFinite(p) ? '—' : `${Math.round(p)}%`;
}

/** Time since boot as `1d 3h 12m`. */
export function formatUptime(bootedAt: string | null, now: number): string {
  if (!bootedAt) return '—';
  const at = Date.parse(bootedAt);
  if (!Number.isFinite(at)) return '—';
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`;
}
