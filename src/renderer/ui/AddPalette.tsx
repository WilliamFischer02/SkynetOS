import { useEffect, useRef, useState } from 'react';
import { DECOR_PARTS, NODE_KINDS, type DecorPart, type NodeKind } from '@shared/types.js';
import atlasUrl from '../../../assets/atlas/skynet.json?url';
import atlasImageUrl from '../../../assets/atlas/skynet.png?url';
import { COMPONENT_STYLE, drawComponent } from '../board/component-art.js';
import { useBoardStore } from '../store/useBoardStore.js';

/**
 * The add-component palette. `N` in Edit Board mode.
 *
 * Until now the only way to put something on a board was to drag a real file onto it. That works
 * for the things that ARE files, and not at all for the sorting furniture — a `group.zone` bracket
 * and a `note.silk` heading correspond to nothing on disk, so the brackets around MinecraftOS's
 * mod clusters were fixtures of a JSON file you had to hand-edit. William wants to add subsections
 * as he adds mods; this is that.
 *
 * Each entry draws its actual silhouette, from the same `drawComponent` the board uses, so you are
 * picking a shape you will recognise rather than reading a list of type names.
 */

/** Reading order: the things with jurisdiction, then storage, then files, then the furniture. */
const ORDER: NodeKind[] = [
  'group.zone', 'note.silk', 'decor.image',
  // decor.part is deliberately absent: it is placed from the PARTS section below, where you pick
  // WHICH part. A generic "BOARD PART" button that always makes a via would be a worse control.
  'agent.code', 'agent.chat', 'agent.jarvis',
  'drive.room',
  'store.repo', 'store.folder', 'store.cloud',
  'file.document', 'file.artifact', 'file.exe',
  'link.url', 'service.process', 'task.scheduled', 'monitor.system'
];

const BLURB: Record<NodeKind, string> = {
  'group.zone': 'A bracket printed around a cluster. Add one per subsection — a mod family, a phase. Resize it to fit; it never collides with anything.',
  'note.silk': 'Text engraved on the substrate. Headings and reminders.',
  'decor.part': 'Board furniture: vias, screws, junctions, grilles, pad arrays and indicator lamps. Real tilesheet cells, recoloured to the locked palette. Pick a specific one from the PARTS row below.',
  'decor.image': 'A picture behind everything. Any image on disk, dithered to the room’s six colours, resizable to fill as much of the board as you like. It never collides and never steals a click while you are browsing.',
  'agent.code': 'A Claude Code chip. Opens a real terminal in a repo, on its own conversation.',
  'agent.chat': 'A claude.ai conversation in its own window.',
  'agent.jarvis': 'The Face: the persistent conversation with board-wide jurisdiction.',
  'drive.room': 'A drive you descend into. Holds another board.',
  'store.repo': 'A git repository on this disk.',
  'store.folder': 'Any folder on this disk.',
  'store.cloud': 'A cloud folder, with an optional local mirror.',
  'file.document': 'One document. Opens with whatever Windows uses for it.',
  'file.artifact': 'A build output, matched by glob so it always points at the newest one.',
  'file.exe': 'A program. Confirms before it launches.',
  'link.url': 'A bookmark. Opens in your browser.',
  'service.process': 'A long-running local process. Starts and stops from the board.',
  'task.scheduled': 'A cron entry.',
  'monitor.system': 'A PSU block showing machine telemetry.'
};

const LABEL: Record<NodeKind, string> = {
  'group.zone': 'CLUSTER BRACKET',
  'note.silk': 'SILKSCREEN NOTE',
  'decor.image': 'BACKDROP IMAGE',
  'decor.part': 'BOARD PART',
  'agent.code': 'CLAUDE CODE CHIP',
  'agent.chat': 'CONVERSATION',
  'agent.jarvis': 'JARVIS HEAD',
  'drive.room': 'ROOM DRIVE',
  'store.repo': 'REPOSITORY',
  'store.folder': 'FOLDER',
  'store.cloud': 'CLOUD STORE',
  'file.document': 'DOCUMENT',
  'file.artifact': 'BUILD CARTRIDGE',
  'file.exe': 'PROGRAM',
  'link.url': 'LINK JACK',
  'service.process': 'SERVICE',
  'task.scheduled': 'SCHEDULED TASK',
  'monitor.system': 'SYSTEM MONITOR'
};

