import { describe, expect, it } from 'vitest';
import {
  BANDS,
  busTypeName,
  composeSnapshot,
  formatBytes,
  formatCelsius,
  formatMHz,
  formatUptime,
  gpuTempBand,
  levelFor,
  mediaTypeName,
  memoryTypeName,
  parseInventory,
  parseNvidiaSmi,
  parseSensors,
  partForIdentifier,
  rampCells,
  threadUsage,
  zoneCelsius,
  type SnapshotParts
} from '../packages/shared/hardware.js';

/**
 * The system monitor's arithmetic and parsing.
 *
 * The fixtures are real: captured on William-Desktop on 2026-09-11 from the same scripts
 * src/main/services/hardware.ts runs (an i5-13600K, an RTX 5070, two DDR5 modules, six drives).
 * The rule under test hardest is the honest one: an absent source produces a Missing entry, never
 * a number.
 */

const INVENTORY = JSON.parse(`{"cpu":{"Name":"13th Gen Intel(R) Core(TM) i5-13600K","NumberOfCores":14,"NumberOfLogicalProcessors":20,"MaxClockSpeed":3500,"L2CacheSize":20480,"L3CacheSize":24576,"SocketDesignation":"LGA1700","Manufacturer":"GenuineIntel"},"ram":[{"Capacity":34359738368,"Speed":4800,"ConfiguredClockSpeed":4800,"Manufacturer":"Kingston","PartNumber":"KF556C40-32         ","DeviceLocator":"Controller0-DIMM1","SMBIOSMemoryType":34},{"Capacity":34359738368,"Speed":4800,"ConfiguredClockSpeed":4800,"Manufacturer":"Kingston","PartNumber":"KF556C40-32         ","DeviceLocator":"Controller1-DIMM1","SMBIOSMemoryType":34}],"board":{"Manufacturer":"ASUSTeK COMPUTER INC.","Product":"TUF GAMING Z790-PLUS WIFI","Version":"Rev 1.xx"},"bios":{"Manufacturer":"American Megatrends Inc.","SMBIOSBIOSVersion":"1836"},"os":{"Caption":"Microsoft Windows 11 Home","Version":"10.0.26200","LastBootUpTime":"2026-09-10T08:15:19.5000000Z"},"video":[{"Name":"NVIDIA GeForce RTX 5070","DriverVersion":"32.0.16.1664","CurrentHorizontalResolution":1920,"CurrentVerticalResolution":1080,"CurrentRefreshRate":60}],"disks":[{"DeviceId":"4","FriendlyName":"CT500P1SSD8","MediaType":4,"BusType":17,"Size":500107862016,"HealthStatus":0},{"DeviceId":"2","FriendlyName":"WDC WD2003FZEX-00SRLA0","MediaType":3,"BusType":11,"Size":2000398934016,"HealthStatus":0},{"DeviceId":"6","FriendlyName":"VendorCo ProductCode","MediaType":0,"BusType":7,"Size":2097150951424,"HealthStatus":0}]}`);

const SENSORS = {
  cpu: [
    { Name: '_Total', PercentProcessorPerformance: 131, ProcessorFrequency: 3500 },
    { Name: '0,_Total', PercentProcessorPerformance: 131, ProcessorFrequency: 3500 },
    { Name: '0,10', PercentProcessorPerformance: 135, ProcessorFrequency: 3500 },
    { Name: '0,0', PercentProcessorPerformance: 128, ProcessorFrequency: 3500 },
    { Name: '0,1', PercentProcessorPerformance: 141, ProcessorFrequency: 3500 }
  ],
  zones: [{ Name: '\\_TZ.TZ00', HighPrecisionTemperature: 3010, Temperature: 301 }],
  disks: [
    { Name: '4 C:', PercentDiskTime: 3, DiskReadBytesPersec: 0, DiskWriteBytesPersec: 325266 },
    { Name: '7', PercentDiskTime: 0, DiskReadBytesPersec: 0, DiskWriteBytesPersec: 0 },
    { Name: '_Total', PercentDiskTime: 0, DiskReadBytesPersec: 0, DiskWriteBytesPersec: 325266 }
  ],
  volumes: { DeviceID: 'C:', VolumeName: '', FileSystem: 'NTFS', Size: 498701692928, FreeSpace: 138748235776 },
  lhm: [],
  lhmOk: false
};

