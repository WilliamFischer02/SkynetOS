/**
 * The hand's cursor, drawn the way a mouse pointer is: a classic arrow, and a closed hand while something is held.
 *
 * William, 2026-09-12: "replace the cursor crosshair thing with a classic windows mouse ui, retro, and
 * replace click and drag cursor with the closed hand."
 *
 * Bitmaps, like the icon set (Icon.tsx), drawn as whole-pixel SVG rects at the chrome's pixel scale, so they
 * are crisp at every size and never fall back to a system cursor. Two colours rather than the icons' one —
 * `#` the outline and `o` the fill — because a pointer has to read on a dark board and on a light panel
 * alike, which is why the Windows arrow is black edged in white. Both are palette tokens: mask-dark and silk.
 */

export interface CursorSprite {
  rows: readonly string[];
  /** The pixel that IS the pointer: where a click lands. */
  hotspot: { x: number; y: number };
}

/** The Windows 3.1 arrow, 12 by 19. The hotspot is its tip. */
export const CURSOR_ARROW: CursorSprite = {
  rows: [
    '#...........',
    '##..........',
    '#o#.........',
    '#oo#........',
    '#ooo#.......',
    '#oooo#......',
    '#ooooo#.....',
    '#oooooo#....',
    '#ooooooo#...',
    '#oooooooo#..',
    '#ooooooooo#.',
    '#oooooo#####',
    '#ooo#oo#....',
    '#oo##oo#....',
    '#o#..#oo#...',
    '##...#oo#...',
    '#.....#oo#..',
    '......#oo#..',
    '.......##...'
  ],
  hotspot: { x: 0, y: 0 }
};

/** A closed hand, knuckles up and thumb tucked, 16 by 16. The hotspot is the middle of the palm. */
export const CURSOR_GRAB: CursorSprite = {
  rows: [
    '................',
    '................',
    '................',
    '................',
    '....##.##.##....',
    '...#oo#oo#oo##..',
    '...#oooooooo#o#.',
    '..##oooooooooo#.',
    '.#o#oooooooooo#.',
    '.#oooooooooooo#.',
    '..#ooooooooooo#.',
    '...#ooooooooo#..',
    '....#oooooooo#..',
    '.....#oooooo#...',
    '.....#oooooo#...',
    '.....########...'
  ],
  hotspot: { x: 8, y: 9 }
};

/** Runs of one character along each row, so a sprite is a few dozen rects rather than a few hundred. */
export function runsOf(rows: readonly string[], lit: string): { x: number; y: number; w: number }[] {
  const runs: { x: number; y: number; w: number }[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== lit) {
        x++;
        continue;
      }
      const from = x;
      while (x < row.length && row[x] === lit) x++;
      runs.push({ x: from, y, w: x - from });
    }
  });
  return runs;
}

const SVG = 'http://www.w3.org/2000/svg';

function spriteSvg(sprite: CursorSprite, className: string): SVGSVGElement {
  const width = sprite.rows[0]!.length;
  const height = sprite.rows.length;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.width = `calc(${width} * var(--p))`;
  svg.style.height = `calc(${height} * var(--p))`;
  // Drawn so the hotspot, not the corner, sits on the point the element is moved to.
  svg.style.marginLeft = `calc(${-sprite.hotspot.x} * var(--p))`;
  svg.style.marginTop = `calc(${-sprite.hotspot.y} * var(--p))`;
  // Inline style rather than the `fill` attribute: presentation attributes do not resolve CSS variables.
  for (const [lit, colour] of [['o', 'var(--silk)'], ['#', 'var(--mask-dark)']] as const) {
    for (const run of runsOf(sprite.rows, lit)) {
      const rect = document.createElementNS(SVG, 'rect');
      rect.setAttribute('x', String(run.x));
      rect.setAttribute('y', String(run.y));
      rect.setAttribute('width', String(run.w));
      rect.setAttribute('height', '1');
      rect.style.fill = colour;
      svg.append(rect);
    }
  }
  return svg;
}

/** The pointer element: both sprites, one shown at a time by `data-grabbing` (chrome.css). */
export function cursorElement(): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'gesture-cursor';
  element.append(spriteSvg(CURSOR_ARROW, 'cursor-arrow'), spriteSvg(CURSOR_GRAB, 'cursor-grab'));
  return element;
}
