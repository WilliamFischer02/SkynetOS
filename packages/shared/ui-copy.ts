/**
 * Microcopy rules the chrome shares, so a failure reads the same in every panel.
 *
 * docs/02 § Writing on the board, and the persona's knowledge profile (jarvis-voice.md § 3.3):
 * an error says what happened and what to do, in that order, and a label names what the user
 * does. These helpers make the shape hard to get wrong from a `.tsx` that cannot be unit-tested
 * (docs/06 "Known issues" 10): the words are tested here.
 */

/** Strip trailing full stops, dashes and spaces so two fragments join with one separator. */
function trimEnd(text: string): string {
  return text.replace(/[\s.—–-]+$/u, '').trim();
}

/**
 * `WHAT FAILED — WHAT TO DO`. The first half is the error the other side gave, or `fallback`
 * when it gave none; the second is always present, because a failure line that ends without an
 * action is the thing docs/06 item 15 lists.
 */
export function failureLine(error: string | undefined | null, fallback: string, action: string): string {
  const what = trimEnd((error && error.trim()) || fallback);
  const next = trimEnd(action);
  if (!next) return what.toUpperCase();
  // The error may already end in the same instruction; do not say it twice.
  if (what.toUpperCase().endsWith(next.toUpperCase())) return what.toUpperCase();
  return `${what} — ${next}`.toUpperCase();
}

/** The close hint every panel head carries: `Close (Esc)`, or the panel's own key. */
export function closeLabel(key = 'Esc'): string {
  return `Close (${key})`;
}

/**
 * A tooltip for a status chip: the state's instruction always survives, and an error, when there
 * is one, comes first. docs/06 item 14: the MANUAL chip used to drop "click to switch manual
 * control off" whenever it had an error to show.
 */
export function chipTitle(error: string | undefined | null, detail: string, instruction: string): string {
  const lead = (error && error.trim()) || detail.trim();
  return lead ? `${trimEnd(lead)} — ${instruction}` : instruction;
}
