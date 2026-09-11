import { useEffect, useRef, useState } from 'react';
import {
  BANDS,
  formatBytes,
  formatCelsius,
  formatMHz,
  formatPercent,
  formatRate,
  formatUptime,
  gpuTempBand,
  levelFor,
  rampCells,
  type Band,
  type HardwareSnapshot,
  type Temperature
} from '@shared/hardware.js';

/**
 * The system monitor. Opened by activating a `monitor.system` node: double-click it, or Tab to it
 * and press Space. Esc closes it.
 *
 * William: "speccy is an excellent example of what I'm imagining on per-hardware data, temp and
 * speeds, a simplified temp bar that gradients color based on expected vs actual".
 *
 * So it is laid out the way Speccy is, one section per component, and every live number has a
 * segmented bar next to it. The bar is the expected-vs-actual reading: the cells' OUTLINES show
 * where ok ends and warn and fault begin for that kind of reading, and the FILL shows where the
 * reading is now. It steps rather than blends. docs/02 forbids smooth gradients, and a gradient
 * made of whole cells is also easier to read at a glance.
 *
 * Everything on it is read off this machine (packages/shared/hardware.ts). What cannot be read is
 * listed at the bottom with the reason and what would provide it, rather than left blank or guessed.
 */

/** Refresh interval while open. Main caches, so this mostly returns cached values between refreshes. */
const POLL_MS = 1500;