/** What each part is, in one line. Shown on hover. */
const PART_BLURB: Record<DecorPart, string> = {
  via: 'Plated through-hole. The most useful filler on a board — scatter them.',
  screw: 'Mounting screw. Put them in the corners of a cluster.',
  testpoint: 'A test point with one stub.',
  junction: 'Fat four-way trace junction.',
  elbow: 'Fat trace elbow.',
  tee: 'Fat trace tee.',
  junction_thin: 'Thin four-way junction.',
  elbow_thin: 'Thin elbow.',
  grille: 'Lattice — reads as a heatsink grille.',
  pads: 'Scattered pad array.',
  padgrid: 'Dense dotted pad grid, BGA-ish.',
  fins: 'Heatsink fins, seen from above.',
  cap: 'Electrolytic capacitor, seen from above.',
  ribbon: 'Ribbon cable end.',
  fiducial: 'Corner registration mark. Real boards have these.',
  panel: 'A small blank display panel.',
  led_ok: 'Green indicator lamp. Pulses.',
  led_warn: 'Amber indicator lamp. Pulses.',
  led_fault: 'Red indicator lamp. Pulses.',
  led_idle: 'Copper indicator lamp, unlit-looking. Pulses.',
  led_white: 'White indicator lamp. Pulses.'
};

interface AtlasFrames {
  meta: { image: string };
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
}

/**
 * One part swatch: the ACTUAL baked sprite, blitted out of the atlas at 3x.
 *
 * Not a redrawing of it. A palette that shows an approximation of what you are about to place is
 * a palette you stop trusting the first time the two differ — and these came out of a tilesheet
 * through a recolouring pipeline, so an approximation would differ.
 */
function PartSwatch({ part, atlas, image }: { part: DecorPart; atlas: AtlasFrames | null; image: HTMLImageElement | null }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !atlas || !image) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const key = `decor.${part}`;
    const entry = atlas.frames[key] ?? atlas.frames[`${key}#0`];
    if (!entry) return;
    const { x, y, w, h } = entry.frame;
    ctx.drawImage(image, x, y, w, h, 0, 0, canvas.width, canvas.height);
  }, [part, atlas, image]);

  return <canvas className="part-swatch" ref={ref} width={16} height={16} />;
}

/** One swatch: the kind's real silhouette, drawn at 3x into a small canvas. */
function KindSwatch({ kind, maskLight, signal }: { kind: NodeKind; maskLight: string; signal: string }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Printed kinds have no package to draw, so they get their own mark rather than an empty box.
    if (kind === 'decor.image') {
      // A picture frame with a horizon: says "image" without borrowing any vendor art.
      ctx.fillStyle = maskLight;
      ctx.fillRect(2, 2, 28, 20);
      ctx.fillStyle = signal;
      ctx.fillRect(2, 14, 28, 8);
      ctx.fillRect(2, 2, 28, 1);
      ctx.fillRect(2, 21, 28, 1);
      ctx.fillRect(2, 2, 1, 20);
      ctx.fillRect(29, 2, 1, 20);
      ctx.fillRect(8, 8, 4, 4);
      return;
    }
    if (kind === 'group.zone' || kind === 'note.silk') {
      ctx.fillStyle = signal;
      if (kind === 'group.zone') {
        // Corner brackets, which is exactly how a zone renders on the board.
        for (const [x, y, w, h] of [[0, 0, 8, 1], [0, 0, 1, 6], [24, 0, 8, 1], [31, 0, 1, 6],
          [0, 23, 1, 1], [0, 18, 1, 6], [31, 18, 1, 6], [0, 23, 8, 1], [24, 23, 8, 1]]) {
          ctx.fillRect(x as number, y as number, w as number, h as number);
        }
      } else {
        for (const [y, w] of [[8, 26], [12, 18], [16, 22]]) ctx.fillRect(3, y as number, w as number, 2);
      }
      return;
    }
    drawComponent(
      { ctx, x: 0, y: 0, w: 32, h: 24, maskLight, signal },
      COMPONENT_STYLE[kind] ?? { silhouette: 'plain', inset: 2 }
    );
  }, [kind, maskLight, signal]);

  return <canvas className="palette-swatch" ref={ref} width={32} height={24} />;
}

