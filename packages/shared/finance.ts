/**
 * The finance ledger, pure: what William owns, owes and pays, and what the board says about it.
 *
 * William: "a finance monitoring system that shows a gamut of important data that can inform me
 * at a glance of my financial situation - like meters that depict my bank balances and credit
 * card bill, things like spending and earning rate, critical messages like bills unpaid."
 *
 * Nothing here reads a bank. The ledger is a JSON file William keeps in `private/finance/`
 * (gitignored: the repo is public, docs/07), filled by hand or from CSV exports through
 * `parseCsv`. Prime directive 1 applies to money more than to anything else on the board: a
 * figure comes from the ledger or it is not shown. There are no defaults that look like balances.
 *
 * `tools/finance-report.ts` runs `summarise` and writes `private/finance/report.json`; the board
 * reads that file and nothing else. `test/finance.test.ts` holds every rule below.
 */

export const ACCOUNT_KINDS = ['checking', 'savings', 'credit', 'loan', 'cash'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export interface Account {
  id: string;
  name: string;
  institution: string;
  kind: AccountKind;
  /** What the account holds (checking, savings, cash) or what is owed on it (credit, loan). Never negative for debt. */
  balance: number;
  /** ISO date or datetime the balance was true. */
  asOf: string;
  creditLimit?: number;
  /** Annual percentage rate, e.g. 24.99. */
  apr?: number;
  /** The minimum payment due this cycle, for credit and loan accounts. */
  minimumDue?: number;
  /** Day of the month the payment is due, 1–31. */
  dueDay?: number;
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  /** ISO date. */
  dueDate: string;
  paid: boolean;
  paidOn?: string;
  autopay?: boolean;
  /** The account it is paid from, by id. */
  account?: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  /** ISO date. */
  date: string;
  /** Signed: money in is positive, money out is negative, on every kind of account. */
  amount: number;
  description: string;
  category?: string;
  source: 'csv' | 'manual';
}

export interface Thresholds {
  /** Below this a holding account is LOW. Absent means no line. */
  lowBalance: Partial<Record<AccountKind, number>>;
  /** A balance older than this many days is STALE. */
  staleDays: number;
}

export interface Ledger {
  version: 1;
  currency: string;
  accounts: Account[];
  bills: Bill[];
  transactions: Transaction[];
  thresholds: Thresholds;
}

export const DEFAULT_THRESHOLDS: Thresholds = { lowBalance: { checking: 500, savings: 1000, cash: 100 }, staleDays: 7 };
export const RATE_WINDOW_DAYS = 30;
export const DUE_SOON_DAYS = 7;
export const UTILISATION_WARN = 0.3;
export const UTILISATION_FAULT = 0.8;
/** Categories that move money between William's own accounts and are neither spending nor earning. */
export const TRANSFER_CATEGORIES = ['transfer', 'payment', 'credit card payment'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export function emptyLedger(): Ledger {
  return { version: 1, currency: 'USD', accounts: [], bills: [], transactions: [], thresholds: { ...DEFAULT_THRESHOLDS, lowBalance: { ...DEFAULT_THRESHOLDS.lowBalance } } };
}

/* ────────────────────────── reading the file ────────────────────────── */

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isKind = (v: unknown): v is AccountKind => (ACCOUNT_KINDS as readonly unknown[]).includes(v);

function account(raw: unknown): Account | null {
  if (!isRecord(raw)) return null;
  const id = str(raw['id']);
  const name = str(raw['name']);
  const balance = num(raw['balance']);
  const asOf = str(raw['asOf']);
  if (!id || !name || balance === null || !asOf || !isKind(raw['kind'])) return null;
  const out: Account = { id, name, institution: str(raw['institution']) ?? '', kind: raw['kind'], balance, asOf };
  const limit = num(raw['creditLimit']);
  const apr = num(raw['apr']);
  const minimumDue = num(raw['minimumDue']);
  const dueDay = num(raw['dueDay']);
  if (limit !== null && limit > 0) out.creditLimit = limit;
  if (apr !== null && apr >= 0) out.apr = apr;
  if (minimumDue !== null && minimumDue >= 0) out.minimumDue = minimumDue;
  if (dueDay !== null && dueDay >= 1 && dueDay <= 31) out.dueDay = Math.floor(dueDay);
  return out;
}

function bill(raw: unknown): Bill | null {
  if (!isRecord(raw)) return null;
  const id = str(raw['id']);
  const name = str(raw['name']);
  const amount = num(raw['amount']);
  const dueDate = str(raw['dueDate']);
  if (!id || !name || amount === null || !dueDate) return null;
  const out: Bill = { id, name, amount, dueDate, paid: raw['paid'] === true };
  const paidOn = str(raw['paidOn']);
  const acct = str(raw['account']);
  if (paidOn) out.paidOn = paidOn;
  if (raw['autopay'] === true) out.autopay = true;
  if (acct) out.account = acct;
  return out;
}

function transaction(raw: unknown): Transaction | null {
  if (!isRecord(raw)) return null;
  const id = str(raw['id']);
  const accountId = str(raw['accountId']);
  const date = str(raw['date']);
  const amount = num(raw['amount']);
  if (!id || !accountId || !date || amount === null) return null;
  const out: Transaction = { id, accountId, date, amount, description: str(raw['description']) ?? '', source: raw['source'] === 'csv' ? 'csv' : 'manual' };
  const category = str(raw['category']);
  if (category) out.category = category.toLowerCase();
  return out;
}

/** Whatever was on disk, made safe to use. A mangled file costs the mangled rows, never a crash. */
export function normaliseLedger(raw: unknown): Ledger {
  const out = emptyLedger();
  if (!isRecord(raw)) return out;
  out.currency = str(raw['currency']) ?? 'USD';
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  out.accounts = list(raw['accounts']).map(account).filter((a): a is Account => a !== null);
  out.bills = list(raw['bills']).map(bill).filter((b): b is Bill => b !== null);
  out.transactions = list(raw['transactions']).map(transaction).filter((t): t is Transaction => t !== null);
  const th = isRecord(raw['thresholds']) ? raw['thresholds'] : {};
  const stale = num(th['staleDays']);
  if (stale !== null && stale > 0) out.thresholds.staleDays = stale;
  if (isRecord(th['lowBalance'])) {
    for (const kind of ACCOUNT_KINDS) {
      const v = num(th['lowBalance'][kind]);
      if (v !== null && v >= 0) out.thresholds.lowBalance[kind] = v;
    }
  }
  return out;
}

/** Adds transactions not already in the ledger, by id. Re-importing the same CSV changes nothing. */
export function mergeTransactions(existing: readonly Transaction[], incoming: readonly Transaction[]): { transactions: Transaction[]; added: number } {
  const seen = new Set(existing.map((t) => t.id));
  const out = [...existing];
  let added = 0;
  for (const t of incoming) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    added++;
  }
  return { transactions: out, added };
}

/* ────────────────────────── the summary ────────────────────────── */

export type Severity = 'fault' | 'warn' | 'info';

export interface Meter {
  accountId: string;
  name: string;
  institution: string;
  kind: AccountKind;
  balance: number;
  /** 0..1. Credit: balance over limit. Holding accounts: balance over the low line. Loans: 1. */
  fill: number;
  state: 'ok' | 'warn' | 'fault';
  stale: boolean;
  asOf: string;
  /** For the board: "OWED 1,234 OF 5,000" or "BALANCE 1,234". */
  label: string;
}

export interface Alert {
  severity: Severity;
  code: 'no-data' | 'bill-overdue' | 'bill-due' | 'bill-autopay' | 'low-balance' | 'stale' | 'utilisation' | 'account-utilisation' | 'minimums';
  text: string;
  /** What to do about it. Every alert ends in one. */
  action: string;
  accountId?: string;
  billId?: string;
}

export interface Summary {
  /** False until the ledger holds anything at all. */
  ready: boolean;
  generatedAt: string;
  currency: string;
  meters: Meter[];
  totals: {
    cash: number;
    credit: number;
    loans: number;
    debt: number;
    net: number;
    creditLimit: number;
    /** Credit owed over credit limit, or null with no limits. */
    utilisation: number | null;
    minimumsDue: number;
  };
  rates: {
    windowDays: number;
    spent: number;
    earned: number;
    perDaySpent: number;
    perDayEarned: number;
    net: number;
    transactions: number;
  };
  bills: { unpaid: Bill[]; dueSoon: Bill[]; overdue: Bill[]; totalUnpaid: number };
  alerts: Alert[];
}

const SEVERITY_ORDER: Record<Severity, number> = { fault: 0, warn: 1, info: 2 };
const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const round2 = (v: number): number => Math.round(v * 100) / 100;

export function formatMoney(amount: number, currency = 'USD'): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const whole = Math.floor(abs).toLocaleString('en-US');
  const cents = Math.round((abs - Math.floor(abs)) * 100).toString().padStart(2, '0');
  const symbol = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : `${currency} `;
  return `${sign}${symbol}${whole}.${cents}`;
}

