import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { qrMatrix, qrPixels } from '../packages/shared/qr.js';

/**
 * The pairing QR, decoded by a second, independent implementation. If jsQR can read it back, a
 * phone camera can: this is the check that "scan to pair" is real rather than decorative.
 */
describe('qr', () => {
  for (const text of [
    'http://127.0.0.1:47821/#pair=ABCDEFGH',
    'https://william-desktop.tail1234.ts.net/#pair=K7M2-PQ9X'
  ]) {
    it(`round-trips ${text}`, () => {
      const matrix = qrMatrix(text);
      expect(matrix.length).toBeGreaterThanOrEqual(21);
      expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
      const { data, width, height } = qrPixels(matrix, 4);
      const decoded = jsQR(data, width, height);
      expect(decoded?.data).toBe(text);
    });
  }
});
