import { execFile } from 'node:child_process';
import { cpus, freemem, totalmem } from 'node:os';
import {
  NVIDIA_FIELDS,
  composeSnapshot,
  parseInventory,
  parseNvidiaSmi,
  parseSensors,
  threadUsage,
  type CpuTimes,
  type GpuReading,
  type HardwareSnapshot,
  type Inventory,
  type Sensors
} from '@shared/hardware.js';

/**
 * Reading this machine's hardware, for the system monitor. What is read and why is in
 * packages/shared/hardware.ts; this file is only the fetching.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────────────────────────
 *
 * Measured on this machine: one PowerShell spawn is about 0.2 s, the CIM inventory query 1.4 s,
 * the sensor query 1.1 s, and nvidia-smi 0.06 s. None of that may sit on the main process. So:
 *
 *   - Everything runs as a child process and is awaited, never synchronous.
 *   - The inventory (CPU model, modules, drives, board) is read ONCE. Parts do not change while
 *     the app is open.
 *   - Sensors are refreshed at most every 3 s and the GPU at most every 2 s, and ONLY when asked.
 *     Nothing polls while the panel is closed and no agent is asking, so an idle board costs zero.
 *   - A request answers at once with the newest cached reading and starts a refresh for the next
 *     one. Only the very first request waits, so the panel does not open on a page of dashes.
 *   - Per-thread load comes from `os.cpus()`, which is free, rather than from another counter.
 *
 * Every source fails soft. A failure is kept as a message and shows up in the panel's
 * NOT READABLE list; it never becomes a zero.
 */

const SENSOR_TTL_MS = 3000;
/**
 * The board's monitor widgets ask for a LIGHT snapshot: sensors at most every 15 s. Their CPU,
 * thread and RAM figures come from `os` and stay live either way. Without this, a PSU on the board
 * kept a PowerShell CIM query (about 1.3 s of CPU) running every 3 s for as long as the app was
 * open. That undid the "an idle board costs zero" rule above.
 */
const LIGHT_SENSOR_TTL_MS = 15_000;
const GPU_TTL_MS = 2000;
/** A failed inventory is retried, but not on every request: a broken PowerShell would spawn forever. */
const INVENTORY_RETRY_MS = 60_000;
const CHILD_TIMEOUT_MS = 20_000;
/** How long the very first request waits for the first readings before answering with what it has. */
const COLD_START_WAIT_MS = 10_000;

/**
 * The parts list. Calculated properties turn the boot time into ISO text, because
 * Windows PowerShell 5.1 serialises a DateTime as `\/Date(…)\/`, which nothing else reads.
 */
const INVENTORY_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$p = Get-CimInstance Win32_Processor | Select-Object -First 1 Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, L2CacheSize, L3CacheSize, SocketDesignation, Manufacturer
$m = @(Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity, Speed, ConfiguredClockSpeed, Manufacturer, PartNumber, DeviceLocator, SMBIOSMemoryType)
$b = Get-CimInstance Win32_BaseBoard | Select-Object -First 1 Manufacturer, Product, Version
$bi = Get-CimInstance Win32_BIOS | Select-Object -First 1 Manufacturer, SMBIOSBIOSVersion
$os = Get-CimInstance Win32_OperatingSystem | Select-Object -First 1 Caption, Version, @{n='LastBootUpTime';e={ $_.LastBootUpTime.ToUniversalTime().ToString('o') }}
$v = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, CurrentHorizontalResolution, CurrentVerticalResolution, CurrentRefreshRate)
$d = @(Get-CimInstance -Namespace root/Microsoft/Windows/Storage MSFT_PhysicalDisk | Select-Object DeviceId, FriendlyName, MediaType, BusType, Size, HealthStatus)
[pscustomobject]@{ cpu = $p; ram = $m; board = $b; bios = $bi; os = $os; video = $v; disks = $d } | ConvertTo-Json -Compress -Depth 4
`;

/**
 * The counters and sensors. LibreHardwareMonitor's namespace only exists while it is running, so
 * its absence is caught and reported as `lhmOk = false`, not as a failure of the whole read.
 */
const SENSOR_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$pi = @(Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation | Select-Object Name, PercentProcessorPerformance, ProcessorFrequency)
$tz = @(Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation | Select-Object Name, HighPrecisionTemperature, Temperature)
$dk = @(Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk | Select-Object Name, PercentDiskTime, DiskReadBytesPersec, DiskWriteBytesPersec)
$vol = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID, VolumeName, FileSystem, Size, FreeSpace)
$lhmOk = $true
try { $lhm = @(Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -ErrorAction Stop | Where-Object { $_.SensorType -eq 'Temperature' -or $_.SensorType -eq 'Fan' } | Select-Object Name, Identifier, SensorType, Value, Parent) } catch { $lhm = @(); $lhmOk = $false }
[pscustomobject]@{ cpu = $pi; zones = $tz; disks = $dk; volumes = $vol; lhm = $lhm; lhmOk = $lhmOk } | ConvertTo-Json -Compress -Depth 4
`;

