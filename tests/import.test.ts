import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  csvToRows,
  detectColumns,
  ofxToRows,
  parseAmountCell,
  parseCsv,
  parseDateCell,
  rowKey,
} from '../lib/import';

test('parseCsv handles quotes, escaped quotes and CRLF', () => {
  const {headers, rows} = parseCsv('Date,Description,Amount\r\n2026-10-03,"Coffee, large","""15.00"""\r\n');
  assert.deepEqual(headers, ['Date', 'Description', 'Amount']);
  assert.deepEqual(rows, [['2026-10-03', 'Coffee, large', '"15.00"']]);
});

test('parseCsv drops empty trailing lines and strips the BOM', () => {
  const {headers, rows} = parseCsv('\uFEFFDate,Description,Amount\n2026-10-03,Tea,20\n\n');
  assert.equal(headers[0], 'Date');
  assert.equal(rows.length, 1);
});

test('parseDateCell accepts the formats banks emit', () => {
  assert.equal(parseDateCell('2026-10-03'), '2026-10-03');
  assert.equal(parseDateCell('20261003'), '2026-10-03');
  assert.equal(parseDateCell('20261003120000.000[-5:IST]'), '2026-10-03');
  assert.equal(parseDateCell('03/10/2026'), '2026-10-03');
  assert.equal(parseDateCell('31/12/2026'), '2026-12-31');
  assert.equal(parseDateCell('03 Oct 2026'), '2026-10-03');
  assert.equal(parseDateCell('not a date'), null);
  assert.equal(parseDateCell('2026-02-30'), null);
});

test('parseAmountCell strips symbols and understands negatives', () => {
  assert.deepEqual(parseAmountCell('₹1,234.50'), {amount: 1234.5, negative: false});
  assert.deepEqual(parseAmountCell('(450.00)'), {amount: 450, negative: true});
  assert.deepEqual(parseAmountCell('-450'), {amount: 450, negative: true});
  assert.deepEqual(parseAmountCell('450.00 Dr'), {amount: 450, negative: true});
  assert.deepEqual(parseAmountCell('$99'), {amount: 99, negative: false});
  assert.equal(parseAmountCell('free'), null);
  assert.equal(parseAmountCell(''), null);
});

test('detectColumns maps the app export headers', () => {
  const map = detectColumns(['Date', 'Description', 'Category', 'Class', 'Payment Method', 'Card', 'Amount']);
  assert.equal(map?.date, 0);
  assert.equal(map?.description, 1);
  assert.equal(map?.category, 2);
  assert.equal(map?.type, 3);
  assert.equal(map?.amount, 6);
});

test('detectColumns recognises debit/credit style statements', () => {
  const map = detectColumns(['Transaction Date', 'Narration', 'Withdrawal Amount', 'Deposit Amount']);
  assert.ok(map);
  assert.equal(map.debit, 2);
  assert.equal(map.credit, 3);
  assert.equal(map.amount, undefined);
});

test('csvToRows imports the app export with its Class column', () => {
  const csv = [
    'Date,Description,Category,Class,Payment Method,Card,Amount,My Share,Split,Notes',
    '2026-10-01,Groceries,Food,NEED,UPI,,1250.00,1250.00,no,',
    '2026-10-02,Salary,Income,INCOME,BANK_TRANSFER,,65000.00,65000.00,no,',
  ].join('\n');
  const {rows, issues} = csvToRows(csv);
  assert.equal(issues.length, 0);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'NEED');
  assert.equal(rows[0].amount, 1250);
  assert.equal(rows[0].categoryName, 'Food');
  assert.equal(rows[1].type, 'INCOME');
});

test('csvToRows uses sign rules when there is no class column', () => {
  const csv = 'Date,Description,Amount\n2026-10-01,Refund,500\n2026-10-02,Shop,-900\n';
  const income = csvToRows(csv);
  assert.equal(income.rows[0].type, 'INCOME');
  assert.equal(income.rows[1].type, 'NEED');
  assert.equal(income.rows[1].amount, 900);

  const spending = csvToRows(csv, {positiveAs: 'NEED'});
  assert.equal(spending.rows[0].type, 'NEED');
});

test('csvToRows reads debit/credit columns and reports bad rows', () => {
  const csv = [
    'Date,Description,Debit,Credit',
    '01/10/2026,UPI payment,450,',
    '02/10/2026,Refund,,300',
    'bad-date,Broken,10,',
    '05/10/2026,,10,',
  ].join('\n');
  const {rows, issues} = csvToRows(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'NEED');
  assert.equal(rows[0].amount, 450);
  assert.equal(rows[1].type, 'INCOME');
  assert.equal(issues.length, 2);
  assert.match(issues[0].message, /unreadable date/);
  assert.match(issues[1].message, /missing description/);
});

test('csvToRows rejects an unrecognised header row', () => {
  const {rows, issues} = csvToRows('foo,bar\n1,2\n');
  assert.equal(rows.length, 0);
  assert.match(issues[0].message, /unrecognised columns/);
});

test('ofxToRows parses SGML statement transactions', () => {
  const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261001<TRNAMT>-450.00<FITID>1<NAME>SWIGGY</NAME></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261002<TRNAMT>1500.00<FITID>2<MEMO>Refund from Amazon</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const {rows, issues} = ofxToRows(ofx);
  assert.equal(issues.length, 0);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amount, 450);
  assert.equal(rows[0].type, 'NEED');
  assert.equal(rows[0].description, 'SWIGGY');
  assert.equal(rows[1].type, 'INCOME');
  assert.equal(rows[1].date, '2026-10-02');
});

test('ofxToRows flags an empty file', () => {
  const {rows, issues} = ofxToRows('<OFX></OFX>');
  assert.equal(rows.length, 0);
  assert.match(issues[0].message, /no <STMTTRN>/);
});

test('rowKey ignores case and spacing but not the day or amount', () => {
  const base = rowKey({date: '2026-10-03', description: 'Blue Tokai Coffee', amount: 450});
  assert.equal(base, rowKey({date: '2026-10-03', description: '  blue  tokaI coffee ', amount: 450.004}));
  assert.notEqual(base, rowKey({date: '2026-10-04', description: 'Blue Tokai Coffee', amount: 450}));
  assert.notEqual(base, rowKey({date: '2026-10-03', description: 'Blue Tokai Coffee', amount: 451}));
});