const NVIDIA = 'NVIDIA GeForce RTX 5070, 616.64, 52, 33, 4, 1, 1080, 3090, 14001, 0, 3784, 12227, 29.13, 250.00, P0\r\n';

const parts = (over: Partial<SnapshotParts> = {}): SnapshotParts => ({
  now: Date.parse('2026-09-11T08:15:19.500Z'),
  inventory: parseInventory(INVENTORY),
  inventoryAt: 0,
  inventoryError: null,
  sensors: parseSensors(SENSORS),
  sensorsAt: 0,
  sensorsError: null,
  gpus: parseNvidiaSmi(NVIDIA),
  gpuAt: 0,
  gpuError: null,
  nvidiaAbsent: false,
  threadUsage: [57, 14, null],
  memory: { totalBytes: 64 * 2 ** 30, freeBytes: 40 * 2 ** 30 },
  ...over
});

describe('levels: expected vs actual', () => {
  it('steps ok, warn, fault at the band edges', () => {
    expect(levelFor(69, BANDS.load)).toBe('ok');
    expect(levelFor(70, BANDS.load)).toBe('warn');
    expect(levelFor(90, BANDS.load)).toBe('fault');
  });

  it('judges a GPU against its own slowdown temperature, not a rule of thumb', () => {
    // 52 °C with 33 °C of margin: the driver slows the card at 85 °C.
    const band = gpuTempBand(52, 33);
    expect(band.max).toBe(85);
    expect(levelFor(52, band)).toBe('ok');
    expect(levelFor(66, band)).toBe('warn');
    expect(levelFor(76, band)).toBe('fault');
    expect(band.note).toContain('85 °C');
  });

  it('falls back to the rule of thumb only when the driver gives no margin', () => {
    expect(gpuTempBand(60, null)).toMatchObject({ warn: BANDS.gpuTempFallback.warn, max: 100 });
  });
});

describe('rampCells: a gradient made of whole cells', () => {
  it('lights cells in proportion and colours each by where it sits on the scale', () => {
    const cells = rampCells(50, 100, BANDS.load, 10);
    expect(cells.filter((c) => c.lit)).toHaveLength(5);
    // The scale is the same whatever the value: 7 ok cells, 2 warn, 1 fault.
    expect(cells.map((c) => c.level)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'warn', 'warn', 'fault']);
  });

  it('shows the scale with nothing lit for zero, and clamps past the top', () => {
    expect(rampCells(0, 100, BANDS.load, 8).some((c) => c.lit)).toBe(false);
    expect(rampCells(250, 100, BANDS.load, 8).every((c) => c.lit)).toBe(true);
    expect(rampCells(NaN, 100, BANDS.load, 8).some((c) => c.lit)).toBe(false);
  });
});

