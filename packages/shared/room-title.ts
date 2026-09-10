/**
 * Room titles, and the OS that is always on the end of them.
 *
 * William: "I want only the text before 'OS' to be editable so that it automatically appends
 * '-OS' to a drive / room name."
 *
 * So a `drive.room` node stores the STEM — `Minecraft`, `Story`, `Game` — and the board prints
 * `MinecraftOS`, with the `OS` drawn smaller, darker and outlined. The stem is a normal editable
 * name with every text option any other node has; the suffix is not editable because it is not
 * data, it is a convention.
 *
 * ── The one thing that could not be done as asked ─────────────────────────────────────────────
 *
 * "about 75% the title text" is not available. Departure Mono is a PIXEL font and is exact at 11px
 * and 22px only (docs/02); 75% of 11 is 8.25, which would be rendered by scaling a bitmap by a
 * fraction — the precise thing docs/02 anti-mush calls a crash-severity bug. The suffix therefore
 * steps DOWN one size where there is one to step down to (22 -> 11, which is 50%) and otherwise
 * stays at 11 and relies on colour and outline to read as subordinate. `SUFFIX_SIZE` below is the
 * whole of that decision.
 */

/** What every room's title ends in. Not stored on the node; appended at draw time. */
export const ROOM_SUFFIX = 'OS';

/**
 * Strip the suffix from a stored name, for editing.
 *
 * Tolerant on the way in because the seeded boards were written before this existed and hold
 * `MinecraftOS`, `StoryOS` and so on. Editing one of those shows `Minecraft` and saves `Minecraft`,
 * so the migration happens by touching a node rather than by a script.
 */
export function roomStem(name: string): string {
  return name.replace(/[\s_-]*OS\s*$/i, '').trim();
}

/** The full printed title for a room: the stem, then the suffix. */
export function roomTitle(name: string): { stem: string; suffix: string } {
  const stem = roomStem(name);
  return { stem: stem || name.trim(), suffix: ROOM_SUFFIX };
}

/**
 * The suffix's size, given the title's.
 *
 * One step down the two pixel-exact sizes this font has. See the header for why it is not 75%.
 */
export function suffixSize(titleSize: 11 | 22): 11 | 22 {
  return titleSize === 22 ? 11 : 11;
}

/**
 * True when the suffix will render visibly smaller than the title.
 *
 * The editor says so, because at 11px it will NOT — and a control that silently does nothing is
 * worse than one that explains itself.
 */
export function suffixIsSmaller(titleSize: 11 | 22): boolean {
  return titleSize === 22;
}
