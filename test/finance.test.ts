import { describe, expect, it } from 'vitest';
import {
  daysUntil,
  detectMapping,
  emptyLedger,
  formatMoney,
  isFinanceFolder,
  mergeTransactions,
  normaliseLedger,
  parseAmount,
  parseCsv,
  parseCsvDate,
  splitCsvLine,
  summarise,
  type Account,
  type Bill,
  type Ledger,
  type Transaction
} from '../packages/shared/finance.js';

/**
 * Every figure the FinanceOS room shows comes through `summarise`. These cases are the rules; the
 * numbers in them are test fixtures, not anyone's money.
 */

const NOW = new Date(2026, 8, 23, 12, 0, 0); // 2026-09-23, local

const acct = (over: Partial<Account> & { id: string; kind: Account['kind'] }): Account => ({
  name: over.id.toUpperCase(), institution: 'Test Bank', balance: 0, asOf: '2026-09-22', ...over
});
const bill = (over: Partial<Bill> & { id: string; dueDate: string }): Bill => ({ name: over.id, amount: 100, paid: false, ...over });
const tx = (over: Partial<Transaction> & { id: string; amount: number; date: string }): Transaction => ({
  accountId: 'chk', description: over.id, source: 'manual', ...over
});
const ledger = (over: Partial<Ledger>): Ledger => ({ ...emptyLedger(), ...over });

describe('normaliseLedger', () => {
  it('turns nothing, garbage and half-garbage into a usable ledger', () => {
    expect(normaliseLedger(undefined)).toEqual(emptyLedger());
    expect(normaliseLedger('no')).toEqual(emptyLedger());
    expect(normaliseLedger({ accounts: 'x', bills: 3, transactions: null })).toEqual(emptyLedger());
  });

  it('keeps well-formed rows and drops the rest, never a crash', () => {
    const out = normaliseLedger({
      currency: 'GBP',
      accounts: [
        { id: 'a', name: 'A', kind: 'checking', balance: 10, asOf: '2026-09-01', creditLimit: 0, apr: -1, dueDay: 40 },
        { id: 'b', name: 'B', kind: 'wallet', balance: 10, asOf: '2026-09-01' },
        { id: 'c', name: 'C', kind: 'credit', balance: 'ten', asOf: '2026-09-01' },
        { id: 'd', name: 'D', kind: 'credit', balance: 5, asOf: '2026-09-01', creditLimit: 100, apr: 19.99, minimumDue: 25, dueDay: 12.7 },
        null, 7
      ],
      bills: [{ id: 'b1', name: 'Rent', amount: 900, dueDate: '2026-10-01', paid: 'yes', autopay: true, account: 'a' }, { id: 'b2', name: 'x' }],
      transactions: [{ id: 't1', accountId: 'a', date: '2026-09-02', amount: -3.5, category: 'Coffee', source: 'csv' }, { id: 't2', accountId: 'a', date: '2026-09-02' }],
      thresholds: { staleDays: 0, lowBalance: { checking: 200, savings: 'lots', credit: 5 } }
    });
    expect(out.currency).toBe('GBP');
    expect(out.accounts.map((a) => a.id)).toEqual(['a', 'd']);
    expect(out.accounts[0]).toEqual({ id: 'a', name: 'A', institution: '', kind: 'checking', balance: 10, asOf: '2026-09-01' });
    expect(out.accounts[1]).toMatchObject({ creditLimit: 100, apr: 19.99, minimumDue: 25, dueDay: 12 });
    expect(out.bills).toEqual([{ id: 'b1', name: 'Rent', amount: 900, dueDate: '2026-10-01', paid: false, autopay: true, account: 'a' }]);
    expect(out.transactions).toEqual([{ id: 't1', accountId: 'a', date: '2026-09-02', amount: -3.5, description: '', category: 'coffee', source: 'csv' }]);
    expect(out.thresholds.staleDays).toBe(7);
    expect(out.thresholds.lowBalance).toEqual({ checking: 200, savings: 1000, cash: 100, credit: 5 });
  });
});

describe('summarise: nothing yet', () => {
  it('says how to start, with no meters and no invented figures', () => {
    const s = summarise(emptyLedger(), NOW);
    expect(s.ready).toBe(false);
    expect(s.meters).toEqual([]);
    expect(s.alerts).toHaveLength(1);
    expect(s.alerts[0]).toMatchObject({ severity: 'info', code: 'no-data' });
    expect(s.alerts[0]!.action).toContain('ledger.template.json');
    expect(s.totals.net).toBe(0);
  });
});