describe('parsing what the machine says', () => {
  it('reads the inventory', () => {
    const inv = parseInventory(INVENTORY);
    expect(inv.cpu).toMatchObject({ coreCount: 14, threadCount: 20, baseMHz: 3500, socket: 'LGA1700' });
    expect(inv.system.board).toBe('ASUSTeK COMPUTER INC. TUF GAMING Z790-PLUS WIFI');
    expect(inv.modules[0]).toMatchObject({ type: 'DDR5', configuredMTs: 4800, partNumber: 'KF556C40-32' });
    expect(inv.disks.map((d) => d.id)).toEqual(['2', '4', '6']);
    expect(inv.disks.find((d) => d.id === '4')).toMatchObject({ media: 'SSD', bus: 'NVME', health: 'HEALTHY' });
    expect(inv.video[0]?.resolution).toBe('1920x1080 @ 60 Hz');
  });

  it('reads the counters, in thread order, skipping the totals', () => {
    const sensors = parseSensors(SENSORS);
    expect(sensors.total).toEqual({ perfPct: 131, baseMHz: 3500 });
    // "0,10" is thread 10, and sorts after "0,1" numerically, not as text.
    expect(sensors.threads.map((t) => t.index)).toEqual([0, 1, 10]);
    expect(sensors.threads[2]?.perfPct).toBe(135);
    expect(sensors.diskActivity.find((d) => d.disk === '4')).toMatchObject({ letters: ['C:'], writeBps: 325266 });
    expect(sensors.volumes).toHaveLength(1);
    expect(sensors.lhmAvailable).toBe(false);
  });

  it('converts the ACPI zone from tenths of a kelvin', () => {
    expect(zoneCelsius(3010, 301)).toBe(27.9);
    expect(zoneCelsius(null, 301)).toBe(27.9);
    expect(zoneCelsius(0, 0)).toBeNull();
  });

  it('files LibreHardwareMonitor sensors under the right part', () => {
    expect(partForIdentifier('/intelcpu/0/temperature/0')).toBe('cpu');
    expect(partForIdentifier('/gpu-nvidia/0/temperature/0')).toBe('gpu');
    expect(partForIdentifier('/nvme/0/temperature/0')).toBe('storage');
    expect(partForIdentifier('/lpc/nct6798d/temperature/1')).toBe('board');
    const sensors = parseSensors({
      ...SENSORS,
      lhmOk: true,
      lhm: [
        { Name: 'CPU Package', Identifier: '/intelcpu/0/temperature/6', SensorType: 'Temperature', Value: 48.5 },
        { Name: 'CPU Fan', Identifier: '/lpc/nct6798d/fan/1', SensorType: 'Fan', Value: 912.4 }
      ]
    });
    expect(sensors.temperatures.find((t) => t.label === 'CPU Package')).toMatchObject({ part: 'cpu', celsius: 48.5 });
    expect(sensors.fans).toEqual([{ label: 'CPU Fan', rpm: 912, source: 'LibreHardwareMonitor' }]);
  });

  it('reads nvidia-smi, and an unsupported field as null rather than zero', () => {
    const [gpu] = parseNvidiaSmi(NVIDIA);
    expect(gpu).toMatchObject({ name: 'NVIDIA GeForce RTX 5070', tempC: 52, slowdownMarginC: 33, fanPct: 0, vramTotalMiB: 12227, pstate: 'P0' });
    const [older] = parseNvidiaSmi('Quadro, 470.1, 61, [N/A], 3, 1, 900, 1800, 5000, [Not Supported], 100, 4096, [N/A], 75.00, P8');
    expect(older?.slowdownMarginC).toBeNull();
    expect(older?.fanPct).toBeNull();
    expect(older?.powerW).toBeNull();
    expect(parseNvidiaSmi('')).toEqual([]);
  });

  it('names codes it knows and admits the ones it does not', () => {
    expect(mediaTypeName(3)).toBe('HDD');
    expect(mediaTypeName(0)).toBe('UNSPECIFIED');
    expect(busTypeName(17)).toBe('NVME');
    expect(busTypeName(42)).toBe('BUS 42');
    expect(memoryTypeName(26)).toBe('DDR4');
    expect(memoryTypeName(99)).toBeNull();
  });
});

describe('threadUsage', () => {
  const t = (user: number, idle: number) => ({ user, nice: 0, sys: 0, idle, irq: 0 });

  it('is the busy share of the time between two samples', () => {
    expect(threadUsage([t(100, 900)], [t(175, 925)])).toEqual([75]);
  });

  it('reads null, not 0 or 100, when it has nothing to compare', () => {
    expect(threadUsage([], [t(1, 1)])).toEqual([null]);
    expect(threadUsage([t(5, 5)], [t(5, 5)])).toEqual([null]);
  });
});

