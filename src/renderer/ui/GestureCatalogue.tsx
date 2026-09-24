import { useEffect, useState } from 'react';
import {
  MIN_SAMPLES,
  gestureReadiness,
  type FrameCount,
  type GestureDefinition,
  type GestureLibrary,
  type LibraryHealth
} from '@shared/gesture-library.js';
import { useBoardStore } from '../store/useBoardStore.js';

/**
 * The gesture catalogue: what SkynetOS can recognise, what each one means, and how well trained it is.
 *
 * It opens with the built-in vocabulary — cursor, rest, click, double click, drag, right click,
 * zoom in, zoom out, scroll — present from first run and untrained, because a gesture nobody has
 * taught should be visible and obviously unready rather than absent. Each row says how many
 * examples it has out of the four it needs, so "it does not work yet" is a number rather than a
 * mystery.
 *
 * Two things deliberately do NOT live in the camera window. A gesture's WORDS decide what it does —
 * they go through the same grammar as voice — and the number of keyframes decides what shape it is.
 * Both are set here, on the board, where the thing being changed is in front of you. The camera
 * page may add examples and nothing else (VISION_METHODS in packages/shared/ipc.ts).
 */

const shapeOf = (gesture: GestureDefinition): string => {
  if (gesture.frames > 1) return `${gesture.frames} KEYFRAMES`;
  return gesture.kind === 'motion' ? 'HELD + MOVE' : 'POSTURE';
};

const meaningOf = (gesture: GestureDefinition): string => {
  if (gesture.action) return gesture.action.replace(/-/g, ' ');
  return gesture.utterance || 'no words yet';
};

