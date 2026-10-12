'use client';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

// ------------------------------------------------------------------ Button

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary/90 shadow-sm',
  secondary: 'border border-line-strong bg-surface text-fg hover:bg-sunken',
  ghost: 'text-muted hover:bg-sunken hover:text-fg',
  danger: 'border border-danger/30 bg-surface text-danger hover:bg-danger-soft',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-[13px]',
  md: 'h-10 gap-2 px-4 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant], SIZES[size], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/** Square icon-only button. `label` is required: it becomes the accessible name and tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'children'> & { label: string; children: ReactNode }>(function IconButton(
  { label, className, variant = 'ghost', size = 'md', children, ...rest }, ref,
) {
  return (
    <Button ref={ref} aria-label={label} title={label} variant={variant} size={size}
      className={cx(size === 'sm' ? 'w-8 px-0' : 'w-10 px-0', className)} {...rest}>
      {children}
    </Button>
  );
});

// ------------------------------------------------------------------ Badge

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'ai';
const TONES: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted border-line',
  primary: 'bg-primary-soft text-primary border-primary/20',
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/20',
  ai: 'bg-ai-soft text-ai border-ai/20',
};

export function Badge({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium', TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ Alert

const ALERT_ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle };
const ALERT_TONES = {
  info: 'border-primary/20 bg-primary-soft text-fg [&_svg]:text-primary',
  success: 'border-success/20 bg-success-soft text-fg [&_svg]:text-success',
  warning: 'border-warning/25 bg-warning-soft text-fg [&_svg]:text-warning',
  danger: 'border-danger/25 bg-danger-soft text-fg [&_svg]:text-danger',
};

export function Alert({ tone = 'info', title, children, action, className }: {
  tone?: keyof typeof ALERT_TONES; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string;
}) {
  const Icon = ALERT_ICONS[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-md border px-3.5 py-3 text-sm', ALERT_TONES[tone], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cx('text-muted', Boolean(title) && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Empty state

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-sunken text-muted [&_svg]:h-5 [&_svg]:w-5">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return <Loader2 className={cx('h-4 w-4 animate-spin text-muted', className)} aria-label={label} role="status" />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-sunken px-1.5 py-px text-2xs text-muted">{children}</kbd>;
}

// ------------------------------------------------------------------ Tabs

export interface TabItem { id: string; label: ReactNode; content: ReactNode }

/** WAI-ARIA tabs: arrow keys move between tabs, only the active panel is rendered. */
export function Tabs({ items, label, className, defaultTab }: { items: TabItem[]; label: string; className?: string; defaultTab?: string }) {
  const [active, setActive] = useState(defaultTab ?? items[0]?.id);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = items.find((t) => t.id === active) ?? items[0];
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const idx = (next + items.length) % items.length;
    setActive(items[idx].id);
    refs.current[idx]?.focus();
  };
  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line scroll-thin">
        {items.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={t.id === current?.id}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={t.id === current?.id ? 0 : -1}
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              '-mb-px inline-flex h-9 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[13px] font-medium transition-colors',
              t.id === current?.id ? 'border-primary text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {current && (
        <div role="tabpanel" id={`${base}-panel-${current.id}`} aria-labelledby={`${base}-tab-${current.id}`} className="pt-4">
          {current.content}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Dialog

/**
 * Native <dialog>: modal focus trapping, Escape to close and inert background
 * come from the browser. `side` renders it as a right-hand sheet on wide screens.
 */
export function Dialog({ open, onClose, title, description, children, footer, side = false, wide = false }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; side?: boolean; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cx(
        'm-0 max-h-[100dvh] w-full max-w-full bg-transparent p-0 text-fg backdrop:bg-transparent',
        side ? 'ml-auto h-[100dvh] sm:max-w-xl' : 'm-auto h-auto px-4 sm:px-0', !side && (wide ? 'sm:max-w-2xl' : 'sm:max-w-md'),
      )}
    >
      {open && (
        <div className={cx('flex flex-col bg-surface shadow-pop', side ? 'h-full animate-slide-in border-l border-line' : 'max-h-[85dvh] rounded-lg border border-line')}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-base font-semibold">{title}</h2>
              {description && <div className="mt-0.5 text-sm text-muted">{description}</div>}
            </div>
            <IconButton label="Close" size="sm" onClick={onClose}><X className="h-4 w-4" aria-hidden /></IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scroll-thin">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation for destructive actions. */
export function ConfirmDialog({ open, onClose, onConfirm, title, children, confirmLabel, busy }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; children: ReactNode; confirmLabel: string; busy?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" onClick={onConfirm} loading={busy}>{confirmLabel}</Button></>}>
      <div className="text-sm text-muted">{children}</div>
    </Dialog>
  );
}
