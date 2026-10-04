'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {Header} from '@/components/header';
import {formatMoney, useUser} from '@/lib/use-user';
import {FileUp, CheckCircle2, AlertTriangle} from 'lucide-react';

type PreviewRow = {line: number; date: string; description: string; amount: number; type: string; categoryName: string | null};
type Issue = {line: number; message: string};
type DryRun = {
  source: string;
  planned: number;
  duplicates: number;
  skipped: number;
  issues: Issue[];
  preview: PreviewRow[];
};

const METHODS = [
  {value: 'UPI', label: 'UPI'},
  {value: 'CREDIT_CARD', label: 'Credit card'},
  {value: 'DEBIT_CARD', label: 'Debit card'},
  {value: 'BANK_TRANSFER', label: 'Bank transfer'},
  {value: 'CASH', label: 'Cash'},
];

export default function Import() {
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [categories, setCategories] = useState<{id: string; name: string}[]>([]);
  const [cards, setCards] = useState<{id: string; cardName: string}[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [creditCardId, setCreditCardId] = useState('');
  const [positiveAs, setPositiveAs] = useState<'INCOME' | 'NEED'>('INCOME');
  const [dedupe, setDedupe] = useState(true);
  const [result, setResult] = useState<DryRun | null>(null);
  const [done, setDone] = useState<{imported: number; duplicates: number; skipped: number} | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const user = useUser();
  const symbol = user?.currencySymbol ?? '₹';
  const money = (value: number) => formatMoney(value, symbol);

  useEffect(() => {
    fetch('/api/categories')
      .then((r) => r.json())
      .then((d) => setCategories(d.categories || []))
      .catch(() => {});
    fetch('/api/credit-cards')
      .then((r) => r.json())
      .then((d) => setCards(d.cards || []))
      .catch(() => {});
  }, []);

  type Overrides = Partial<{
    categoryId: string;
    paymentMethod: string;
    creditCardId: string;
    positiveAs: 'INCOME' | 'NEED';
    dedupe: boolean;
  }>;

  const preview = useCallback(
    async (text: string, overrides: Overrides = {}) => {
      if (!text) return;
      const options = {categoryId, paymentMethod, creditCardId, positiveAs, dedupe, ...overrides};
      setBusy(true);
      setError('');
      setDone(null);
      try {
        const res = await fetch('/api/import', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            content: text,
            dryRun: true,
            categoryId: options.categoryId || null,
            paymentMethod: options.paymentMethod,
            creditCardId: options.creditCardId || null,
            positiveAs: options.positiveAs,
            dedupe: options.dedupe,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Could not read this file');
          setResult(null);
          return;
        }
        setResult(data);
      } catch {
        setError('Network error — could not parse the file');
      } finally {
        setBusy(false);
      }
    },
    [categoryId, paymentMethod, creditCardId, positiveAs, dedupe],
  );

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    setContent(text);
    await preview(text);
  }

  const changed = (overrides: Overrides) => {
    if (content) preview(content, overrides);
  };

  async function run() {
    if (!content) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({content, dryRun: false, categoryId: categoryId || null, paymentMethod, creditCardId: creditCardId || null, positiveAs, dedupe}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Import failed');
        return;
      }
      setDone({imported: data.imported, duplicates: data.duplicates, skipped: data.skipped});
      setResult(null);
      setContent('');
      setFileName('');
      if (fileRef.current) fileRef.current.value = '';
    } catch {
      setError('Network error — nothing was imported');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setContent('');
    setFileName('');
    setResult(null);
    setDone(null);
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <>
      <Header
        title="Import transactions"
        subtitle="Bring in a bank or card statement as CSV or OFX/QFX."
        action={
          <Link className="btn btn-soft" href="/expenses">
            Back to Daily Log
          </Link>
        }
      />

      <div className="card mb-5 p-5 anim">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/40 px-6 py-10 text-center transition hover:border-emerald-400 hover:bg-emerald-50">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-600 text-white">
            <FileUp size={22} />
          </span>
          <span className="text-sm font-bold text-slate-800">{fileName || 'Choose a .csv, .ofx or .qfx file'}</span>
          <span className="text-xs font-semibold text-slate-500">
            CSV with a Date / Description / Amount header, or an OFX statement (max ~2MB, 5000 rows)
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.ofx,.qfx,text/csv,application/ofx"
            className="hidden"
            onChange={onFile}
            data-testid="import-file"
          />
        </label>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" data-testid="import-error">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {done && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" data-testid="import-result">
          <span className="flex items-center gap-2 font-bold">
            <CheckCircle2 size={16} /> Imported {done.imported} transactions
            {done.duplicates > 0 && <span className="font-semibold">· {done.duplicates} duplicates skipped</span>}
            {done.skipped > 0 && <span className="font-semibold">· {done.skipped} need a category</span>}
          </span>
          <Link className="font-bold text-emerald-700 underline" href="/expenses">
            View in Daily Log →
          </Link>
        </div>
      )}

      <div className="card mb-5 grid gap-4 p-5 anim sm:grid-cols-2 xl:grid-cols-4" style={{['--d' as string]: '60ms'}}>
        <label className="label">
          Fallback category
          <select
            className="input"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              changed({categoryId: e.target.value});
            }}
            data-testid="import-category"
          >
            <option value="">No fallback</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="label">
          Paid via
          <select
            className="input"
            value={paymentMethod}
            onChange={(e) => {
              setPaymentMethod(e.target.value);
              changed({paymentMethod: e.target.value});
            }}
            data-testid="import-method"
          >
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>
        {paymentMethod === 'CREDIT_CARD' && (
          <label className="label">
            Which card?
            <select
              className="input"
              value={creditCardId}
              onChange={(e) => {
                setCreditCardId(e.target.value);
                changed({creditCardId: e.target.value});
              }}
              data-testid="import-card"
            >
              <option value="">Select a credit card…</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>{c.cardName}</option>
              ))}
            </select>
          </label>
        )}
        <label className="label">
          Positive amounts are
          <select
            className="input"
            value={positiveAs}
            onChange={(e) => {
              const value = e.target.value as 'INCOME' | 'NEED';
              setPositiveAs(value);
              changed({positiveAs: value});
            }}
            data-testid="import-positive"
          >
            <option value="INCOME">Income</option>
            <option value="NEED">Spending</option>
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 self-end pb-1 text-[13px] font-semibold text-slate-700 sm:col-span-2 xl:col-span-4">
          <input
            type="checkbox"
            className="h-4 w-4 accent-emerald-600"
            checked={dedupe}
            onChange={(e) => {
              setDedupe(e.target.checked);
              changed({dedupe: e.target.checked});
            }}
            data-testid="import-dedupe"
          />
          Skip rows that already exist (same day, merchant and amount)
        </label>
      </div>

      {result && (
        <div className="card overflow-hidden anim" style={{['--d' as string]: '120ms'}} data-testid="import-preview">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
            <div>
              <h2 className="font-bold text-slate-900">Preview · {result.source}</h2>
              <p className="text-xs text-slate-500">Nothing is saved until you confirm.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
              <span className="badge badge-need" data-testid="import-planned">{result.planned} to import</span>
              {result.duplicates > 0 && <span className="badge">{result.duplicates} duplicates</span>}
              {result.skipped > 0 && <span className="badge badge-want">{result.skipped} skipped</span>}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Class</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {result.preview.map((row) => (
                  <tr key={`${row.line}-${row.date}-${row.description}`}>
                    <td className="whitespace-nowrap">{row.date}</td>
                    <td className="max-w-[24rem] truncate">{row.description}</td>
                    <td>
                      <span className={row.type === 'INCOME' ? 'badge badge-income' : row.type === 'WANT' ? 'badge badge-want' : 'badge badge-need'}>
                        {row.type}
                      </span>
                    </td>
                    <td className="text-right font-bold">{money(row.amount)}</td>
                  </tr>
                ))}
                {result.preview.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center text-sm font-semibold text-slate-400">
                      No importable rows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {result.issues.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto border-t border-slate-100 p-4 text-xs text-rose-600" data-testid="import-issues">
              {result.issues.slice(0, 20).map((issue) => (
                <li key={`${issue.line}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 p-5">
            <button className="btn btn-primary" onClick={run} disabled={busy || result.planned === 0} data-testid="import-submit">
              {busy ? 'Working…' : `Import ${result.planned} transactions`}
            </button>
            <button className="btn btn-ghost" onClick={reset}>
              Start over
            </button>
          </div>
        </div>
      )}
    </>
  );
}
