import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NODE_KINDS, displayOf, type BoardNode, type NodeKind } from '../packages/shared/types.js';
import {
  fieldsFor,
  isTargetControl,
  missingRequired,
  primaryTargetField,
  targetFieldsFor,
  TARGET_CONTROLS
} from '../packages/shared/node-fields.js';

/**
 * The edit form is generated from node-fields.ts. If it ever offers a field the schema rejects,
 * or fails to mark a field the schema requires, saving produces a validation failure the user
 * cannot act on. These tests are what keep the form and the schema honest about each other.
 */

const ROOT = process.cwd();
const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'board.schema.json'), 'utf8')) as {
  $defs: {
    node: {
      properties: Record<string, unknown>;
      allOf: { if: { properties: { kind: { const?: string; enum?: string[] } } }; then: { required: string[] } }[];
    };
  };
};

/** Required fields the JSON Schema imposes on a given kind, via its if/then branches. */
function schemaRequiredFor(kind: NodeKind): string[] {
  const required = new Set<string>();
  for (const branch of schema.$defs.node.allOf) {
    const cond = branch.if.properties.kind;
    const matches = cond.const === kind || (cond.enum?.includes(kind) ?? false);
    if (matches) for (const field of branch.then.required) required.add(field);
  }
  return [...required];
}

describe('every kind has a field spec', () => {
  it.each(NODE_KINDS)('%s', (kind) => {
    const fields = fieldsFor(kind);
    expect(fields.length).toBeGreaterThan(0);
    // name is always editable and always required — it is what the board and Ctrl+K show.
    expect(fields.find((f) => f.key === 'name')?.required).toBe(true);
  });
});

describe('the form never offers a field the schema would reject', () => {
  it.each(NODE_KINDS)('%s', (kind) => {
    const declared = Object.keys(schema.$defs.node.properties);
    for (const field of fieldsFor(kind)) {
      expect(declared, `field "${String(field.key)}" is not declared in board.schema.json`).toContain(String(field.key));
    }
  });
});

describe('the form marks required exactly what the schema requires', () => {
  it.each(NODE_KINDS)('%s', (kind) => {
    const fromSchema = schemaRequiredFor(kind).sort();
    const fromForm = fieldsFor(kind)
      .filter((f) => f.required)
      .map((f) => String(f.key))
      .filter((k) => k !== 'name') // name is required by the top-level `required`, not a branch
      .sort();
    expect(fromForm).toEqual(fromSchema);
  });
});