describe('summarise: meters', () => {
  it('fills a credit meter by balance over limit and colours it at 30% and 80%', () => {
    const s = summarise(ledger({ accounts: [
      acct({ id: 'c1', kind: 'credit', balance: 250, creditLimit: 1000 }),
      acct({ id: 'c2', kind: 'credit', balance: 400, creditLimit: 1000 }),
      acct({ id: 'c3', kind: 'credit', balance: 900, creditLimit: 1000 })
    ] }), NOW);
    expect(s.meters.map((m) => [m.fill, m.state])).toEqual([[0.25, 'ok'], [0.4, 'warn'], [0.9, 'fault']]);
    expect(s.meters[2]!.label).toBe('OWED $900.00 OF $1,000.00');
  });

  it('fills a holding account by balance over its low line, full at the line', () => {
    const s = summarise(ledger({ accounts: [
      acct({ id: 'chk', kind: 'checking', balance: 250 }),
      acct({ id: 'sav', kind: 'savings', balance: 5000 }),
      acct({ id: 'cash', kind: 'cash', balance: 20 })
    ] }), NOW);
    expect(s.meters.map((m) => m.fill)).toEqual([0.5, 1, 0.2]);
    expect(s.meters[0]!.label).toBe('BALANCE $250.00');
  });

  it('caps a credit meter at 1 and gives an unlimited card no fill', () => {
    const s = summarise(ledger({ accounts: [acct({ id: 'c', kind: 'credit', balance: 1500, creditLimit: 1000 }), acct({ id: 'd', kind: 'credit', balance: 300 })] }), NOW);
    expect(s.meters[0]!.fill).toBe(1);
    expect(s.meters[1]).toMatchObject({ fill: 0, state: 'ok', label: 'OWED $300.00' });
  });

  it('marks a balance older than staleDays, and one with no readable date', () => {
    const s = summarise(ledger({ accounts: [acct({ id: 'a', kind: 'checking', balance: 900, asOf: '2026-09-10' }), acct({ id: 'b', kind: 'checking', balance: 900, asOf: 'yesterday' }), acct({ id: 'c', kind: 'checking', balance: 900, asOf: '2026-09-17' })] }), NOW);
    expect(s.meters.map((m) => m.stale)).toEqual([true, true, false]);
    const stale = s.alerts.filter((a) => a.code === 'stale');
    expect(stale).toHaveLength(2);
    expect(stale[0]!.text).toBe('A IS 13 DAYS OLD');
    expect(stale[0]!.action).toContain('private/finance/imports/');
  });
});

describe('summarise: totals', () => {
  it('adds cash, credit and loans into debt and net, with utilisation over all limits', () => {
    const s = summarise(ledger({ accounts: [
      acct({ id: 'chk', kind: 'checking', balance: 1200 }),
      acct({ id: 'sav', kind: 'savings', balance: 3000 }),
      acct({ id: 'c1', kind: 'credit', balance: 500, creditLimit: 2000, minimumDue: 35 }),
      acct({ id: 'loan', kind: 'loan', balance: 8000, apr: 6.5, minimumDue: 150 })
    ] }), NOW);
    expect(s.totals).toEqual({ cash: 4200, credit: 500, loans: 8000, debt: 8500, net: -4300, creditLimit: 2000, utilisation: 0.25, minimumsDue: 185 });
    expect(s.meters[3]!.label).toBe('OWED $8,000.00 AT 6.5%');
  });

  it('has no utilisation without a limit', () => {
    expect(summarise(ledger({ accounts: [acct({ id: 'c', kind: 'credit', balance: 10 })] }), NOW).totals.utilisation).toBeNull();
  });
});

