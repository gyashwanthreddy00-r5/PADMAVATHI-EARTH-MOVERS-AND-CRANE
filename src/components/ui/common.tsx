import { type ReactNode, useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { classNames } from '@/lib/utils';

export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  if (!open) return null;
  const sizeClass = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', '2xl': 'max-w-6xl' }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-xl shadow-2xl w-full ${sizeClass} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/50">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Confirm',
  message = 'Are you sure?',
  confirmText = 'Confirm',
  danger = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
  confirmText?: string;
  danger?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-start gap-4">
          <div className={classNames('p-2 rounded-lg', danger ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600')}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-slate-800">{title}</h3>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancel
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            className={classNames(
              'px-4 py-2 text-sm font-medium text-white rounded-lg',
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700',
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export function StatusBadge({ status, variant }: { status: string; variant?: 'green' | 'red' | 'blue' | 'amber' | 'gray' }) {
  const colors: Record<string, string> = {
    green: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    red: 'bg-red-100 text-red-700 border-red-200',
    blue: 'bg-blue-100 text-blue-700 border-blue-200',
    amber: 'bg-amber-100 text-amber-700 border-amber-200',
    gray: 'bg-slate-100 text-slate-600 border-slate-200',
  Available: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    Working: 'bg-blue-100 text-blue-700 border-blue-200',
    Maintenance: 'bg-amber-100 text-amber-700 border-amber-200',
    Inactive: 'bg-slate-100 text-slate-500 border-slate-200',
    Paid: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    Pending: 'bg-red-100 text-red-700 border-red-200',
    'Partially Paid': 'bg-amber-100 text-amber-700 border-amber-200',
    Present: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    Absent: 'bg-red-100 text-red-700 border-red-200',
    Holiday: 'bg-amber-100 text-amber-700 border-amber-200',
    Upcoming: 'bg-blue-100 text-blue-700 border-blue-200',
    Due: 'bg-amber-100 text-amber-700 border-amber-200',
    Overdue: 'bg-red-100 text-red-700 border-red-200',
    Active: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    Completed: 'bg-slate-100 text-slate-600 border-slate-200',
    Expired: 'bg-red-100 text-red-700 border-red-200',
    Cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
    Generated: 'bg-blue-100 text-blue-700 border-blue-200',
    Draft: 'bg-slate-100 text-slate-500 border-slate-200',
    Invoiced: 'bg-blue-100 text-blue-700 border-blue-200',
  };
  const cls = colors[variant ?? status] ?? colors.gray;
  return (
    <span className={classNames('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border', cls)}>
      {status}
    </span>
  );
}

export function KpiCard({ label, value, icon: Icon, color = 'blue', subtitle, onClick }: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color?: 'blue' | 'emerald' | 'amber' | 'red' | 'slate' | 'indigo';
  subtitle?: string;
  onClick?: () => void;
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    slate: 'bg-slate-100 text-slate-600',
    indigo: 'bg-indigo-50 text-indigo-600',
  };
  const borderColors = {
    blue: 'hover:border-blue-300',
    emerald: 'hover:border-emerald-300',
    amber: 'hover:border-amber-300',
    red: 'hover:border-red-300',
    slate: 'hover:border-slate-300',
    indigo: 'hover:border-indigo-300',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={classNames(
        'bg-white rounded-xl border border-slate-200 p-4 shadow-sm transition-all text-left w-full',
        onClick ? `${borderColors[color]} hover:shadow-md cursor-pointer` : 'cursor-default',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={classNames('p-2 rounded-lg', colors[color])}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="mt-2 text-xl font-bold text-slate-800 tabular-nums tracking-tight">{value}</div>
      {subtitle && <div className="text-xs font-medium text-slate-400 mt-0.5">{subtitle}</div>}
    </button>
  );
}

export function EmptyState({ message, icon: Icon }: { message: string; icon?: React.ElementType }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      {Icon && <Icon className="w-12 h-12 mb-3 text-slate-300" />}
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}

export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sz = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' }[size];
  return (
    <div className="flex items-center justify-center py-12">
      <div className={classNames('border-3 border-slate-200 border-t-blue-600 rounded-full animate-spin', sz)} style={{ borderWidth: '3px' }} />
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-red-500">
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}

export function Field({ label, required, error, children, hint }: { label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
        {label} {required && <span className="text-red-500 font-bold">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1 leading-relaxed">{hint}</p>}
      {error && <p className="text-xs font-medium text-red-500 mt-1">{error}</p>}
    </div>
  );
}

export function inputClass(error?: string): string {
  return classNames(
    'w-full px-3 py-2 text-sm font-normal border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors placeholder:text-slate-400 placeholder:font-normal',
    error ? 'border-red-300 bg-red-50/30' : 'border-slate-200 bg-white',
  );
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'md',
  disabled,
  className,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const variants = {
    primary: 'bg-blue-700 hover:bg-blue-800 text-white shadow-sm',
    secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-700',
    danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm',
    ghost: 'hover:bg-slate-100 text-slate-600',
    outline: 'border border-slate-200 hover:bg-slate-50 text-slate-700',
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs font-semibold', md: 'px-4 py-2 text-sm font-semibold', lg: 'px-5 py-2.5 text-base font-semibold' };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={classNames(
        'inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant], sizes[size], className,
      )}
    >
      {children}
    </button>
  );
}
