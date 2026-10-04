'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import {usePathname, useRouter} from 'next/navigation';
import {ArrowRight, FileUp, LogOut, Moon, Plus, Search, Wallet, type LucideIcon} from 'lucide-react';
import {links} from '@/components/navbar';

type Command = {
  id: string;
  label: string;
  hint: string;
  Icon: LucideIcon;
  run: () => void;
};

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastPath, setLastPath] = useState(pathname);

  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
    setQuery('');
    setActive(0);
  }

  const [lastOpen, setLastOpen] = useState(false);
  if (lastOpen !== open) {
    setLastOpen(open);
    if (open) {
      setQuery('');
      setActive(0);
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      setOpen(false);
      router.push(href);
    };
    const pageCommands: Command[] = links.map(({href, label, Icon}) => ({
      id: `go-${href}`,
      label,
      hint: href,
      Icon,
      run: go(href),
    }));
    const toggleTheme: Command = {
      id: 'theme',
      label: 'Toggle dark mode',
      hint: 'appearance',
      Icon: Moon,
      run: () => {
        const next = !document.documentElement.classList.contains('dark');
        document.documentElement.classList.toggle('dark', next);
        document.documentElement.style.colorScheme = next ? 'dark' : 'light';
        try {
          localStorage.setItem('theme', next ? 'dark' : 'light');
        } catch {
          /* storage blocked */
        }
        setOpen(false);
      },
    };
    const logout: Command = {
      id: 'logout',
      label: 'Log out',
      hint: 'session',
      Icon: LogOut,
      run: () => {
        setOpen(false);
        fetch('/api/auth/logout', {method: 'POST'})
          .catch(() => null)
          .finally(() => {
            router.replace('/login');
            router.refresh();
          });
      },
    };
    return [
      ...pageCommands,
      {id: 'new-expense', label: 'Add expense', hint: '/expenses?new=1', Icon: Plus, run: go('/expenses?new=1')},
      {id: 'new-income', label: 'Add income', hint: '/expenses?new=income', Icon: Wallet, run: go('/expenses?new=income')},
      {id: 'import-statement', label: 'Import a statement', hint: '/import', Icon: FileUp, run: go('/import')},
      toggleTheme,
      logout,
    ];
  }, [router]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (command) => command.label.toLowerCase().includes(needle) || command.hint.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  const safeActive = active < results.length ? active : 0;

  function select(command: Command) {
    command.run();
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="chip chip-on-dark hidden items-center gap-1.5 md:inline-flex"
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
        title="Search & commands (Ctrl K)"
        data-testid="palette-open"
      >
        <Search size={15} strokeWidth={2.4} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-950/50 px-4 pt-[12vh] backdrop-blur-sm"
          data-testid="palette"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 border-b border-slate-100 px-4">
              <Search size={16} className="shrink-0 text-slate-400" />
              <input
                ref={inputRef}
                className="w-full bg-transparent py-3.5 text-sm font-semibold text-slate-800 outline-none placeholder:font-medium placeholder:text-slate-400"
                placeholder="Jump to a page or run a command..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive(Math.min(safeActive + 1, results.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive(Math.max(safeActive - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const command = results[safeActive];
                    if (command) select(command);
                  }
                }}
                data-testid="palette-input"
              />
              <span className="hidden shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-400 sm:block">
                esc
              </span>
            </div>

            <div className="max-h-[50vh] overflow-y-auto p-2">
              {results.map((command, index) => (
                <button
                  key={command.id}
                  type="button"
                  data-active={index === safeActive}
                  data-testid="palette-item"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => select(command)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition data-[active=true]:bg-emerald-50"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
                    <command.Icon size={15} strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-bold text-slate-800">{command.label}</span>
                    <span className="block truncate text-[11px] text-slate-400">{command.hint}</span>
                  </span>
                  <ArrowRight size={14} className="shrink-0 text-slate-300" />
                </button>
              ))}
              {results.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-slate-400" data-testid="palette-empty">
                  No commands match “{query}”
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
