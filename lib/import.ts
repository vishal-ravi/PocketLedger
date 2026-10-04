export type ImportType = 'NEED' | 'WANT' | 'INCOME';

export type ParsedRow = {
  line: number;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // always positive
  type: ImportType;
  categoryName?: string;
};

export type RowIssue = {line: number; message: string; raw?: string};

export type ParseResult = {rows: ParsedRow[]; issues: RowIssue[]};

export type PositiveAs = 'INCOME' | 'NEED';

/* ------------------------------------------------------------------ dates */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function iso(year: number, month: number, day: number): string | null {
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** Accepts YYYY-MM-DD, YYYY/MM/DD, YYYYMMDD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, "03 Oct 2026". */
export function parseDateCell(value: string): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  // YYYYMMDD, optionally followed by a time like 120000.000[-5:IST]
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) {
    const result = iso(Number(compact[1]), Number(compact[2]), Number(compact[3]));
    if (result) return result;
  }

  const isoLike = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoLike) return iso(Number(isoLike[1]), Number(isoLike[2]), Number(isoLike[3]));

  // Day-first when unambiguous; both parts ≤12 stays day-first (en-IN convention).
  const dmy = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += year > 70 ? 1900 : 2000;
    if (month > 12 || day > 31) return null;
    return iso(year, month, day);
  }

  const named = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})/);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    let year = Number(named[3]);
    if (month && year) {
      if (year < 100) year += 70;
      return iso(year, month, Number(named[1]));
    }
  }

  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  return null;
}

/* ---------------------------------------------------------------- amounts */

/** "₹1,234.50", "1234.50", "(450.00)", "-450.00", "450.00 Dr" → {amount, negative} */
export function parseAmountCell(value: string): {amount: number; negative: boolean} | null {
  let text = String(value ?? '').trim();
  if (!text) return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  // Trailing markers some banks append: "450.00 Dr", "450.00 Cr"
  const marker = text.match(/^(.*?)[\s]*(dr|cr|debit|credit|withdrawal|deposit|withdrawals|deposits)$/i);
  if (marker) {
    negative = /^(dr|debit|withdrawal|withdrawals)$/i.test(marker[2]);
    text = marker[1];
  }

  text = text.replace(/[₹$€£¥,\s]/g, '');
  const trailing = text.match(/^-?(.*?)([+-])$/);
  if (trailing) {
    text = trailing[1];
    if (trailing[2] === '-') negative = !negative;
  }
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return {amount, negative};
}

/* -------------------------------------------------------------------- CSV */

export function parseCsv(text: string): {headers: string[]; rows: string[][]} {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const source = String(text ?? '').replace(/^\uFEFF/, '');

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      out.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  out.push(row);

  const clean = out.filter((r) => r.some((cell) => cell.trim() !== ''));
  const headers = (clean.shift() ?? []).map((h) => h.trim());
  return {headers, rows: clean};
}

const norm = (value: string) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const ALIASES = {
  date: ['date', 'transactiondate', 'posteddate', 'trndate', 'valuedate', 'bookingdate', 'dt', 'tran date'],
  description: [
    'description', 'narration', 'details', 'memo', 'name', 'payee', 'particulars', 'particular',
    'transaction', 'narration1', 'remarks', 'reference', 'transactionremarks',
  ],
  amount: ['amount', 'value', 'netamount', 'transactionamount', 'tranamount', 'amt'],
  debit: ['debit', 'debitamount', 'withdrawal', 'withdrawals', 'withdrawalamount', 'withdrawalamt', 'paidout', 'dr', 'expense'],
  credit: ['credit', 'creditamount', 'deposit', 'deposits', 'depositamount', 'depositamt', 'paidin', 'cr', 'income'],
  category: ['category', 'budgetcategory', 'tag', 'label'],
  type: ['type', 'class', 'categorytype'],
};

export type ColumnMap = {
  date: number;
  description: number;
  amount?: number;
  debit?: number;
  credit?: number;
  category?: number;
  type?: number;
};

export function detectColumns(headers: string[]): ColumnMap | null {
  const wanted: (keyof typeof ALIASES)[] = ['date', 'description', 'amount', 'debit', 'credit', 'category', 'type'];
  const found: Record<string, number> = {};
  headers.forEach((header, index) => {
    const key = norm(header);
    for (const name of wanted) {
      if (found[name] === undefined && ALIASES[name].includes(key)) found[name] = index;
    }
  });
  if (found.date === undefined || found.description === undefined) return null;
  if (found.amount === undefined && found.debit === undefined && found.credit === undefined) return null;
  return found as ColumnMap;
}

export type CsvParseOptions = {positiveAs?: PositiveAs; hasHeader?: boolean};