export function AddPalette(): React.JSX.Element | null {
  const [atlas, setAtlas] = useState<AtlasFrames | null>(null);
  const [atlasImage, setAtlasImage] = useState<HTMLImageElement | null>(null);
  const open = useBoardStore((s) => s.paletteOpen);
  const setOpen = useBoardStore((s) => s.setPaletteOpen);
  const mode = useBoardStore((s) => s.mode);
  const board = useBoardStore((s) => s.board);
  const addNode = useBoardStore((s) => s.addNode);

  // Leaving Edit Board mode closes the palette: adding components is an editing act, and a
  // floating panel that outlives the mode it belongs to is a panel you have to dismiss.
  useEffect(() => {
    if (mode !== 'edit' && open) setOpen(false);
  }, [mode, open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); setOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // The atlas, once, the first time the palette opens. An empty or missing one is a normal state
  // — the parts section simply shows nothing rather than the whole panel failing.
  useEffect(() => {
    if (!open || atlas) return;
    let live = true;
    void (async () => {
      try {
        const response = await fetch(atlasUrl);
        const data = await response.json() as AtlasFrames;
        const img = new Image();
        // Same reason as the renderer: the emitted PNG is at a hashed path, not next to the JSON.
        img.src = atlasImageUrl;
        await img.decode();
        if (!live) return;
        setAtlas(data);
        setAtlasImage(img);
      } catch (err) {
        console.warn('[atlas] palette could not load the atlas', err);
      }
    })();
    return () => { live = false; };
  }, [open, atlas]);

  if (!open || !board) return null;

  /*
   * Placed near the middle of the board rather than the middle of the VIEW.
   *
   * The palette does not know where the camera is — it is chrome, and the camera lives in the
   * canvas. Main then finds the nearest free space from here, so a busy board still lands the
   * node somewhere sensible instead of refusing.
   */
  const drop = { x: Math.floor(board.grid.width / 2), y: Math.floor(board.grid.height / 2) };

  return (
    <div className="palette">
      <div className="palette-head">
        <span>ADD COMPONENT</span>
        <button type="button" className="btn tiny" onClick={() => setOpen(false)}>Close (Esc)</button>
      </div>

      <div className="palette-grid">
        {ORDER.filter((k) => NODE_KINDS.includes(k)).map((kind) => (
          <button
            type="button"
            className="palette-item"
            key={kind}
            title={`${LABEL[kind]} — ${BLURB[kind]}`}
            onClick={() => void addNode(kind, drop)}
          >
            <KindSwatch kind={kind} maskLight={board.theme.maskLight} signal={board.theme.signal} />
            <span className="palette-label">{LABEL[kind]}</span>
            <span className="palette-kind">{kind}</span>
          </button>
        ))}
      </div>

      {atlas ? (
        <div className="palette-parts">
          <div className="palette-parts-head">
            BOARD PARTS
            <span className="palette-parts-note">
              real tilesheet cells, recoloured by the bake pipeline — click to place one
            </span>
          </div>
          <div className="palette-parts-grid">
            {DECOR_PARTS.filter((part) => atlas.frames[`decor.${part}`] ?? atlas.frames[`decor.${part}#0`]).map((part) => (
              <button
                type="button"
                className="part-item"
                key={part}
                title={`${part} — ${PART_BLURB[part]}`}
                onClick={() => void addNode('decor.part', drop, { part })}
              >
                <PartSwatch part={part} atlas={atlas} image={atlasImage} />
                <span className="part-name">{part.replace(/_/g, ' ')}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="palette-foot">
        Everything arrives unbound and provisional — an unpopulated footprint until you point it at
        something real. The editor opens on whatever you add.
      </div>
    </div>
  );
}