describe('summarise: alerts', () => {
  it('flags an overdue bill as a fault and one due within a week as a warning, with a paid one silent', () => {
    const s = summarise(ledger({ bills: [
      bill({ id: 'power', dueDate: '2026-09-20', amount: 80 }),
      bill({ id: 'rent', dueDate: '2026-09-28', amount: 900 }),
      bill({ id: 'water', dueDate: '2026-10-20' }),
      bill({ id: 'phone', dueDate: '2026-09-20', paid: true })
    ] }), NOW);
    expect(s.bills.overdue.map((b) => b.id)).toEqual(['power']);
    expect(s.bills.dueSoon.map((b) => b.id)).toEqual(['rent']);
    expect(s.bills.unpaid).toHaveLength(3);
    expect(s.bills.totalUnpaid).toBe(1080);
    expect(s.alerts.map((a) => [a.severity, a.code])).toEqual([['fault', 'bill-overdue'], ['warn', 'bill-due']]);
    expect(s.alerts[0]!.text).toBe('POWER ($80.00) IS 3 DAYS OVERDUE');
    expect(s.alerts[0]!.action).toContain('MARK IT paid');
    expect(s.alerts[1]!.text).toBe('RENT ($900.00) IS DUE IN 5 DAYS');
  });

  it('says DUE TODAY and singular DAY at the edges', () => {
    const s = summarise(ledger({ bills: [bill({ id: 'a', dueDate: '2026-09-23' }), bill({ id: 'b', dueDate: '2026-09-24' }), bill({ id: 'c', dueDate: '2026-09-22' })] }), NOW);
    expect(s.alerts.map((a) => a.text)).toEqual(['C ($100.00) IS 1 DAY OVERDUE', 'A ($100.00) IS DUE TODAY', 'B ($100.00) IS DUE IN 1 DAY']);
  });

  it('treats an autopay bill as information about the paying account, not a chore', () => {
    const s = summarise(ledger({ bills: [bill({ id: 'net', dueDate: '2026-09-25', autopay: true, account: 'chk' })] }), NOW);
    expect(s.alerts[0]).toMatchObject({ severity: 'info', code: 'bill-autopay' });
    expect(s.alerts[0]!.action).toBe('CHECK CHK HOLDS $100.00 ON 2026-09-25');
  });

  it('warns under the low line and faults when overdrawn', () => {
    const s = summarise(ledger({ accounts: [acct({ id: 'a', kind: 'checking', balance: 120 }), acct({ id: 'b', kind: 'checking', balance: -40 })] }), NOW);
    expect(s.alerts.map((a) => [a.severity, a.accountId])).toEqual([['fault', 'b'], ['warn', 'a']]);
    expect(s.alerts[0]!.text).toBe('B IS OVERDRAWN BY $40.00');
    expect(s.alerts[1]!.text).toBe('A IS UNDER ITS $500.00 LINE ($120.00)');
  });

  it('has no low line for a kind with no threshold', () => {
    const l = ledger({ accounts: [acct({ id: 'a', kind: 'cash', balance: 5 })] });
    delete l.thresholds.lowBalance.cash;
    const s = summarise(l, NOW);
    expect(s.alerts).toEqual([]);
    expect(s.meters[0]!.fill).toBe(1);
  });

  it('warns at 30% and faults at 80% on one card, and on the whole once there are two', () => {
    const one = summarise(ledger({ accounts: [acct({ id: 'c', kind: 'credit', balance: 850, creditLimit: 1000, apr: 24.99 })] }), NOW);
    expect(one.alerts.map((a) => a.code)).toEqual(['account-utilisation']);
    expect(one.alerts[0]!.action).toBe('PAY C DOWN BELOW $300.00 BEFORE ANYTHING ELSE — 24.99% APR');
    const two = summarise(ledger({ accounts: [acct({ id: 'c', kind: 'credit', balance: 350, creditLimit: 1000 }), acct({ id: 'd', kind: 'credit', balance: 200, creditLimit: 1000 })] }), NOW);
    expect(two.alerts.map((a) => [a.severity, a.code])).toEqual([['warn', 'account-utilisation']]);
    const both = summarise(ledger({ accounts: [acct({ id: 'c', kind: 'credit', balance: 900, creditLimit: 1000 }), acct({ id: 'd', kind: 'credit', balance: 900, creditLimit: 1000 })] }), NOW);
    expect(both.alerts.filter((a) => a.code === 'utilisation')[0]).toMatchObject({ severity: 'fault', text: '90% OF ALL CREDIT IS USED ($1,800.00 OF $2,000.00)' });
  });

  it('faults when the minimum payments exceed the cash to pay them', () => {
    const s = summarise(ledger({ accounts: [acct({ id: 'chk', kind: 'checking', balance: 100 }), acct({ id: 'c', kind: 'credit', balance: 500, creditLimit: 5000, minimumDue: 60 }), acct({ id: 'l', kind: 'loan', balance: 900, minimumDue: 90 })] }), NOW);
    const m = s.alerts.find((a) => a.code === 'minimums');
    expect(m).toMatchObject({ severity: 'fault', text: 'MINIMUM PAYMENTS ($150.00) EXCEED CASH ON HAND ($100.00)' });
    expect(m!.action).toContain('$50.00');
  });

  it('orders faults before warnings before information', () => {
    const s = summarise(ledger({
      accounts: [acct({ id: 'a', kind: 'checking', balance: 100, asOf: '2026-08-01' })],
      bills: [bill({ id: 'x', dueDate: '2026-09-25', autopay: true }), bill({ id: 'y', dueDate: '2026-09-01' })]
    }), NOW);
    expect(s.alerts.map((a) => a.severity)).toEqual(['fault', 'warn', 'warn', 'info']);
  });
});