export function csvToRows(text: string, options: CsvParseOptions = {}): ParseResult {
  const positiveAs: PositiveAs = options.positiveAs ?? 'INCOME';
  const {headers, rows} = parseCsv(text);
  const map = detectColumns(headers);
  const issues: RowIssue[] = [];
  const parsed: ParsedRow[] = [];
  if (!map) {
    return {rows: [], issues: [{line: 1, message: `unrecognised columns: ${headers.join(', ') || '(none)'}`}]};
  }

  rows.forEach((cells, index) => {
    const line = index + 2; // header is line 1
    const rawLine = cells.join(', ');
    const date = parseDateCell(cells[map.date] ?? '');
    if (!date) {
      issues.push({line, message: `row ${line}: unreadable date "${cells[map.date] ?? ''}"`, raw: rawLine});
      return;
    }
    const description = (cells[map.description] ?? '').trim();
    if (!description) {
      issues.push({line, message: `row ${line}: missing description`, raw: rawLine});
      return;
    }

    let amount = 0;
    let isCredit = false;
    let type: ImportType | null = null;

    if (map.type !== undefined) {
      const cell = norm(cells[map.type] ?? '');
      if (cell === 'need' || cell === 'wants' || cell === 'want' || cell === 'income' || cell === 'needs') {
        type = cell.startsWith('inc') ? 'INCOME' : cell.startsWith('wa') ? 'WANT' : 'NEED';
      } else if (cell === 'credit' || cell === 'cr' || cell === 'deposit') {
        isCredit = true;
      } else if (cell === 'debit' || cell === 'dr' || cell === 'withdrawal') {
        isCredit = false;
      }
    }

    if (map.amount !== undefined) {
      const parsedAmount = parseAmountCell(cells[map.amount] ?? '');
      if (!parsedAmount || parsedAmount.amount === 0) {
        issues.push({line, message: `row ${line}: unreadable amount "${cells[map.amount] ?? ''}"`, raw: rawLine});
        return;
      }
      amount = parsedAmount.amount;
      isCredit = parsedAmount.negative === false;
      if (type === null) type = parsedAmount.negative ? 'NEED' : positiveAs;
    } else {
      const debit = map.debit !== undefined ? parseAmountCell(cells[map.debit] ?? '') : null;
      const credit = map.credit !== undefined ? parseAmountCell(cells[map.credit] ?? '') : null;
      const debitAmount = debit && debit.amount > 0 ? debit.amount : 0;
      const creditAmount = credit && credit.amount > 0 ? credit.amount : 0;
      if (debitAmount > 0 && creditAmount > 0) {
        issues.push({line, message: `row ${line}: both debit and credit are filled`, raw: rawLine});
        return;
      }
      if (debitAmount > 0) {
        amount = debitAmount;
        isCredit = false;
      } else if (creditAmount > 0) {
        amount = creditAmount;
        isCredit = true;
      } else {
        issues.push({line, message: `row ${line}: no amount found`, raw: rawLine});
        return;
      }
      if (type === null) type = isCredit ? 'INCOME' : 'NEED';
    }

    if (amount <= 0) {
      issues.push({line, message: `row ${line}: amount must be greater than 0`, raw: rawLine});
      return;
    }
    if (type === null) type = isCredit ? 'INCOME' : 'NEED';

    const categoryName = map.category !== undefined ? (cells[map.category] ?? '').trim() : undefined;
    parsed.push({line, date, description: description.slice(0, 200), amount, type, categoryName: categoryName || undefined});
  });

  return {rows: parsed, issues};
}

/* -------------------------------------------------------------------- OFX */

const ofxField = (block: string, tag: string) => {
  const match = block.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i'));
  return match ? match[1].trim() : '';
};

/** OFX/QFX (v1 SGML or XML) statement export → rows. */
export function ofxToRows(text: string): ParseResult {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const issues: RowIssue[] = [];
  const rows: ParsedRow[] = [];

  const blocks = source.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  blocks.forEach((block, index) => {
    const line = index + 1;
    const amountRaw = ofxField(block, 'TRNAMT');
    const dateRaw = ofxField(block, 'DTPOSTED');
    const description = (ofxField(block, 'NAME') || ofxField(block, 'MEMO') || ofxField(block, 'FITID')).trim();
    const amount = parseAmountCell(amountRaw);
    const date = parseDateCell(dateRaw);
    if (!date) {
      issues.push({line, message: `txn ${line}: unreadable date "${dateRaw}"`});
      return;
    }
    if (!description) {
      issues.push({line, message: `txn ${line}: missing description`});
      return;
    }
    if (!amount || amount.amount === 0) {
      issues.push({line, message: `txn ${line}: unreadable amount "${amountRaw}"`});
      return;
    }
    rows.push({
      line,
      date,
      description: description.slice(0, 200),
      amount: amount.amount,
      type: amount.negative ? 'NEED' : 'INCOME',
    });
  });

  if (rows.length === 0 && issues.length === 0) {
    issues.push({line: 1, message: 'no <STMTTRN> transactions found in this OFX file'});
  }
  return {rows, issues};
}

/* ------------------------------------------------------------------ dedupe */

/** Stable identity for a transaction: same day + merchant + amount = same row. */
export function rowKey(row: {date: string; description: string; amount: number}): string {
  return `${row.date}|${Math.round(row.amount * 100)}|${row.description.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}
