import { describe, expect, it } from 'vitest';
import { auditSource, auditUi } from '../tools/tooltip-audit.mjs';

/*
 * Every control in the chrome says what the user does, on hover (the 2026-09-27 UX pass). The
 * audit is regex-level (tools/tooltip-audit.mjs); these check that it reads a tag the way a person
 * would, and that src/renderer/ui stays at zero.
 */
describe('tooltip audit', () => {
  it('finds a button, a select, a checkbox, a range and a role=button, and nothing else', () => {
    const found = auditSource(`
      <div>
        <button type="button" onClick={() => go()}>GO</button>
        <select value={v}><option>a</option></select>
        <input type="checkbox" checked={on} />
        <input type="range" min={0} max={9} />
        <input type="text" />
        <span role="button" tabIndex={0}>x</span>
        <span className="plain">y</span>
      </div>`);
    expect(found.map((control) => control.kind)).toEqual(['button', 'select', 'input checkbox', 'input range', 'span role=button']);
    expect(found.every((control) => !control.ok)).toBe(true);
  });

  it('reads past an arrow function and a template literal to the end of the tag', () => {
    const [control] = auditSource(
      '<button type="button" onClick={() => { if (a > b) run(`${a > b}`); }} title="Run the thing">RUN</button>'
    );
    expect(control?.ok).toBe(true);
  });

  it('does not take a title inside an expression, or on a child, as the control’s own', () => {
    const [inner, child] = [
      auditSource('<button type="button" onClick={() => open({ title: "x" })}>OPEN</button>')[0],
      auditSource('<button type="button"><Icon name="close" title="Close" /></button>')[0]
    ];
    expect(inner?.ok).toBe(false);
    expect(child?.ok).toBe(false);
  });

  it('wants a title beside an aria-label, because the label does not show on hover', () => {
    const [control] = auditSource('<button type="button" aria-label="Remove">×</button>');
    expect(control?.ok).toBe(false);
    expect(control?.reason).toBe('aria-label but no title');
  });

  it('ignores a control written in a comment', () => {
    expect(auditSource('/* <button>OLD</button> */\n// <button>ALSO OLD</button>\n')).toEqual([]);
  });

  it('src/renderer/ui has no control without a tooltip', () => {
    const { controls, missing } = auditUi();
    expect(controls.length).toBeGreaterThan(100);
    expect(missing.map((control) => `${control.file}:${control.line} ${control.kind}`)).toEqual([]);
  });
});
