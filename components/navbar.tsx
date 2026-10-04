'use client';
import {useEffect, useState} from 'react';
import Link from 'next/link';
import {usePathname, useRouter} from 'next/navigation';
import {CommandPalette} from '@/components/command-palette';
import {
  FileText,
  FileUp,
  IndianRupee,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Menu,
  Plus,
  Receipt,
  Repeat,
  Settings,
  Split,
  Tags,
  Wallet,
  WalletCards,
  X,
} from 'lucide-react';

type NavLink = {href: string; label: string; Icon: typeof Settings; wide?: boolean};

export const links: NavLink[] = [
  {href: '/', label: 'Dashboard', Icon: LayoutDashboard},
  {href: '/insights', label: 'Insights', Icon: Lightbulb},
  {href: '/expenses', label: 'Daily Log', Icon: Receipt},
  {href: '/recurring', label: 'Recurring', Icon: Repeat},
  {href: '/import', label: 'Import', Icon: FileUp},
  {href: '/splits', label: 'Splits', Icon: Split},
  {href: '/budgets', label: 'Categories', Icon: Tags},
  {href: '/cards', label: 'Cards', Icon: WalletCards},
  {href: '/statements', label: 'Statements', Icon: FileText, wide: true},
  {href: '/loans', label: 'Loans', Icon: Landmark},
  {href: '/settings', label: 'Settings', Icon: Settings},
];

type Me = {fullName: string; email: string} | null;

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<Me>(null);

  const isAuthPage = pathname === '/login' || pathname === '/signup';

  useEffect(() => {
    if (isAuthPage) return;
    fetch('/api/auth/me')
      .then((res) => {
        // Valid-looking cookie but the session was revoked server-side (password reset / log out everywhere).
        if (res.status === 401) {
          window.location.replace('/login');
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((data) => setUser(data?.user ?? null))
      .catch(() => setUser(null));
  }, [isAuthPage]);

  async function logout() {
    await fetch('/api/auth/logout', {method: 'POST'}).catch(() => null);
    setUser(null);
    setOpen(false);
    router.replace('/login');
    router.refresh();
  }

  if (pathname === '/login' || pathname === '/signup') return null;

  const firstName = user?.fullName.split(' ')[0] || 'Account';

  // compact=true in the top bar (space is tight beside the nav); compact=false in the mobile menu
  const account = (compact: boolean) => {
    const label = compact ? 'hidden lg:inline xl:hidden 2xl:inline' : '';
    if (!user) {
      return (
        <Link href="/login" className="chip chip-on-dark" data-testid="nav-login">
          <LogOut size={15} strokeWidth={2.4} className="rotate-180" />
          <span className={label}>Sign in</span>
        </Link>
      );
    }
    return (
      <>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-300 text-[12px] font-extrabold text-emerald-950">
          {firstName.slice(0, 1).toUpperCase()}
        </span>
        <span className={`${compact ? 'hidden 2xl:inline' : ''} max-w-[9rem] truncate font-semibold`}>{firstName}</span>
        <button className="chip chip-on-dark" onClick={logout} aria-label="Log out" title="Log out" data-testid="logout">
          <LogOut size={15} strokeWidth={2.4} />
          <span className={label}>Log out</span>
        </button>
      </>
    );
  };

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[linear-gradient(135deg,#052e22_0%,#065f46_55%,#047857_100%)] text-emerald-50 shadow-[0_16px_40px_-24px_rgba(3,30,22,.9)]">
      <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-3 md:px-8">
        <Link href="/" className="group flex items-center gap-3" onClick={() => setOpen(false)}>
          <span className="icon-tile icon-tile-soft transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:rotate-3">
            <IndianRupee size={20} strokeWidth={2.6} className="text-emerald-950" />
          </span>
          <span className="leading-tight">
            <span className="block whitespace-nowrap text-[17px] font-extrabold tracking-tight">PocketLedger</span>
            <span className="hidden whitespace-nowrap text-[11px] text-emerald-200/80 2xl:block">Daily Log • Budgets • Splits</span>
          </span>
        </Link>

        <nav className="ml-1 hidden items-center gap-1 xl:flex">
          {links.map(({href, label, Icon, wide}) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`chip-on-dark ${
                  wide ? 'hidden min-[1440px]:inline-flex' : 'inline-flex'
                } items-center gap-1.5 whitespace-nowrap rounded-xl px-2 py-2 text-[11.5px] font-semibold transition-all duration-300 ${
                  active ? 'data-[active=true]:shadow-lg' : ''
                }`}
                data-active={active}
              >
                <Icon size={14} strokeWidth={2.2} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <CommandPalette />
          <div className="hidden items-center gap-2 md:flex">{account(true)}</div>
          <button
            className="chip chip-on-dark xl:hidden"
            aria-label="Toggle navigation"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="anim-fade grid gap-1.5 border-t border-white/10 bg-emerald-950/60 px-4 py-3 xl:hidden">
          {links.map(({href, label, Icon}, index) => (
            <Link
              key={href}
              href={href}
              data-active={pathname === href}
              onClick={() => setOpen(false)}
              className="chip-on-dark flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold"
              style={{['--d' as string]: `${index * 45}ms`}}
            >
              <Icon size={16} strokeWidth={2.2} />
              {label}
            </Link>
          ))}
          <Link href="/expenses?new=income" onClick={() => setOpen(false)} className="chip chip-on-dark mt-1 justify-center">
            <Wallet size={15} strokeWidth={2.6} />
            Add income
          </Link>
          <Link href="/expenses?new=1" onClick={() => setOpen(false)} className="btn btn-light mt-1">
            <Plus size={16} strokeWidth={3} />
            Add Expense
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">{account(false)}</div>
        </nav>
      )}
    </header>
  );
}
