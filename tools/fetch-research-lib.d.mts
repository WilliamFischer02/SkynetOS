export interface FetchOptions {
  mode: 'fetch';
  url: string;
  destDir: string;
  name: string | null;
  license: string | null;
  note: string | null;
  maxMb: number;
  allowHtml: boolean;
}

export interface RestoreOptions {
  mode: 'restore';
  dir: string;
}

export interface SourceEntry {
  url: string;
  finalUrl: string;
  file: string;
  bytes: number;
  sha256: string;
  retrieved: string;
  contentType: string | null;
  license: string | null;
  note: string | null;
}

export interface RestoreItem {
  url: string;
  file: string;
  sha256: string;
  bytes: number;
}

export const DEFAULT_MAX_MB: number;
export function sanitizeFilename(raw: unknown): string;
export function extensionFor(contentType: string | null | undefined): string;
export function suspectHtml(file: string, contentType: string | null | undefined): boolean;
export function filenameFromDisposition(header: string | null | undefined): string | null;
export function filenameFromUrl(url: string): string | null;
export function chooseFilename(input: {
  explicit?: string | null;
  disposition?: string | null;
  url: string;
  contentType?: string | null;
}): string;
export function parseArgs(argv: string[]): FetchOptions | RestoreOptions;
export function readManifest(text: string | null): Array<Partial<SourceEntry>>;
export function mergeManifest(existingText: string | null, entry: SourceEntry | Record<string, unknown>): string;
export function restorePlan(
  manifestText: string | null,
  exists: (file: string) => boolean
): { fetch: RestoreItem[]; skipped: { file: string; reason: string }[] };