describe('summarise: rates', () => {
  const accounts = [acct({ id: 'chk', kind: 'checking', balance: 1000 }), acct({ id: 'card', kind: 'credit', balance: 100, creditLimit: 1000 })];

  it('sums spending and earning over the last 30 days only', () => {
    const s = summarise(ledger({ accounts, transactions: [
      tx({ id: 'pay', amount: 2000, date: '2026-09-01' }),
      tx({ id: 'rent', amount: -900, date: '2026-09-02' }),
      tx({ id: 'food', amount: -150.5, date: '2026-09-20', accountId: 'card' }),
      tx({ id: 'old', amount: -400, date: '2026-08-20' }),
      tx({ id: 'future', amount: -400, date: '2026-09-30' })
    ] }), NOW);
    expect(s.rates).toEqual({ windowDays: 30, spent: 1050.5, earned: 2000, perDaySpent: 35.02, perDayEarned: 66.67, net: 949.5, transactions: 3 });
  });

  it('ignores transfers and payments, and a card refund is not earning', () => {
    const s = summarise(ledger({ accounts, transactions: [
      tx({ id: 'tocard', amount: -300, date: '2026-09-10', category: 'payment' }),
      tx({ id: 'fromchk', amount: 300, date: '2026-09-10', accountId: 'card', category: 'transfer' }),
      tx({ id: 'refund', amount: 40, date: '2026-09-11', accountId: 'card' }),
      tx({ id: 'coffee', amount: -4, date: '2026-09-11', accountId: 'card' })
    ] }), NOW);
    expect(s.rates).toMatchObject({ spent: 4, earned: 0, transactions: 2 });
  });

  it('counts the window from the start of today, inclusive of today', () => {
    const s = summarise(ledger({ accounts, transactions: [tx({ id: 'edge', amount: -10, date: '2026-08-24' }), tx({ id: 'today', amount: -1, date: '2026-09-23' }), tx({ id: 'out', amount: -10, date: '2026-08-23' })] }), NOW);
    expect(s.rates.spent).toBe(11);
  });
});

describe('dates and money', () => {
  it('counts days to a date, negative once passed, null when unreadable', () => {
    expect(daysUntil('2026-09-30', NOW)).toBe(7);
    expect(daysUntil('2026-09-23', NOW)).toBe(0);
    expect(daysUntil('2026-09-20', NOW)).toBe(-3);
    expect(daysUntil('soon', NOW)).toBeNull();
  });

  it('formats money with thousands, cents, sign and currency', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50');
    expect(formatMoney(-0.05)).toBe('-$0.05');
    expect(formatMoney(12, 'GBP')).toBe('£12.00');
    expect(formatMoney(12, 'CAD')).toBe('CAD 12.00');
  });

  it('reads the ways banks write an amount', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
    expect(parseAmount('(12.00)')).toBe(-12);
    expect(parseAmount('-12.00')).toBe(-12);
    expect(parseAmount('12.00 CR')).toBe(12);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('n/a')).toBeNull();
  });

  it('reads ISO and slash dates, US by default', () => {
    expect(parseCsvDate('2026-09-05')).toBe('2026-09-05');
    expect(parseCsvDate('2026-09-05T10:00:00Z')).toBe('2026-09-05');
    expect(parseCsvDate('9/5/2026')).toBe('2026-09-05');
    expect(parseCsvDate('05/09/2026', 'dmy')).toBe('2026-09-05');
    expect(parseCsvDate('9/5/26')).toBe('2026-09-05');
    expect(parseCsvDate('13/5/2026')).toBeNull();
    expect(parseCsvDate('Sep 5', 'auto')).toBeNull();
  });
});

