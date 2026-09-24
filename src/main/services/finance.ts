import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type FinanceStatus, type Summary } from '@shared/finance.js';
import { skynetRoot } from './target-resolver.js';

/**
 * The board's only door to William's money: the report `npm run finance:report` wrote.
 *
 * Main reads one file, `private/finance/report.json`, and parses it. It never reads the ledger,
 * never touches a CSV and never computes a figure of its own, so what the inspector shows is
 * exactly what the tool printed, at the time it printed it (`generatedAt`). The folder is
 * gitignored (docs/07: the repo is public); the channel is board-window only.
 */
export function reportFile(): string {
  return join(skynetRoot(), 'private', 'finance', 'report.json');
}

export function financeStatus(): FinanceStatus {
  const file = reportFile();
  if (!existsSync(file)) return { ready: false, reason: 'NO REPORT YET — RUN npm run finance:report IN THE SKYNETOS FOLDER' };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Summary>;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.meters) || !Array.isArray(parsed.alerts)) {
      return { ready: false, reason: 'report.json IS NOT A REPORT — RUN npm run finance:report AGAIN' };
    }
    if (parsed.ready === false) {
      return { ready: false, reason: parsed.alerts[0]?.action ?? 'NO LEDGER YET — COPY ledger.template.json TO ledger.json' };
    }
    return { ready: true, summary: parsed as Summary, file };
  } catch (err) {
    return { ready: false, reason: `COULD NOT READ report.json — ${(err as Error).message}` };
  }
}
