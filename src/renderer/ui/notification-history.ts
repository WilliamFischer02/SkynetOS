/**
 * The notification centre's history: every toast, kept after it fades.
 *
 * William asked for commercial-app polish; the most basic piece of it is that a message you looked
 * away from is not simply gone. Toasts still fade after a few seconds, but each one is also kept
 * here, newest first, and the HUD's bell counts the unread ones.
 *
 * Pure. The same toast repeated within a few seconds is one entry with a count, so a noisy fault
 * does not push everything else off the list.
 */

export type NotificationLevel = 'ok' | 'warn' | 'fault';

export interface NotificationEntry {
  id: number;
  level: NotificationLevel;
  text: string;
  /** Epoch ms of the latest occurrence. */
  at: number;
  /** How many times it came, when repeats were merged. */
  count: number;
  read: boolean;
}

export const NOTIFICATION_CAP = 100;
/** Repeats closer together than this merge into one entry. */
export const MERGE_WINDOW_MS = 5000;

export function pushNotification(
  list: readonly NotificationEntry[],
  next: { id: number; level: NotificationLevel; text: string; at: number },
  cap = NOTIFICATION_CAP
): NotificationEntry[] {
  const head = list[0];
  if (head && head.level === next.level && head.text === next.text && next.at - head.at <= MERGE_WINDOW_MS) {
    return [{ ...head, at: next.at, count: head.count + 1, read: false }, ...list.slice(1)];
  }
  return [{ ...next, count: 1, read: false }, ...list].slice(0, cap);
}

export function unreadCount(list: readonly NotificationEntry[]): number {
  return list.reduce((n, e) => n + (e.read ? 0 : 1), 0);
}

export function markAllRead(list: readonly NotificationEntry[]): NotificationEntry[] {
  return list.some((e) => !e.read) ? list.map((e) => (e.read ? e : { ...e, read: true })) : [...list];
}
