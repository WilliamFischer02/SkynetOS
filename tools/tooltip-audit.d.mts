export interface AuditedControl {
  file: string;
  line: number;
  kind: string;
  ok: boolean;
  reason: string;
  snippet: string;
}

export const UI_DIR: string;
export const EXCLUDED: string[];
export function auditSource(source: string, file?: string): AuditedControl[];
export function auditUi(options?: { all?: boolean }): {
  files: number;
  controls: AuditedControl[];
  missing: AuditedControl[];
};