/** Keys that should scroll the panel rather than pan the board while focus is inside it. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Space']);

type BandLike = Pick<Band, 'warn' | 'fault'> & { note?: string };

function Ramp({ value, max, band, cells = 16 }: { value: number | null; max: number; band: BandLike; cells?: number }): React.JSX.Element {
  const parts = rampCells(value ?? 0, max, band, cells);
  return (
    <span className="ramp" title={band.note} aria-hidden="true">
      {parts.map((cell, i) => (
        <span key={i} className={`cell ${cell.level}${value !== null && cell.lit ? ' lit' : ''}`} />
      ))}
    </span>
  );
}

function levelClass(value: number | null, band: BandLike): string {
  return value === null ? 'lv-none' : `lv-${levelFor(value, band)}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="sysmon-row">
      <span className="sysmon-label">{label}</span>
      <span className="sysmon-value">{children}</span>
    </div>
  );
}

function Unreadable(): React.JSX.Element {
  return <span className="sysmon-dim">NOT READABLE — SEE BELOW</span>;
}

function pct(part: number | null, whole: number | null): number | null {
  return part === null || !whole ? null : (part / whole) * 100;
}

function TempRow({ t, band, max }: { t: Temperature; band: BandLike; max: number }): React.JSX.Element {
  return (
    <Row label={t.label.length > 14 ? `${t.label.slice(0, 13)}…` : t.label}>
      <Ramp value={t.celsius} max={max} band={band} />
      <span className={levelClass(t.celsius, band)}>{formatCelsius(t.celsius)}</span>
      {t.source === 'ACPI' ? <span className="sysmon-dim">motherboard ACPI zone, not the CPU die</span> : null}
    </Row>
  );
}

export function SystemMonitor(): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [snap, setSnap] = useState<HardwareSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Main says when a monitor node was activated. See `openNode` in src/main/ipc.ts.
  useEffect(() => window.skynet.on('monitor:open', (payload) => {
    setTitle(payload.name);
    setOpen(true);
  }), []);

  // Poll only while open. Nothing is read, in either process, while the panel is closed.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      try {
        const next = await window.skynet['hardware:snapshot']();
        if (alive) { setSnap(next); setError(null); }
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
      if (alive) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [open]);

  /*
   * Esc closes, and ONLY closes.
   *
   * Captured on `window` ahead of the board's own listeners and stopped there, because Esc also
   * deselects and, with nothing selected, leaves the room. Closing a panel should not throw you out
   * of the room you were looking at. Scrolling keys are held back from the board the same way while
   * focus is inside the panel, so reading the list does not pan the camera underneath it.
   */
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false);
        return;
      }
      if (panelRef.current?.contains(document.activeElement) && SCROLL_KEYS.has(event.code)) {
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  const s = snap;
  const cpuTemps = s?.temperatures.filter((t) => t.part === 'cpu') ?? [];
  const otherTemps = s?.temperatures.filter((t) => t.part !== 'cpu') ?? [];

  return (
    <div className="sysmon" ref={panelRef} role="dialog" aria-label="System monitor">
      <div className="sysmon-head">
        <span>SYSTEM MONITOR{title ? ` · ${title}` : ''}</span>
        <button ref={closeRef} type="button" className="btn tiny" onClick={() => setOpen(false)}>Close (Esc)</button>
      </div>

      {!s ? (
        <div className="sysmon-body-empty">{error ? <span className="lv-fault">{error}</span> : 'READING THE HARDWARE…'}</div>
      ) : (
        <div className="sysmon-body" tabIndex={0}>
          <section className="sysmon-section">
            <h3>SYSTEM</h3>
            <Row label="OS">{s.system.os ?? '—'} <span className="sysmon-dim">{s.system.osVersion ?? ''}</span></Row>
            <Row label="BOARD">{s.system.board ?? '—'}</Row>
            <Row label="BIOS">{s.system.bios ?? '—'}</Row>
            <Row label="UPTIME">{formatUptime(s.system.bootedAt, s.takenAt)}</Row>
          </section>

          <section className="sysmon-section">
            <h3>CPU · {s.cpu.name ?? 'UNKNOWN'}</h3>
            <Row label="SPEC">
              {s.cpu.coreCount ?? '—'} CORES · {s.cpu.threadCount ?? '—'} THREADS
              {s.cpu.socket ? ` · ${s.cpu.socket}` : ''}
            </Row>
            <Row label="CACHE">
              L2 {formatBytes(s.cpu.l2KB === null ? null : s.cpu.l2KB * 1024)} · L3 {formatBytes(s.cpu.l3KB === null ? null : s.cpu.l3KB * 1024)}
            </Row>
            <Row label="LOAD">
              <Ramp value={s.cpu.usage} max={100} band={BANDS.load} />
              <span className={levelClass(s.cpu.usage, BANDS.load)}>{formatPercent(s.cpu.usage)}</span>
            </Row>
            <Row label="CLOCK">
              {formatMHz(s.cpu.effectiveMHz)}
              <span className="sysmon-dim">
                {s.cpu.performancePct !== null
                  ? ` ${s.cpu.performancePct}% of ${formatMHz(s.cpu.baseMHz)} base${s.cpu.performancePct > 100 ? ', boosting' : ''}`
                  : ''}
              </span>
            </Row>
            {cpuTemps.length
              ? cpuTemps.map((t) => <TempRow key={`${t.source}:${t.label}`} t={t} band={BANDS.cpuTemp} max={110} />)
              : <Row label="TEMP"><Unreadable /></Row>}
            <div className="threads" aria-label="Per-thread load and clock">
              {s.cpu.threads.map((t) => (
                <div className="thread" key={t.index}>
                  <span className="sysmon-dim">T{String(t.index).padStart(2, '0')}</span>
                  <Ramp value={t.usage} max={100} band={BANDS.load} cells={8} />
                  <span className={levelClass(t.usage, BANDS.load)}>{formatPercent(t.usage)}</span>
                  <span className="sysmon-dim">{formatMHz(t.effectiveMHz)}</span>
                </div>
              ))}
            </div>
          </section>

          {s.gpus.map((g) => {
            const tempBand = g.tempC === null ? null : gpuTempBand(g.tempC, g.slowdownMarginC);
            const vram = pct(g.vramUsedMiB, g.vramTotalMiB);
            const power = pct(g.powerW, g.powerLimitW);
            return (
              <section className="sysmon-section" key={g.name}>
                <h3>GPU · {g.name}</h3>
                {g.source === 'wmi' ? (
                  <>
                    <Row label="SENSORS"><Unreadable /></Row>
                    <Row label="DRIVER">{g.driver ?? '—'}{g.resolution ? ` · ${g.resolution}` : ''}</Row>
                  </>
                ) : (
                  <>
                    <Row label="TEMP">
                      {tempBand && g.tempC !== null ? <Ramp value={g.tempC} max={tempBand.max} band={tempBand} /> : null}
                      <span className={tempBand ? levelClass(g.tempC, tempBand) : 'lv-none'}>{formatCelsius(g.tempC)}</span>
                      {g.slowdownMarginC !== null ? <span className="sysmon-dim">{Math.round(g.slowdownMarginC)} °C to slowdown</span> : null}
                    </Row>
                    <Row label="LOAD">
                      <Ramp value={g.usage} max={100} band={BANDS.load} />
                      <span className={levelClass(g.usage, BANDS.load)}>{formatPercent(g.usage)}</span>
                      <span className="sysmon-dim">memory controller {formatPercent(g.memoryControllerUsage)}</span>
                    </Row>
                    <Row label="CLOCK">
                      {formatMHz(g.clockMHz)} <span className="sysmon-dim">of {formatMHz(g.maxClockMHz)} max · memory {formatMHz(g.memoryClockMHz)}</span>
                    </Row>
                    <Row label="VRAM">
                      <Ramp value={vram} max={100} band={BANDS.vram} />
                      <span className={levelClass(vram, BANDS.vram)}>
                        {formatBytes(g.vramUsedMiB === null ? null : g.vramUsedMiB * 1024 * 1024)} / {formatBytes(g.vramTotalMiB === null ? null : g.vramTotalMiB * 1024 * 1024)}
                      </span>
                    </Row>
                    <Row label="POWER">
                      <Ramp value={power} max={100} band={BANDS.power} />
                      <span className={levelClass(power, BANDS.power)}>
                        {g.powerW === null ? '—' : `${g.powerW.toFixed(1)} W`}
                      </span>
                      <span className="sysmon-dim">{g.powerLimitW === null ? '' : `of ${Math.round(g.powerLimitW)} W limit`}</span>
                    </Row>
                    <Row label="FAN">
                      {formatPercent(g.fanPct)}
                      {g.fanPct === 0 ? <span className="sysmon-dim"> stopped (zero-RPM mode)</span> : null}
                    </Row>
                    <Row label="DRIVER">
                      {g.driver ?? '—'}
                      <span className="sysmon-dim">{g.pstate ? ` · ${g.pstate}` : ''}{g.resolution ? ` · ${g.resolution}` : ''}</span>
                    </Row>
                  </>
                )}
              </section>
            );
          })}

          <section className="sysmon-section">
            <h3>MEMORY</h3>
            <Row label="IN USE">
              <Ramp value={pct(s.memory.usedBytes, s.memory.totalBytes)} max={100} band={BANDS.memory} />
              <span className={levelClass(pct(s.memory.usedBytes, s.memory.totalBytes), BANDS.memory)}>
                {formatBytes(s.memory.usedBytes)} / {formatBytes(s.memory.totalBytes)}
              </span>
            </Row>
            {s.memory.modules.map((m) => (
              <Row key={m.slot} label={m.slot.replace(/^Controller(\d+)-/, 'C$1 ')}>
                {formatBytes(m.capacityBytes)} {m.type ?? ''} · {m.configuredMTs ?? '—'} MT/s
                <span className="sysmon-dim">
                  {m.speedMTs !== null && m.speedMTs !== m.configuredMTs ? ` (module reports ${m.speedMTs})` : ''}
                  {` · ${[m.manufacturer, m.partNumber].filter(Boolean).join(' ')}`}
                </span>
              </Row>
            ))}
          </section>

          <section className="sysmon-section">
            <h3>STORAGE</h3>
            {s.disks.map((d) => (
              <div className="disk" key={d.id}>
                <Row label={`DISK ${d.id}`}>
                  {d.model}
                  <span className="sysmon-dim"> {d.media} · {d.bus} · {formatBytes(d.sizeBytes)}{d.letters.length ? ` · ${d.letters.join(' ')}` : ''}</span>
                  <span className={d.health === 'HEALTHY' ? 'lv-ok' : d.health === 'UNKNOWN' ? 'lv-none' : 'lv-fault'}> {d.health}</span>
                </Row>
                <Row label="BUSY">
                  <Ramp value={d.busyPct} max={100} band={BANDS.diskBusy} cells={8} />
                  <span className={levelClass(d.busyPct, BANDS.diskBusy)}>{formatPercent(d.busyPct)}</span>
                  <span className="sysmon-dim">read {formatRate(d.readBps)} · write {formatRate(d.writeBps)}</span>
                </Row>
              </div>
            ))}
            {s.volumes.map((v) => {
              const used = pct(v.sizeBytes - v.freeBytes, v.sizeBytes);
              return (
                <Row key={v.letter} label={v.letter}>
                  <Ramp value={used} max={100} band={BANDS.volume} />
                  <span className={levelClass(used, BANDS.volume)}>{formatBytes(v.freeBytes)} free</span>
                  <span className="sysmon-dim">of {formatBytes(v.sizeBytes)}{v.label ? ` · ${v.label}` : ''}{v.fileSystem ? ` · ${v.fileSystem}` : ''}</span>
                </Row>
              );
            })}
          </section>

          <section className="sysmon-section">
            <h3>THERMAL · FANS</h3>
            {otherTemps.length
              ? otherTemps.map((t) => <TempRow key={`${t.source}:${t.part}:${t.label}`} t={t} band={BANDS.boardTemp} max={100} />)
              : <Row label="TEMPS"><Unreadable /></Row>}
            {s.fans.length
              ? s.fans.map((f) => <Row key={f.label} label={f.label}>{f.rpm} RPM</Row>)
              : <Row label="FANS"><Unreadable /></Row>}
          </section>

          {s.missing.length ? (
            <section className="sysmon-section sysmon-missing">
              <h3>NOT READABLE · {s.missing.length}</h3>
              <ul>
                {s.missing.map((m) => (
                  <li key={m.what}>
                    <span className="sysmon-label">{m.what}</span>
                    <span>{m.why}</span>
                    <span className="sysmon-dim">{m.fix}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      <div className="sysmon-foot">
        {s
          ? `READ FROM ${s.sources.join(' · ')} · SENSORS ${s.ages.sensors === null ? '—' : `${(s.ages.sensors / 1000).toFixed(1)}S`} OLD · NOTHING HERE IS ESTIMATED · BAR OUTLINE = EXPECTED, FILL = NOW`
          : 'THE FIRST READ TAKES A FEW SECONDS: CIM IS SLOW TO WAKE.'}
        {error && s ? <span className="lv-fault"> · LAST REFRESH FAILED: {error}</span> : null}
      </div>
    </div>
  );
}