describe('parseCsv', () => {
  it('splits quoted cells with commas and doubled quotes', () => {
    expect(splitCsvLine('a,"b, c","say ""hi""",d')).toEqual(['a', 'b, c', 'say "hi"', 'd']);
  });

  it('detects a signed-amount export and a debit/credit export', () => {
    expect(detectMapping(['Transaction Date', 'Description', 'Amount', 'Category'])).toEqual({ date: 'Transaction Date', description: 'Description', amount: 'Amount', dateFormat: 'auto', category: 'Category' });
    expect(detectMapping(['Date', 'Payee', 'Withdrawal', 'Deposit'])).toEqual({ date: 'Date', description: 'Payee', debit: 'Withdrawal', credit: 'Deposit', dateFormat: 'auto' });
    expect(detectMapping(['Foo', 'Bar'])).toBeNull();
    expect(detectMapping(['Date', 'Description', 'Withdrawal'])).toBeNull();
  });

  it('reads a signed export with a BOM, CRLF and a quoted description', () => {
    const text = '﻿Date,Description,Amount\r\n09/01/2026,"ACME, INC PAYROLL",2000.00\r\n09/02/2026,RENT,-900.00\r\n';
    const out = parseCsv(text, 'chk');
    expect(out.errors).toEqual([]);
    expect(out.skipped).toBe(0);
    expect(out.transactions.map((t) => [t.date, t.amount, t.description, t.accountId, t.source])).toEqual([
      ['2026-09-01', 2000, 'ACME, INC PAYROLL', 'chk', 'csv'],
      ['2026-09-02', -900, 'RENT', 'chk', 'csv']
    ]);
  });

  it('reads a debit/credit export as signed amounts', () => {
    const out = parseCsv('Date,Payee,Withdrawal,Deposit\n2026-09-03,COFFEE,4.50,\n2026-09-04,REFUND,,4.50\n', 'chk');
    expect(out.transactions.map((t) => t.amount)).toEqual([-4.5, 4.5]);
  });

  it('flips a positive-is-spending export with negateAmount and honours an explicit mapping', () => {
    const out = parseCsv('Posted,Merchant,Amt\n2026-09-03,COFFEE,4.50\n2026-09-04,PAYMENT THANK YOU,-100\n', 'card', { date: 'Posted', description: 'Merchant', amount: 'Amt', negateAmount: true });
    expect(out.transactions.map((t) => t.amount)).toEqual([-4.5, 100]);
  });

  it('counts rows it cannot read and names a missing column', () => {
    const out = parseCsv('Date,Description,Amount\nnot a date,X,1\n2026-09-01,Y,lots\n2026-09-01,Z,1\n', 'chk');
    expect(out.skipped).toBe(2);
    expect(out.transactions).toHaveLength(1);
    expect(parseCsv('Date,Description,Amount\n2026-09-01,Z,1\n', 'chk', { date: 'When', description: 'Description', amount: 'Amount' }).errors).toEqual(['NO COLUMN "When"']);
    expect(parseCsv('', 'chk').errors).toEqual(['THE FILE IS EMPTY']);
    expect(parseCsv('Foo,Bar\n1,2\n', 'chk').errors[0]).toContain('NO DATE, DESCRIPTION AND AMOUNT');
  });

  it('gives identical rows distinct ids, and the same file the same ids twice', () => {
    const text = 'Date,Description,Amount\n2026-09-01,COFFEE,-4\n2026-09-01,COFFEE,-4\n';
    const a = parseCsv(text, 'chk').transactions;
    const b = parseCsv(text, 'chk').transactions;
    expect(a[0]!.id).not.toBe(a[1]!.id);
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    expect(a[0]!.id.startsWith('chk:2026-09-01:')).toBe(true);
    const merged = mergeTransactions(a, b);
    expect(merged.added).toBe(0);
    expect(merged.transactions).toHaveLength(2);
    expect(mergeTransactions([], a).added).toBe(2);
  });
});

describe('isFinanceFolder', () => {
  it('recognises the ledger folder in the shapes a board writes it', () => {
    expect(isFinanceFolder('%SKYNET%/private/finance')).toBe(true);
    expect(isFinanceFolder('C:/dev/SkynetOS/private/finance/')).toBe(true);
    expect(isFinanceFolder('C:\\dev\\SkynetOS\\private\\finance')).toBe(true);
    expect(isFinanceFolder('%SKYNET%/private/finance/imports')).toBe(false);
    expect(isFinanceFolder('%SKYNET%/private')).toBe(false);
    expect(isFinanceFolder(undefined)).toBe(false);
  });
});
