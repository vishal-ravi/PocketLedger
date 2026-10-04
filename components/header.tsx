export function Header({title, subtitle, action}: {title: string; subtitle?: string; action?: React.ReactNode}) {
  return (
    <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between anim">
      <div>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          PocketLedger
        </div>
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}