/**
 * An ISO date as a LOCAL instant. `Date.parse('2026-09-30')` is UTC midnight, which in this time
 * zone is the evening before, so a bill due on the 30th would read as due on the 29th.
 */
export function parseIsoDate(iso: string): number {
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (bare) return new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])).getTime();
  return Date.parse(iso);
}

/** Days from `now` to an ISO date: negative when it has passed. Null when unreadable. */
export function daysUntil(iso: string, now: Date): number | null {
  const t = parseIsoDate(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((startOfDay(new Date(t)) - startOfDay(now)) / DAY_MS);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const isTransfer = (t: Transaction): boolean => !!t.category && (TRANSFER_CATEGORIES as readonly string[]).includes(t.category);
const holds = (kind: AccountKind): boolean => kind === 'checking' || kind === 'savings' || kind === 'cash';

export function summarise(ledger: Ledger, now: Date): Summary {
  const empty = !ledger.accounts.length && !ledger.bills.length && !ledger.transactions.length;
  const summary: Summary = {
    ready: !empty,
    generatedAt: now.toISOString(),
    currency: ledger.currency,
    meters: [],
    totals: { cash: 0, credit: 0, loans: 0, debt: 0, net: 0, creditLimit: 0, utilisation: null, minimumsDue: 0 },
    rates: { windowDays: RATE_WINDOW_DAYS, spent: 0, earned: 0, perDaySpent: 0, perDayEarned: 0, net: 0, transactions: 0 },
    bills: { unpaid: [], dueSoon: [], overdue: [], totalUnpaid: 0 },
    alerts: []
  };
  if (empty) {
    summary.alerts.push({ severity: 'info', code: 'no-data', text: 'NO LEDGER YET', action: 'COPY private/finance/ledger.template.json TO ledger.json AND REPLACE EVERY NUMBER' });
    return summary;
  }

  const money = (v: number): string => formatMoney(v, ledger.currency);
  const alerts: Alert[] = [];

  // Meters and totals, one account at a time.
  for (const a of ledger.accounts) {
    const age = daysUntil(a.asOf, now);
    const stale = age === null || -age > ledger.thresholds.staleDays;
    let fill: number;
    let state: Meter['state'] = 'ok';
    let label: string;
    if (a.kind === 'credit') {
      summary.totals.credit += a.balance;
      summary.totals.creditLimit += a.creditLimit ?? 0;
      fill = a.creditLimit ? clamp01(a.balance / a.creditLimit) : 0;
      label = a.creditLimit ? `OWED ${money(a.balance)} OF ${money(a.creditLimit)}` : `OWED ${money(a.balance)}`;
      if (a.creditLimit) {
        if (fill >= UTILISATION_FAULT) state = 'fault';
        else if (fill >= UTILISATION_WARN) state = 'warn';
        if (fill >= UTILISATION_WARN) {
          alerts.push({
            severity: fill >= UTILISATION_FAULT ? 'fault' : 'warn', code: 'account-utilisation', accountId: a.id,
            text: `${a.name.toUpperCase()} IS ${Math.round(fill * 100)}% USED`,
            action: fill >= UTILISATION_FAULT
              ? `PAY ${a.name.toUpperCase()} DOWN BELOW ${money(a.creditLimit * UTILISATION_WARN)} BEFORE ANYTHING ELSE${a.apr ? ` — ${a.apr}% APR` : ''}`
              : `KEEP ${a.name.toUpperCase()} UNDER ${money(a.creditLimit * UTILISATION_WARN)} (30% OF ITS LIMIT)`
          });
        }
      }
    } else if (a.kind === 'loan') {
      summary.totals.loans += a.balance;
      fill = 1;
      label = `OWED ${money(a.balance)}${a.apr ? ` AT ${a.apr}%` : ''}`;
    } else {
      summary.totals.cash += a.balance;
      const low = ledger.thresholds.lowBalance[a.kind];
      fill = low && low > 0 ? clamp01(a.balance / low) : a.balance > 0 ? 1 : 0;
      label = `BALANCE ${money(a.balance)}`;
      if (a.balance < 0) {
        state = 'fault';
        alerts.push({ severity: 'fault', code: 'low-balance', accountId: a.id, text: `${a.name.toUpperCase()} IS OVERDRAWN BY ${money(-a.balance)}`, action: `MOVE ${money(-a.balance)} INTO ${a.name.toUpperCase()} TODAY, BEFORE THE FEE` });
      } else if (low !== undefined && a.balance < low) {
        state = 'warn';
        alerts.push({ severity: 'warn', code: 'low-balance', accountId: a.id, text: `${a.name.toUpperCase()} IS UNDER ITS ${money(low)} LINE (${money(a.balance)})`, action: `HOLD SPENDING FROM ${a.name.toUpperCase()} UNTIL IT IS BACK OVER ${money(low)}` });
      }
    }
    if (a.kind === 'credit' || a.kind === 'loan') summary.totals.minimumsDue += a.minimumDue ?? 0;
    if (stale) {
      alerts.push({
        severity: 'warn', code: 'stale', accountId: a.id,
        text: age === null ? `${a.name.toUpperCase()} HAS NO READABLE DATE` : `${a.name.toUpperCase()} IS ${-age} DAYS OLD`,
        action: `UPDATE ${a.name.toUpperCase()}: EXPORT A CSV INTO private/finance/imports/ OR EDIT ITS balance AND asOf IN ledger.json`
      });
    }
    summary.meters.push({ accountId: a.id, name: a.name, institution: a.institution, kind: a.kind, balance: a.balance, fill: round2(fill), state, stale, asOf: a.asOf, label });
  }
  summary.totals.debt = summary.totals.credit + summary.totals.loans;
  summary.totals.net = summary.totals.cash - summary.totals.debt;
  summary.totals.utilisation = summary.totals.creditLimit > 0 ? round2(summary.totals.credit / summary.totals.creditLimit) : null;
  if (summary.totals.utilisation !== null && summary.totals.utilisation >= UTILISATION_WARN && ledger.accounts.filter((a) => a.kind === 'credit').length > 1) {
    const u = summary.totals.utilisation;
    alerts.push({
      severity: u >= UTILISATION_FAULT ? 'fault' : 'warn', code: 'utilisation',
      text: `${Math.round(u * 100)}% OF ALL CREDIT IS USED (${money(summary.totals.credit)} OF ${money(summary.totals.creditLimit)})`,
      action: `BRING TOTAL CREDIT OWED UNDER ${money(summary.totals.creditLimit * UTILISATION_WARN)}; PAY THE HIGHEST APR FIRST`
    });
  }
  if (summary.totals.minimumsDue > 0 && summary.totals.cash < summary.totals.minimumsDue) {
    alerts.push({
      severity: 'fault', code: 'minimums',
      text: `MINIMUM PAYMENTS (${money(summary.totals.minimumsDue)}) EXCEED CASH ON HAND (${money(summary.totals.cash)})`,
      action: `FIND ${money(summary.totals.minimumsDue - summary.totals.cash)} BEFORE THE DUE DATES, OR CALL THE LENDER BEFORE A PAYMENT IS MISSED`
    });
  }

  // Bills.
  for (const b of ledger.bills) {
    if (b.paid) continue;
    summary.bills.unpaid.push(b);
    summary.bills.totalUnpaid += b.amount;
    const days = daysUntil(b.dueDate, now);
    if (days === null) continue;
    if (days < 0) {
      summary.bills.overdue.push(b);
      alerts.push({ severity: 'fault', code: 'bill-overdue', billId: b.id, text: `${b.name.toUpperCase()} (${money(b.amount)}) IS ${-days} DAY${days === -1 ? '' : 'S'} OVERDUE`, action: `PAY ${b.name.toUpperCase()} NOW, THEN MARK IT paid IN ledger.json` });
    } else if (days <= DUE_SOON_DAYS) {
      summary.bills.dueSoon.push(b);
      alerts.push(b.autopay
        ? { severity: 'info', code: 'bill-autopay', billId: b.id, text: `${b.name.toUpperCase()} (${money(b.amount)}) AUTOPAYS IN ${days} DAY${days === 1 ? '' : 'S'}`, action: `CHECK ${b.account ? b.account.toUpperCase() : 'THE PAYING ACCOUNT'} HOLDS ${money(b.amount)} ON ${b.dueDate}` }
        : { severity: 'warn', code: 'bill-due', billId: b.id, text: days === 0 ? `${b.name.toUpperCase()} (${money(b.amount)}) IS DUE TODAY` : `${b.name.toUpperCase()} (${money(b.amount)}) IS DUE IN ${days} DAY${days === 1 ? '' : 'S'}`, action: `PAY ${b.name.toUpperCase()} BY ${b.dueDate}` });
    }
  }

  // Rates over the last RATE_WINDOW_DAYS days.
  const kindOf = new Map(ledger.accounts.map((a) => [a.id, a.kind]));
  const from = startOfDay(now) - RATE_WINDOW_DAYS * DAY_MS;
  const to = startOfDay(now) + DAY_MS;
  for (const t of ledger.transactions) {
    const at = parseIsoDate(t.date);
    if (!Number.isFinite(at) || at < from || at >= to || isTransfer(t)) continue;
    summary.rates.transactions++;
    if (t.amount < 0) summary.rates.spent += -t.amount;
    else if (holds(kindOf.get(t.accountId) ?? 'checking')) summary.rates.earned += t.amount;
  }
  summary.rates.spent = round2(summary.rates.spent);
  summary.rates.earned = round2(summary.rates.earned);
  summary.rates.perDaySpent = round2(summary.rates.spent / RATE_WINDOW_DAYS);
  summary.rates.perDayEarned = round2(summary.rates.earned / RATE_WINDOW_DAYS);
  summary.rates.net = round2(summary.rates.earned - summary.rates.spent);

  summary.alerts = alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return summary;
}

/* ────────────────────────── CSV exports ────────────────────────── */

export interface CsvMapping {
  /** Column headers, matched case-insensitively after trimming. */
  date: string;
  description: string;
  /** One signed column, or a debit column and a credit column (both positive in the file). */
  amount?: string;
  debit?: string;
  credit?: string;
  /** How dates are written. `auto` reads ISO and m/d/yyyy. */
  dateFormat?: 'auto' | 'iso' | 'mdy' | 'dmy';
  /** Some exports write spending as positive; this flips every signed amount. */
  negateAmount?: boolean;
  category?: string;
}

export interface CsvResult {
  transactions: Transaction[];
  /** Rows with no readable date or amount. */
  skipped: number;
  errors: string[];
}

const HEADER_NAMES: Record<keyof Pick<CsvMapping, 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'category'>, string[]> = {
  date: ['date', 'transaction date', 'posted date', 'posting date', 'post date', 'trans date'],
  description: ['description', 'memo', 'payee', 'name', 'details', 'merchant', 'narrative'],
  amount: ['amount', 'transaction amount', 'amt'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'money out', 'debit amount', 'paid out'],
  credit: ['credit', 'deposit', 'deposits', 'money in', 'credit amount', 'paid in'],
  category: ['category', 'type']
};

/** Splits one CSV line, honouring double quotes and doubled quotes inside them. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cell); cell = ''; }
    else cell += c;
  }
  out.push(cell);
  return out.map((v) => v.trim());
}

/** A mapping guessed from the header row, or null when the columns are not recognisable. */
export function detectMapping(headers: readonly string[]): CsvMapping | null {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const find = (names: readonly string[]): string | undefined => {
    const i = lower.findIndex((h) => names.includes(h));
    return i >= 0 ? headers[i]!.trim() : undefined;
  };
  const date = find(HEADER_NAMES.date);
  const description = find(HEADER_NAMES.description);
  const amount = find(HEADER_NAMES.amount);
  const debit = find(HEADER_NAMES.debit);
  const credit = find(HEADER_NAMES.credit);
  if (!date || !description || (!amount && !(debit && credit))) return null;
  const mapping: CsvMapping = { date, description, dateFormat: 'auto' };
  if (amount) mapping.amount = amount;
  else { mapping.debit = debit; mapping.credit = credit; }
  const category = find(HEADER_NAMES.category);
  if (category) mapping.category = category;
  return mapping;
}

/** "$1,234.56", "(12.00)", "-12.00", "12.00 CR" → a number, or null. */
export function parseAmount(text: string): number | null {
  const raw = text.trim();
  if (!raw) return null;
  const negativeParens = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[()$£€,\s]/g, '').replace(/CR$/i, '').replace(/DR$/i, '');
  if (!/^[-+]?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return negativeParens ? -Math.abs(n) : n;
}

/** A date in the export → ISO yyyy-mm-dd, or null. */
export function parseCsvDate(text: string, format: CsvMapping['dateFormat'] = 'auto'): string | null {
  const raw = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso && format !== 'mdy' && format !== 'dmy') return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(raw);
  if (!slash || format === 'iso') return null;
  const a = Number(slash[1]);
  const b = Number(slash[2]);
  let y = Number(slash[3]);
  if (y < 100) y += 2000;
  const [m, d] = format === 'dmy' ? [b, a] : [a, b];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** A stable id for a row: the same export imported twice adds nothing (`mergeTransactions`). */
function rowId(accountId: string, date: string, amount: number, description: string, ordinal: number): string {
  let h = 2166136261;
  const key = `${accountId}|${date}|${amount}|${description.toLowerCase()}|${ordinal}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${accountId}:${date}:${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/** Reads a bank export into transactions for one account. Never throws; unreadable rows are counted. */
export function parseCsv(text: string, accountId: string, mapping?: CsvMapping | null): CsvResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { transactions: [], skipped: 0, errors: ['THE FILE IS EMPTY'] };
  const headers = splitCsvLine(lines[0]!);
  const map = mapping ?? detectMapping(headers);
  if (!map) return { transactions: [], skipped: lines.length - 1, errors: [`NO DATE, DESCRIPTION AND AMOUNT COLUMNS FOUND IN: ${headers.join(', ')}`] };
  const col = (name: string | undefined): number => (name ? headers.findIndex((h) => h.toLowerCase() === name.trim().toLowerCase()) : -1);
  const iDate = col(map.date);
  const iDesc = col(map.description);
  const iAmount = col(map.amount);
  const iDebit = col(map.debit);
  const iCredit = col(map.credit);
  const iCat = col(map.category);
  const errors: string[] = [];
  if (iDate < 0) errors.push(`NO COLUMN "${map.date}"`);
  if (iDesc < 0) errors.push(`NO COLUMN "${map.description}"`);
  if (iAmount < 0 && (iDebit < 0 || iCredit < 0)) errors.push('NO AMOUNT COLUMN, AND NO DEBIT AND CREDIT PAIR');
  if (errors.length) return { transactions: [], skipped: lines.length - 1, errors };

  const transactions: Transaction[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const date = parseCsvDate(cells[iDate] ?? '', map.dateFormat);
    let amount: number | null;
    if (iAmount >= 0) {
      amount = parseAmount(cells[iAmount] ?? '');
      if (amount !== null && map.negateAmount) amount = -amount;
    } else {
      const debit = parseAmount(cells[iDebit] ?? '');
      const credit = parseAmount(cells[iCredit] ?? '');
      amount = debit !== null && debit !== 0 ? -Math.abs(debit) : credit !== null ? Math.abs(credit) : null;
    }
    if (!date || amount === null) { skipped++; continue; }
    const description = cells[iDesc] ?? '';
    const dupKey = `${date}|${amount}|${description.toLowerCase()}`;
    const ordinal = seen.get(dupKey) ?? 0;
    seen.set(dupKey, ordinal + 1);
    const t: Transaction = { id: rowId(accountId, date, amount, description, ordinal), accountId, date, amount, description, source: 'csv' };
    const category = iCat >= 0 ? cells[iCat]?.trim().toLowerCase() : '';
    if (category) t.category = category;
    transactions.push(t);
  }
  return { transactions, skipped, errors };
}

/* ────────────────────────── the board's view ────────────────────────── */

/** What `finance:status` answers: the last report, or why there is none. Never a made-up figure. */
export type FinanceStatus =
  | { ready: true; summary: Summary; file: string }
  | { ready: false; reason: string };

/** The LEDGER node is the `store.folder` that points at private/finance itself. */
export function isFinanceFolder(path: string | undefined): boolean {
  return /(^|[\\/])private[\\/]finance[\\/]?$/i.test((path ?? '').trim());
}