describe('composeSnapshot', () => {
  it('derives the effective clock from the performance counter', () => {
    const snap = composeSnapshot(parts());
    expect(snap.cpu.effectiveMHz).toBe(4585);
    expect(snap.cpu.threads[0]).toEqual({ index: 0, usage: 57, effectiveMHz: 4480 });
    expect(snap.cpu.usage).toBe(36);
  });

  it('never puts a number where a CPU temperature would go without a sensor', () => {
    const snap = composeSnapshot(parts());
    expect(snap.temperatures.some((t) => t.part === 'cpu')).toBe(false);
    const missing = snap.missing.find((m) => m.what.startsWith('CPU die temperatures'));
    expect(missing?.fix).toContain('LibreHardwareMonitor');
    // The readable ACPI zone is kept, and filed as the motherboard sensor it is.
    expect(snap.temperatures).toEqual([{ part: 'board', label: 'ACPI \\_TZ.TZ00', celsius: 27.9, source: 'ACPI' }]);
  });

  it('says which threads are which is not known on a hybrid CPU', () => {
    expect(composeSnapshot(parts()).missing.some((m) => m.what.includes('performance cores'))).toBe(true);
  });

  it('lists the GPU from WMI and says why its sensors are missing when nvidia-smi is absent', () => {
    const snap = composeSnapshot(parts({ gpus: null, nvidiaAbsent: true }));
    expect(snap.gpus[0]).toMatchObject({ name: 'NVIDIA GeForce RTX 5070', source: 'wmi', tempC: null });
    expect(snap.missing.find((m) => m.what.startsWith('GPU'))?.why).toContain('nvidia-smi was not found');
  });

  it('joins drive activity to the drive it belongs to', () => {
    const snap = composeSnapshot(parts());
    expect(snap.disks.find((d) => d.id === '4')).toMatchObject({ letters: ['C:'], busyPct: 3 });
    expect(snap.disks.find((d) => d.id === '2')?.busyPct).toBeNull();
  });

  it('reports a failed read as missing, with the reason', () => {
    const snap = composeSnapshot(parts({ inventory: null, inventoryError: 'powershell.exe ENOENT' }));
    expect(snap.missing[0]?.why).toContain('powershell.exe ENOENT');
    expect(snap.cpu.name).toBeNull();
  });

  it('drops the LibreHardwareMonitor entries once it is running and reporting', () => {
    const sensors = parseSensors({
      ...SENSORS,
      lhmOk: true,
      lhm: [
        { Name: 'CPU Package', Identifier: '/intelcpu/0/temperature/6', SensorType: 'Temperature', Value: 48 },
        { Name: 'Temperature', Identifier: '/nvme/0/temperature/0', SensorType: 'Temperature', Value: 41 },
        { Name: 'CPU Fan', Identifier: '/lpc/nct6798d/fan/1', SensorType: 'Fan', Value: 900 }
      ]
    });
    const snap = composeSnapshot(parts({ sensors }));
    expect(snap.sources).toContain('LibreHardwareMonitor');
    expect(snap.missing.map((m) => m.what).filter((w) => /temperature|Fan/i.test(w))).toEqual([]);
  });
});

describe('formatting', () => {
  it('uses Windows-style binary units', () => {
    expect(formatBytes(32 * 2 ** 30)).toBe('32.0 GB');
    expect(formatBytes(8001563222016)).toBe('7.28 TB');
    expect(formatBytes(null)).toBe('—');
  });

  it('prints clocks and temperatures', () => {
    expect(formatMHz(4480)).toBe('4.48 GHz');
    expect(formatMHz(960)).toBe('960 MHz');
    expect(formatCelsius(27.9)).toBe('27.9 °C');
    expect(formatCelsius(52)).toBe('52 °C');
  });

  it('prints uptime from the boot time', () => {
    expect(formatUptime('2026-09-10T08:15:19.500Z', Date.parse('2026-09-11T11:27:19.500Z'))).toBe('1d 3h 12m');
    expect(formatUptime(null, 0)).toBe('—');
  });
});
