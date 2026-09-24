/**
 * npm run finance:report — reads private/finance/, prints the summary, writes report.json.
 *
 * The only program that touches the ledger. It merges CSV exports from `imports/` into
 * `ledger.json` (transactions only, by stable id, so a file imported twice adds nothing) and never
 * changes a balance, because a transaction list and a balance are different facts. Everything it
 * decides is `packages/shared/finance.ts`; this file is the disk and the console.
 *
 * `private/` is gitignored (docs/07: the repo is public). Nothing here prints outside it except to
 * the terminal William is sitting at.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  formatMoney,
  mergeTransactions,
  normaliseLedger,
  parseCsv,
  summarise,
  type CsvMapping,
  type Ledger,
  type Summary
} from '../packages/shared/finance.js';

const ROOT = resolve(process.cwd());
const HOME = join(ROOT, 'private', 'finance');
const LEDGER = join(HOME, 'ledger.json');
const TEMPLATE = join(HOME, 'ledger.template.json');
const MAPPINGS = join(HOME, 'mappings.json');
const IMPORTS = join(HOME, 'imports');
const REPORT = join(HOME, 'report.json');

interface Mappings { mappings: Record<string, CsvMapping>; files: Record<string, string> }

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch (err) {
    console.log(`COULD NOT READ ${file}: ${(err as Error).message}`);
    return null;
  }
}

function readMappings(): Mappings {
  const raw = readJson(MAPPINGS);
  const out: Mappings = { mappings: {}, files: {} };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (r['mappings'] && typeof r['mappings'] === 'object') out.mappings = r['mappings'] as Record<string, CsvMapping>;
  if (r['files'] && typeof r['files'] === 'object') out.files = r['files'] as Record<string, string>;
  return out;
}

/** `chk__chase-sept.csv` → chk. The account id is the part before the double underscore. */
function accountOf(file: string): string | null {
  const m = /^([a-z0-9_-]+)__/i.exec(file);
  return m ? m[1]! : null;
}

function importCsvs(ledger: Ledger, maps: Mappings): { added: number; notes: string[] } {
  const notes: string[] = [];
  let added = 0;
  if (!existsSync(IMPORTS)) return { added, notes };
  const known = new Set(ledger.accounts.map((a) => a.id));
  for (const file of readdirSync(IMPORTS).filter((f) => f.toLowerCase().endsWith('.csv')).sort()) {
    const accountId = accountOf(file);
    if (!accountId) { notes.push(`SKIPPED ${file}: NAME IT <accountId>__anything.csv`); continue; }
    if (!known.has(accountId)) { notes.push(`SKIPPED ${file}: NO ACCOUNT "${accountId}" IN ledger.json`); continue; }
    const prefix = Object.keys(maps.files).find((p) => file.toLowerCase().startsWith(p.toLowerCase()));
    const mapping = prefix ? maps.mappings[maps.files[prefix]!] ?? null : null;
    const result = parseCsv(readFileSync(IMPORTS + '/' + file, 'utf8'), accountId, mapping);
    if (result.errors.length) { notes.push(`SKIPPED ${file}: ${result.errors.join('; ')}`); continue; }
    const merged = mergeTransactions(ledger.transactions, result.transactions);
    ledger.transactions = merged.transactions;
    added += merged.added;
    notes.push(`${file}: ${result.transactions.length} ROWS, ${merged.added} NEW${result.skipped ? `, ${result.skipped} UNREADABLE` : ''}`);
  }
  return { added, notes };
}

function bar(fill: number, width = 20): string {
  const n = Math.round(fill * width);
  return `[${'#'.repeat(n)}${'.'.repeat(width - n)}]`;
}

function print(s: Summary): void {
  const money = (v: number): string => formatMoney(v, s.currency);
  console.log('');
  console.log('FINANCEOS');
  console.log('─'.repeat(72));
  for (const m of s.meters) {
    console.log(`${bar(m.fill)} ${m.state.toUpperCase().padEnd(5)} ${m.name.toUpperCase().padEnd(22)} ${m.label}${m.stale ? '  (STALE)' : ''}`);
  }
  console.log('─'.repeat(72));
  console.log(`CASH ${money(s.totals.cash)}  ·  CREDIT OWED ${money(s.totals.credit)}  ·  LOANS ${money(s.totals.loans)}  ·  NET ${money(s.totals.net)}`);
  if (s.totals.utilisation !== null) console.log(`CREDIT USED ${Math.round(s.totals.utilisation * 100)}% OF ${money(s.totals.creditLimit)}  ·  MINIMUMS DUE ${money(s.totals.minimumsDue)}`);
  console.log(`LAST ${s.rates.windowDays} DAYS: SPENT ${money(s.rates.spent)} (${money(s.rates.perDaySpent)}/DAY)  ·  EARNED ${money(s.rates.earned)} (${money(s.rates.perDayEarned)}/DAY)  ·  NET ${money(s.rates.net)}  ·  ${s.rates.transactions} TRANSACTIONS`);
  console.log(`BILLS UNPAID ${s.bills.unpaid.length} (${money(s.bills.totalUnpaid)})  ·  DUE SOON ${s.bills.dueSoon.length}  ·  OVERDUE ${s.bills.overdue.length}`);
  console.log('─'.repeat(72));
  if (!s.alerts.length) console.log('NOTHING NEEDS YOU.');
  for (const a of s.alerts) console.log(`${a.severity.toUpperCase().padEnd(5)} ${a.text}\n      → ${a.action}`);
  console.log('');
}

function main(): void {
  mkdirSync(IMPORTS, { recursive: true });
  if (!existsSync(LEDGER)) {
    const s = summarise(normaliseLedger(null), new Date());
    console.log('');
    console.log('NO LEDGER YET.');
    console.log(`COPY ${TEMPLATE}`);
    console.log(`  TO ${LEDGER}`);
    console.log('AND REPLACE EVERY NUMBER. THEN RUN THIS AGAIN. private/finance/README.md HAS THE REST.');
    console.log('');
    writeFileSync(REPORT, JSON.stringify(s, null, 2) + '\n');
    return;
  }
  const ledger = normaliseLedger(readJson(LEDGER));
  const imported = importCsvs(ledger, readMappings());
  for (const note of imported.notes) console.log(note);
  if (imported.added > 0) {
    writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
    console.log(`${imported.added} NEW TRANSACTION${imported.added === 1 ? '' : 'S'} WRITTEN TO ledger.json`);
  }
  const summary = summarise(ledger, new Date());
  print(summary);
  writeFileSync(REPORT, JSON.stringify(summary, null, 2) + '\n');
  console.log(`WRITTEN ${REPORT}`);
}

main();
