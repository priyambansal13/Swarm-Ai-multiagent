'use client';

/** Small shared building blocks for the admin console and inbox. */

export const inputCls = 'w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent';
export const btnPrimary = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-[#1b1d1f] shadow-sm transition hover:brightness-105 disabled:opacity-60';
export const btnDark = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-ink px-3.5 py-2 text-sm font-semibold text-bg transition disabled:opacity-60';
export const btnGhost = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50';

export const Card = ({ title, desc, children, action }: { title?: string; desc?: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <section className="rounded-2xl border border-line bg-surface p-5">
    {(title || action) && (
      <div className="mb-1 flex items-start gap-3">
        {title && <h2 className="font-display text-lg font-semibold">{title}</h2>}
        <div className="ml-auto">{action}</div>
      </div>
    )}
    {desc && <p className="mb-4 text-sm text-muted">{desc}</p>}
    {title && !desc && <div className="mb-3" />}
    {children}
  </section>
);

export const Toggle = ({ id, label, hint, checked, onChange, disabled }: { id: string; label: React.ReactNode; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <label htmlFor={id} className={`flex cursor-pointer items-center justify-between gap-3 py-1.5 text-sm ${disabled ? 'opacity-50' : ''}`}>
    <span>{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
    <span className="relative inline-flex shrink-0">
      <input id={id} type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="h-6 w-11 rounded-full bg-surface-2 ring-1 ring-line transition peer-checked:bg-teal peer-focus-visible:ring-2 peer-focus-visible:ring-accent" />
      <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface shadow transition peer-checked:translate-x-5" />
    </span>
  </label>
);

export const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block text-sm font-medium">
    {label}
    <div className="mt-1">{children}</div>
    {hint && <span className="mt-1 block text-xs font-normal text-muted">{hint}</span>}
  </label>
);

const PILL: Record<string, string> = {
  ok: 'bg-ok-soft text-ok', warn: 'bg-accent-soft text-accent-strong', danger: 'bg-danger-soft text-danger', teal: 'bg-teal-soft text-teal', muted: 'bg-surface-2 text-muted',
};
export const Pill = ({ tone = 'muted', children }: { tone?: keyof typeof PILL; children: React.ReactNode }) => (
  <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${PILL[tone]}`}>{children}</span>
);

export const Notice = ({ tone, children, onClose }: { tone: 'ok' | 'danger'; children: React.ReactNode; onClose?: () => void }) => (
  <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm ${tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
    <span className="min-w-0 flex-1">{children}</span>
    {onClose && <button onClick={onClose} className="text-xs underline">dismiss</button>}
  </div>
);

export const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>
);

export const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