export function GestureCatalogue(): React.JSX.Element {
  const toast = useBoardStore((s) => s.toast);
  const available = typeof window.skynet['gesture:library'] === 'function';
  const [library, setLibrary] = useState<GestureLibrary | null>(null);
  const [name, setName] = useState('');
  const [utterance, setUtterance] = useState('');
  const [frames, setFrames] = useState<FrameCount>(1);
  const [busy, setBusy] = useState(false);
  /**
   * The audit, read alongside the catalogue.
   *
   * William, 2026-09-11: "After the last training most of the gestures don't seem to be working."
   * A count of examples cannot show that, because the count looked fine — every gesture had its
   * four. What had happened was that some of those four would be misread as a different gesture,
   * which is a property of the catalogue as a whole and therefore invisible on any single row.
   */
  const [health, setHealth] = useState<LibraryHealth | null>(null);
  const auditable = typeof window.skynet['gesture:health'] === 'function';

  useEffect(() => {
    if (!available) return;
    let live = true;
    void window.skynet['gesture:library']().then((next) => { if (live) setLibrary(next); }).catch(() => undefined);
    if (auditable) {
      void window.skynet['gesture:health']().then((next) => { if (live) setHealth(next); }).catch(() => undefined);
    }
    return () => { live = false; };
  }, [available, auditable, library?.gestures.length]);

  const repair = async (): Promise<void> => {
    if (busy || !auditable) return;
    setBusy(true);
    const result = await window.skynet['gesture:repair']();
    setLibrary(result.library);
    setHealth(await window.skynet['gesture:health']());
    setBusy(false);
    toast('ok', result.dropped ? `DROPPED ${result.dropped} BAD EXAMPLE${result.dropped === 1 ? '' : 'S'}` : 'NOTHING TO REPAIR');
  };

  const add = async (): Promise<void> => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const result = await window.skynet['gesture:saveGesture']({ name, utterance, frames });
    setBusy(false);
    setLibrary(result.library);
    if (!result.ok) { toast('warn', result.error ?? 'COULD NOT ADD THAT GESTURE'); return; }
    setName('');
    setUtterance('');
    toast('ok', 'GESTURE ADDED — TRAIN IT IN CALIBRATE AND TRAIN');
  };

  const remove = async (id: string, label: string): Promise<void> => {
    // His own catalogue and his own click, which is the approval docs/07 asks for. A built-in
    // refuses and says to switch it off instead, because deleting one only lasts until the next
    // launch.
    const result = await window.skynet['gesture:deleteGesture'](id);
    setLibrary(result.library);
    if (result.ok) toast('ok', `${label} REMOVED`);
    else if (result.error) toast('warn', result.error);
  };

  const setWords = async (gesture: GestureDefinition): Promise<void> => {
    if (gesture.action) {
      toast('warn', `${gesture.name} IS BUILT IN — IT DRIVES ${gesture.action.toUpperCase().replace(/-/g, ' ')}`);
      return;
    }
    const next = window.prompt(`What should ${gesture.name} do? Say it the way you would say it out loud.`, gesture.utterance);
    if (next === null) return;
    const result = await window.skynet['gesture:saveGesture']({ id: gesture.id, name: gesture.name, utterance: next });
    setLibrary(result.library);
    if (!result.ok) toast('warn', result.error ?? 'COULD NOT SAVE');
  };

  const toggle = async (gesture: GestureDefinition): Promise<void> => {
    const result = await window.skynet['gesture:saveGesture']({
      id: gesture.id,
      name: gesture.name,
      utterance: gesture.utterance,
      disabled: !gesture.disabled
    });
    setLibrary(result.library);
    // The switch snaps back to what the library says; without this line, it snapped back in silence.
    if (!result.ok) toast('warn', result.error ?? `COULD NOT SWITCH ${gesture.name} ${gesture.disabled ? 'ON' : 'OFF'} — TRY AGAIN`);
  };

  if (!available) {
    return <div className="look-note">Restart SkynetOS to use the gesture catalogue: the running copy predates it.</div>;
  }

  const untrained = (library?.gestures ?? []).filter((gesture) => gesture.samples.length < MIN_SAMPLES).length;

  return (
    <div className="gesture-catalogue">
      <div className="look-note">
        Every gesture needs {MIN_SAMPLES} examples before it does anything at all
        {untrained ? `, and ${untrained} of these have none yet` : ''}. Teach them in CALIBRATE AND TRAIN.
        A gesture you add yourself stands for words, and those words go through the same grammar your
        voice uses — so it can do anything you could say, and nothing you could not.
      </div>

      {health && !health.ok ? (
        <div className="gesture-alarm">
          <span>{health.note}</span>
          <button type="button" className="btn tiny" disabled={busy} onClick={() => void repair()}>
            REPAIR
          </button>
        </div>
      ) : null}

      {library?.gestures.length ? (
        <div className="gesture-rows">
          {library.gestures.map((gesture) => {
            const ready = gestureReadiness(gesture).ready;
            const row = health?.gestures.find((entry) => entry.id === gesture.id);
            const sick = row ? row.faults.some((fault) => fault.severity === 'drop') : false;
            // Alternative takes, counted separately: "4/4 +3" says trained, and widened.
            const variants = gesture.samples.filter((sample) => sample.variant).length;
            return (
              <div key={gesture.id} className={gesture.disabled ? 'gesture-row off' : 'gesture-row'}>
                <span className="gesture-name">{gesture.name}</span>
                <span className="gesture-shape">{shapeOf(gesture)}</span>
                <button
                  type="button"
                  className={gesture.action ? 'gesture-words built' : 'gesture-words'}
                  onClick={() => void setWords(gesture)}
                  title={gesture.action ? 'Built in: what it does is fixed.' : 'What this gesture says. Click to change it.'}
                >
                  {meaningOf(gesture)}
                </button>
                <span
                  className={sick ? 'gesture-count warn' : ready ? 'gesture-count ok-text' : 'gesture-count warn'}
                  title={row?.note ?? ''}
                >
                  {gesture.samples.length}/{MIN_SAMPLES}
                  {variants ? ` +${variants}` : ''}
                </span>
                <button
                  type="button"
                  className="btn tiny"
                  onClick={() => void toggle(gesture)}
                  title={gesture.disabled ? 'Switch this gesture back on' : 'Park this gesture without deleting it'}
                >
                  {gesture.disabled ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  className="btn tiny"
                  disabled={gesture.builtIn === true}
                  title={gesture.builtIn ? 'Built in — switch it off instead' : 'Remove this gesture and its examples'}
                  onClick={() => void remove(gesture.id, gesture.name)}
                >
                  DELETE
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="look-note">No gestures yet.</div>
      )}

      <div className="gesture-add">
        <input
          className="input"
          id="gesture-new-name"
          value={name}
          placeholder="THUMBS UP"
          maxLength={32}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="input"
          id="gesture-new-words"
          value={utterance}
          placeholder="undo"
          maxLength={120}
          onChange={(event) => setUtterance(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void add(); }}
        />
        {/*
          * How many keyframes, chosen at creation and fixed afterwards: changing it would invalidate
          * every example already recorded. One is a pose held still; two or three is a movement,
          * captured and performed in order.
          */}
        <select
          className="input"
          id="gesture-new-frames"
          value={frames}
          title="One keyframe is a pose held still. Two or three make a movement, captured in order."
          onChange={(event) => setFrames(Number(event.target.value) as FrameCount)}
        >
          <option value={1}>1 keyframe · a pose</option>
          <option value={2}>2 keyframes · a move</option>
          <option value={3}>3 keyframes · a move through</option>
        </select>
        <button type="button" className="btn" disabled={!name.trim() || busy} onClick={() => void add()}>ADD</button>
      </div>
    </div>
  );
}
