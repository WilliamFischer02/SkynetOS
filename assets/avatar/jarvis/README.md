# JARVIS avatar frames

Drop PNG frames in this folder. SkynetOS watches it, so new or changed frames show up in the
avatar window (and on U1, if its logo is set to the avatar) without a restart.

## The files

| File | Needed | What it is |
|---|---|---|
| `idle.png` | **yes** | The still face: mouth closed, eyes open. Shown whenever JARVIS is not talking. |
| `blink-01.png`, `blink-02.png`, … | optional | Eyes closing, ending fully closed. Played forward then back, so the eyes open again by themselves. Two or three frames is plenty. |
| `talk-01.png`, `talk-02.png`, … | optional, but it is the point | Mouth poses, cycled while JARVIS is responding or working. Four to eight frames; mix open, half and closed shapes so it does not look like a metronome. |
| `avatar.json` | optional | Timing overrides (below). |

Names are forgiving: `talk01.png`, `talk_01.png` and `TALK-01.PNG` all work. Frames play in number
order, and gaps are fine. Anything else in the folder is listed as a warning and ignored.

## Rules

- **Every frame the same size** as `idle.png`. A frame that differs is skipped with a warning.
- **PNG, with transparency** around the head. The window behind the face is the room's dark mask.
- **Draw at 1x.** The window scales by whole numbers only, nearest neighbour, so pixel art stays
  crisp (docs/02). About 48 to 128 px square suits the default window.
- **Keep the head in the same place in every frame.** Only the mouth and eyes should change. The
  floating bob is added by SkynetOS, so do not draw it in.

## avatar.json (all optional)

```json
{
  "talkFps": 8,
  "blinkEveryMs": [2500, 6000],
  "blinkFrameMs": 60,
  "wobblePx": 2,
  "wobblePeriodMs": 2400,
  "scale": 0
}
```

- `talkFps`: mouth frames per second while talking.
- `blinkEveryMs`: a blink comes at an irregular interval between these two numbers.
- `blinkFrameMs`: how long each blink frame is held.
- `wobblePx`: how far the head floats up and down, in the frame's own pixels. `0` switches it off.
- `wobblePeriodMs`: one full float.
- `scale`: `0` picks the largest whole scale that fits the window.

## Where the face appears

- A **tethered avatar window** beside every JARVIS window: the web Face and JARVIS Prime
  terminals. It comes to the front, hides and closes with the window it belongs to. It talks
  while JARVIS responds, and holds still and blinks otherwise.
- **U1's logo**, if the node's *Logo source* is set to the avatar. To switch it on: select U1,
  press F2, open Appearance, and set *Logo source*:
  - **JARVIS face (still)** (`avatar`): the still face, dithered onto the room's palette like every
    other logo.
  - **JARVIS face (animated)** (`avatar-live`): the avatar window's box on the node, in these
    frames' own colours. It floats, blinks, and talks while that node's JARVIS responds, even with
    the face windows switched off. *Logo scale* sets the size of the box.

  `none` removes the logo; `file` goes back to the Logo image. This works on any node, not only U1.

## Note

This repository is public. Frames placed here are committed with it.
