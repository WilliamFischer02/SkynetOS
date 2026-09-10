import { useEffect, useState } from 'react';
import type { TargetInfo } from '@shared/targets.js';

/**
 * A list of directories, each one browsable and each one checked against the disk.
 *
 * This is the control behind `addDirs` — the answer to "my other repos live on other drives and
 * I am not moving them". An agent chip in C:/dev/SkynetOS can be granted D:/work/Something and
 * treat it as part of the job, because Claude Code takes `--add-dir` and SkynetOS passes one per
 * entry here.
 *
 * A free-text box would have been half the code and the wrong control. A granted directory has
 * the same powers as the working directory, so a typo is not a cosmetic error — it is a silently
 * missing capability at best, and at worst it makes the whole invocation fail. Every row shows
 * whether the path is real, and says so before it is ever launched.
 */

export interface DirListFieldProps {
  /** Comma-separated, matching how the editor stores every list field. */
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

function split(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function DirListField({ value, disabled, onChange }: DirListFieldProps): React.JSX.Element {
  const dirs = split(value);
  const [checks, setChecks] = useState<Record<string, TargetInfo>>({});

  // Verified through the same main-process resolver every other target uses, so "exists" here
  // means exactly what it means on the board.
  useEffect(() => {
    let live = true;
    void (async () => {
      const next: Record<string, TargetInfo> = {};
      for (const dir of dirs) {
        next[dir] = await window.skynet['target:verify']('path-dir', dir);
      }
      if (live) setChecks(next);
    })();
    return () => { live = false; };
  }, [value]);

  const replace = (list: string[]) => onChange(list.join(', '));

  const browse = async () => {
    const result = await window.skynet['pick:target']({
      control: 'path-dir',
      title: 'Grant this agent a directory'
    });
    if (result.cancelled || !result.value) return;
    if (dirs.includes(result.value)) return;
    replace([...dirs, result.value]);
  };

  return (
    <div className="dirlist">
      {dirs.map((dir, i) => {
        const check = checks[dir];
        const ok = check?.state === 'ok';
        const warn = check?.state === 'outside-dev-root';
        return (
          <div className={`dirlist-row${ok ? ' ok' : warn ? ' warn' : check ? ' fault' : ''}`} key={`${dir}-${i}`}>
            <span className="dirlist-path" title={dir}>{dir}</span>
            <span className="dirlist-state">
              {!check ? '…' : ok ? 'BOUND' : warn ? 'OUTSIDE DEV ROOTS' : 'NOT FOUND'}
            </span>
            <button
              type="button"
              className="btn tiny"
              disabled={disabled}
              onClick={() => replace(dirs.filter((_, j) => j !== i))}
              title={`Stop granting ${dir}`}
            >
              Remove
            </button>
          </div>
        );
      })}

      {!dirs.length ? <div className="dirlist-empty">NONE — this agent sees only its working directory</div> : null}

      <button type="button" className="btn" disabled={disabled} onClick={() => void browse()}>
        Grant a directory…
      </button>
    </div>
  );
}
