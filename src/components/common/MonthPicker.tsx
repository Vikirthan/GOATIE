import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { monthKeyLabel } from '@/utils/expenses';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseMonthKey(value: string, fallback = new Date()): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(value || '');
  if (m) {
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) return { year: Number(m[1]), month };
  }
  return { year: fallback.getFullYear(), month: fallback.getMonth() + 1 };
}

export const MonthPicker: React.FC<{
  id?: string;
  value: string;
  onChange: (monthKey: string) => void;
  className?: string;
}> = ({ id = 'month-picker', value, onChange, className }) => {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => parseMonthKey(value).year);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setViewYear(parseMonthKey(value).year);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open ]);

  const current = parseMonthKey(value);

  const pick = (month: number) => {
    onChange(`${viewYear}-${String(month).padStart(2, '0')}`);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        id={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Pick month"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
      >
        <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium">{value ? monthKeyLabel(value) : 'Pick a month'}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Month calendar" className="absolute z-30 mt-1 w-64 rounded-xl border border-border bg-card p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous year"
              onClick={() => setViewYear((y) => y - 1)}
              className="rounded-lg p-1.5 hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-bold tabular-nums">{viewYear}</span>
            <button
              type="button"
              aria-label="Next year"
              onClick={() => setViewYear((y) => y + 1)}
              className="rounded-lg p-1.5 hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MONTH_SHORT.map((label, i) => {
              const month = i + 1;
              const selected = current.year === viewYear && current.month === month;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => pick(month)}
                  aria-pressed={selected}
                  className={cn(
                    'rounded-lg px-2 py-2 text-sm transition-colors',
                    selected
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : 'hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