describe('no duplicate fields in a form', () => {
  it.each(NODE_KINDS)('%s', (kind) => {
    const keys = fieldsFor(kind).map((f) => String(f.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('target controls', () => {
  it('recognises exactly the controls that name something outside the board', () => {
    expect([...TARGET_CONTROLS].sort()).toEqual(['board-file', 'glob', 'path-dir', 'path-file', 'url']);
    expect(isTargetControl('text')).toBe(false);
    expect(isTargetControl('path-dir')).toBe(true);
  });

  it('gives every linkable kind a pickable target field', () => {
    // "Ensure linkable items / nodes have an interface for selecting source files, directories,
    // or the right url to function." These are the kinds that point at something.
    const linkable: NodeKind[] = [
      'agent.code', 'agent.chat', 'agent.jarvis', 'drive.room',
      'store.repo', 'store.folder', 'store.cloud',
      'file.document', 'file.exe', 'file.artifact',
      'link.url', 'service.process'
    ];
    for (const kind of linkable) {
      const fields = targetFieldsFor(kind);
      expect(fields.length, `${kind} has no pickable target field`).toBeGreaterThan(0);
      expect(primaryTargetField(kind), `${kind} has no primary target`).toBeDefined();
    }
  });

  it('gives the kinds that point at nothing no primary target', () => {
    for (const kind of ['note.silk', 'monitor.system', 'group.zone', 'task.scheduled'] as NodeKind[]) {
      expect(primaryTargetField(kind)).toBeUndefined();
    }
  });

  it("never treats the face image as a node's target", () => {
    // `image` is pickable and verifiable like any path, but it is decoration. Clicking a
    // note.silk must not "open" its picture, and the inspector must not report a decorative
    // image as the thing the component is bound to.
    for (const kind of NODE_KINDS) {
      expect(primaryTargetField(kind)?.key).not.toBe('image');
      expect(targetFieldsFor(kind).some((f) => f.key === 'image')).toBe(true);
    }
  });

  it("picks the required field as a kind's primary target", () => {
    expect(primaryTargetField('agent.code')?.key).toBe('cwd');
    expect(primaryTargetField('store.repo')?.key).toBe('path');
    expect(primaryTargetField('file.artifact')?.key).toBe('glob');
    expect(primaryTargetField('link.url')?.key).toBe('url');
    expect(primaryTargetField('drive.room')?.key).toBe('boardFile');
  });

  it('offers a file dialog filter wherever a specific file type is expected', () => {
    expect(fieldsFor('file.exe').find((f) => f.key === 'path')?.filters?.[0]?.extensions).toContain('exe');
    expect(fieldsFor('file.document').find((f) => f.key === 'path')?.filters?.[0]?.extensions).toContain('docx');
  });
});

describe('missingRequired', () => {
  const base: BoardNode = { id: 'u1', kind: 'agent.code', name: 'CC-TEST', pos: { x: 0, y: 0 } };

  it('reports the fields a half-filled node still needs', () => {
    expect(missingRequired(base).map((f) => f.key).sort()).toEqual(['cwd', 'launch']);
  });

  it('is empty once they are filled', () => {
    expect(missingRequired({ ...base, cwd: 'C:/dev/x', launch: 'popout' })).toEqual([]);
  });

  it('treats whitespace as missing', () => {
    expect(missingRequired({ ...base, cwd: '   ', launch: 'popout' }).map((f) => f.key)).toEqual(['cwd']);
  });

  it('treats an empty name as missing', () => {
    expect(missingRequired({ ...base, name: '', cwd: 'C:/dev/x', launch: 'popout' }).map((f) => f.key)).toEqual(['name']);
  });
});


/*
 * Per-node display toggles.
 *
 * "some I only want to be thumbnail, some only designator, some only title." Four independent
 * booleans, all defaulting to ON, so a board written before any of them existed prints exactly
 * what it printed before.
 *
 * `showThumbnail` and `showLogo` are separate because the two images do separate jobs: a
 * recognisable badge on a drawn package reads well, and so does a photograph with nothing over it.
 */
describe('display toggles', () => {
  const TOGGLES = ['showDesignator', 'showName', 'showThumbnail', 'showLogo'] as const;
  const ALL_ON = { designator: true, name: true, thumbnail: true, logo: true };

  it('offers all four on every kind', () => {
    for (const kind of NODE_KINDS) {
      const keys = fieldsFor(kind).map((f) => f.key);
      for (const toggle of TOGGLES) expect(keys, `${kind} is missing ${toggle}`).toContain(toggle);
    }
  });

  it('offers them as tickers, not text boxes', () => {
    const fields = fieldsFor('agent.code');
    for (const key of TOGGLES) {
      expect(fields.find((f) => f.key === key)?.control).toBe('boolean');
    }
  });

  it('never treats a display toggle as the node target', () => {
    // targetFieldsFor drives the Browse/Verify UI. A checkbox is not a path.
    for (const kind of NODE_KINDS) {
      const targets = targetFieldsFor(kind).map((f) => f.key);
      for (const toggle of TOGGLES) expect(targets).not.toContain(toggle);
    }
  });

  it('defaults every toggle to ON when the node says nothing', () => {
    expect(displayOf({})).toEqual(ALL_ON);
  });

  it('honours each toggle independently', () => {
    expect(displayOf({ showDesignator: false })).toEqual({ ...ALL_ON, designator: false });
    expect(displayOf({ showName: false })).toEqual({ ...ALL_ON, name: false });
    expect(displayOf({ showThumbnail: false })).toEqual({ ...ALL_ON, thumbnail: false });
    expect(displayOf({ showLogo: false })).toEqual({ ...ALL_ON, logo: false });
  });

  it('separates the wallpaper from the badge', () => {
    /*
     * The point of splitting them. A logo on a drawn package silhouette — no photograph — is a
     * combination the old single toggle could not express at all, and it is the one that makes a
     * dense room readable: every node the same shape, each wearing its own mark.
     */
    expect(displayOf({ showThumbnail: false, showLogo: true }))
      .toEqual({ ...ALL_ON, thumbnail: false });
    expect(displayOf({ showThumbnail: true, showLogo: false }))
      .toEqual({ ...ALL_ON, logo: false });
  });

  it('allows a node to print nothing at all', () => {
    // A pure silhouette. Legal, and the only way to get a board that reads as a picture.
    expect(displayOf({ showDesignator: false, showName: false, showThumbnail: false, showLogo: false }))
      .toEqual({ designator: false, name: false, thumbnail: false, logo: false });
  });

  it('treats an explicit true as ON, not as "unset"', () => {
    expect(displayOf({ showDesignator: true, showName: true, showThumbnail: true, showLogo: true }))
      .toEqual(ALL_ON);
  });
});
