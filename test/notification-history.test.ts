import { describe, expect, it } from 'vitest';
import { markAllRead, pushNotification, unreadCount, type NotificationEntry } from '../src/renderer/ui/notification-history.js';

describe('notification history', () => {
  it('keeps the newest first', () => {
    let list: NotificationEntry[] = [];
    list = pushNotification(list, { id: 1, level: 'ok', text: 'one', at: 1000 });
    list = pushNotification(list, { id: 2, level: 'warn', text: 'two', at: 2000 });
    expect(list.map((e) => e.text)).toEqual(['two', 'one']);
  });

  it('merges a repeat within a few seconds into one entry with a count', () => {
    let list: NotificationEntry[] = [];
    list = pushNotification(list, { id: 1, level: 'fault', text: 'same', at: 1000 });
    list = pushNotification(list, { id: 2, level: 'fault', text: 'same', at: 3000 });
    expect(list).toHaveLength(1);
    expect(list[0]!.count).toBe(2);
    list = pushNotification(list, { id: 3, level: 'fault', text: 'same', at: 30_000 });
    expect(list).toHaveLength(2);
  });

  it('caps the list', () => {
    let list: NotificationEntry[] = [];
    for (let i = 0; i < 20; i++) list = pushNotification(list, { id: i, level: 'ok', text: `n${i}`, at: i * 10_000 }, 5);
    expect(list).toHaveLength(5);
    expect(list[0]!.text).toBe('n19');
  });

  it('counts and clears unread', () => {
    let list: NotificationEntry[] = [];
    list = pushNotification(list, { id: 1, level: 'ok', text: 'a', at: 0 });
    list = pushNotification(list, { id: 2, level: 'ok', text: 'b', at: 10_000 });
    expect(unreadCount(list)).toBe(2);
    list = markAllRead(list);
    expect(unreadCount(list)).toBe(0);
    // A merged repeat is news again.
    list = pushNotification(list, { id: 3, level: 'ok', text: 'b', at: 11_000 });
    expect(unreadCount(list)).toBe(1);
  });
});
