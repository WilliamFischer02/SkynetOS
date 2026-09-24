import { GestureCatalogue } from './GestureCatalogue.js';
import { useBoardStore } from '../store/useBoardStore.js';

/**
 * Video: the cameras, and everything gesture control needs from them.
 *
 * These used to sit under SYSTEM beside "start with Windows", which was the wrong home for them:
 * they are not machine switches, they are a device and its calibration. Here the order matches the
 * order of doing it — switch the cameras on, see what they see, aim and train them, then look at
 * what has been trained.
 */
export function VideoSettings(): React.JSX.Element {
  const gesture = useBoardStore((s) => s.gestureStatus);
  const setGestureEnabled = useBoardStore((s) => s.setGestureEnabled);
  const available = typeof window.skynet['gesture:setEnabled'] === 'function';

  if (!available) {
    return <div className="look-note">Restart SkynetOS to see the video settings: the running copy predates them.</div>;
  }

  return (
    <>
      <label className="look-check">
        <input
          type="checkbox"
          checked={gesture.phase !== 'off'}
          onChange={(event) => void setGestureEnabled(event.target.checked)}
        />
        Manual control (cameras)
      </label>
      <div className="look-note">
        {gesture.error
          ? gesture.error
          : gesture.phase === 'off'
            ? 'Two cameras watch a volume of air above the keyboard. A small monitor appears in the corner while they are on, so it is never a question whether they are running. Also on the board itself, and by voice: “hey JARVIS, give me manual control”.'
            : 'The monitor in the corner shows both angles and what is being recognised. Click it off here, on the board, or say “manual controls off”.'}
      </div>

      {gesture.cameras.length ? (
        <div className="gesture-rows">
          {gesture.cameras.map((camera) => (
            <div key={camera.label} className="setting-row">
              <span>{camera.label.replace(/\s*\(.*\)\s*$/, '')}</span>
              <span className={camera.error ? 'value warn' : camera.seeing ? 'value ok-text' : 'value'}>
                {camera.error ? camera.error : `${camera.fps} fps${camera.seeing ? ' · hand in view' : ''}`}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className="btn"
        onClick={() => void window.skynet['gesture:train'](true)}
        title="Aim the cameras, learn how far you reach, then refresh the examples for every gesture. Nothing is recorded until you press START, and no picture is ever saved."
      >
        CALIBRATE AND TRAIN GESTURES
      </button>
      <div className="look-note">
        Three steps: aim the cameras level with each other, sweep the area you want to use so the
        pointer matches your actual reach, then record examples of each gesture. Nothing is captured
        before you press START, and an example is 42 numbers describing your hand — never a picture.
      </div>

      <GestureCatalogue />
    </>
  );
}
