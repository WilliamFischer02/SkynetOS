import qrcode from 'qrcode-generator';

/**
 * A QR code as a grid of dark and light modules, for the pairing URL.
 *
 * Encoded by `qrcode-generator` (zero dependencies, MIT), at error correction level M, with the
 * smallest version that fits. Drawn by the caller as whole-pixel squares, like everything else on
 * this app's screen. test/qr.test.ts decodes what this produces with an independent decoder (jsQR),
 * so "it scans" is checked rather than assumed.
 */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

/** RGBA pixels for a matrix: `scale` px per module and a 4-module quiet zone, as a scanner expects. */
export function qrPixels(matrix: readonly boolean[][], scale = 4): { data: Uint8ClampedArray; width: number; height: number } {
  const quiet = 4;
  const n = matrix.length;
  const size = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r]![c]) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
          data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
        }
      }
    }
  }
  return { data, width: size, height: size };
}