/**
 * Run a fixed script. `-EncodedCommand` rather than `-Command`: the script is handed over as
 * base64 UTF-16, so there is no quoting on the command line to get wrong. The scripts are
 * constants in this file, never assembled from input.
 */
function runPowerShell(script: string): Promise<unknown> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: CHILD_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) { reject(error); return; }
        const text = stdout.trim();
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error(`unreadable output: ${text.slice(0, 160) || '(empty)'}`));
        }
      }
    );
  });
}

function runNvidiaSmi(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'nvidia-smi',
      [`--query-gpu=${NVIDIA_FIELDS.join(',')}`, '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    );
  });
}

function message(err: unknown): string {
  return (err as Error)?.message?.split('\n')[0] ?? String(err);
}

let inventory: { at: number; value: Inventory } | null = null;
let inventoryError: string | null = null;
let inventoryFailedAt = 0;
let inventoryJob: Promise<void> | null = null;

let sensors: { at: number; value: Sensors } | null = null;
let sensorsError: string | null = null;
let sensorsJob: Promise<void> | null = null;

let gpus: { at: number; value: GpuReading[] } | null = null;
let gpuError: string | null = null;
let nvidiaAbsent = false;
let gpuJob: Promise<void> | null = null;

let lastTimes: CpuTimes[] | null = null;
let lastUsage: (number | null)[] = [];
let lastSampleAt = 0;

function refreshInventory(now: number): void {
  if (inventory || inventoryJob) return;
  if (inventoryError && now - inventoryFailedAt < INVENTORY_RETRY_MS) return;
  inventoryJob = runPowerShell(INVENTORY_SCRIPT)
    .then((raw) => { inventory = { at: Date.now(), value: parseInventory(raw) }; inventoryError = null; })
    .catch((err: unknown) => { inventoryError = message(err); inventoryFailedAt = Date.now(); })
    .finally(() => { inventoryJob = null; });
}

function refreshSensors(now: number, ttl: number): void {
  if (sensorsJob || (sensors && now - sensors.at < ttl)) return;
  sensorsJob = runPowerShell(SENSOR_SCRIPT)
    .then((raw) => { sensors = { at: Date.now(), value: parseSensors(raw) }; sensorsError = null; })
    .catch((err: unknown) => { sensorsError = message(err); })
    .finally(() => { sensorsJob = null; });
}

function refreshGpu(now: number): void {
  // Absent is a fact about the machine, not a transient failure: stop asking.
  if (nvidiaAbsent || gpuJob || (gpus && now - gpus.at < GPU_TTL_MS)) return;
  gpuJob = runNvidiaSmi()
    .then((text) => { gpus = { at: Date.now(), value: parseNvidiaSmi(text) }; gpuError = null; })
    .catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') nvidiaAbsent = true;
      else gpuError = message(err);
    })
    .finally(() => { gpuJob = null; });
}

/** Per-thread load since the previous sample. Resampled at most twice a second. */
function sampleThreads(now: number): (number | null)[] {
  if (now - lastSampleAt < 500 && lastTimes) return lastUsage;
  const times = cpus().map((c) => c.times);
  lastUsage = lastTimes ? threadUsage(lastTimes, times) : times.map(() => null);
  lastTimes = times;
  lastSampleAt = now;
  return lastUsage;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Everything the monitor shows, right now.
 *
 * Warm: answers immediately from cache and refreshes whatever is stale for the next request.
 * Cold: waits (up to 10 s) for the first readings, because an empty first answer would render
 * as a panel full of dashes and read as broken.
 */
export async function hardwareSnapshot(options: { light?: boolean } = {}): Promise<HardwareSnapshot> {
  const now = Date.now();
  refreshInventory(now);
  refreshSensors(now, options.light ? LIGHT_SENSOR_TTL_MS : SENSOR_TTL_MS);
  refreshGpu(now);

  const cold: Promise<void>[] = [];
  if (!inventory && inventoryJob) cold.push(inventoryJob);
  if (!sensors && sensorsJob) cold.push(sensorsJob);
  if (!gpus && gpuJob) cold.push(gpuJob);
  if (cold.length) {
    // The first thread sample needs a second one to mean anything; take it while waiting.
    sampleThreads(now);
    await Promise.race([Promise.allSettled(cold), delay(COLD_START_WAIT_MS)]);
  }

  const at = Date.now();
  return composeSnapshot({
    now: at,
    inventory: inventory?.value ?? null,
    inventoryAt: inventory?.at ?? null,
    inventoryError,
    sensors: sensors?.value ?? null,
    sensorsAt: sensors?.at ?? null,
    sensorsError,
    gpus: gpus?.value ?? null,
    gpuAt: gpus?.at ?? null,
    gpuError,
    nvidiaAbsent,
    threadUsage: sampleThreads(at),
    memory: { totalBytes: totalmem(), freeBytes: freemem() }
  });
}
