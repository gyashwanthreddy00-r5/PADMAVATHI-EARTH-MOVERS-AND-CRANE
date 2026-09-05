import { useState, useRef, useEffect } from 'react';
import { Bell, AlertTriangle, AlertCircle, Clock, CalendarClock, X } from 'lucide-react';
import { useNotifications, type AppNotification, type NotificationSeverity } from '@/hooks/useNotifications';
import { useLang } from '@/context/LangContext';
import { classNames } from '@/lib/utils';

interface Props {
  onNavigate: (path: string) => void;
}

const severityConfig: Record<NotificationSeverity, { icon: typeof AlertCircle; bg: string; text: string; border: string }> = {
  expired: { icon: AlertCircle, bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  overdue: { icon: AlertCircle, bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  'due-today': { icon: CalendarClock, bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  'due-soon': { icon: Clock, bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
};

export function NotificationBell({ onNavigate }: Props) {
  const { t } = useLang();
  const { notifications, counts } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleClick = (n: AppNotification) => {
    onNavigate(n.navigateTo);
    setOpen(false);
  };

  const badgeColor = counts.expired > 0 ? 'bg-red-500' : counts.dueToday > 0 ? 'bg-orange-500' : 'bg-amber-500';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
        title={t('importantNotifications')}
      >
        <Bell className="w-5 h-5" />
        {counts.total > 0 && (
          <span className={classNames(
            'absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white rounded-full px-1',
            badgeColor,
          )}>
            {counts.total > 99 ? '99+' : counts.total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden animate-fade-in">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-bold text-slate-800">{t('importantNotifications')}</h3>
            </div>
            <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-slate-200 text-slate-400">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-2 px-4 py-2 border-b border-slate-100 text-xs">
            {counts.expired > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">{counts.expired} {t('expired')}</span>
            )}
            {counts.dueToday > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-semibold">{counts.dueToday} {t('dueToday')}</span>
            )}
            {counts.dueSoon > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">{counts.dueSoon} {t('expiringSoon')}</span>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400 font-medium">{t('noNotifications')}</div>
            ) : (
              notifications.map(n => {
                const cfg = severityConfig[n.severity];
                const Icon = cfg.icon;
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={classNames(
                      'w-full flex items-start gap-3 px-4 py-3 border-b border-slate-50 text-left hover:bg-slate-50 transition-colors',
                    )}
                  >
                    <div className={classNames('flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center', cfg.bg, cfg.border, 'border')}>
                      <Icon className={classNames('w-4 h-4', cfg.text)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{n.title}</p>
                      <p className="text-xs text-slate-500">{n.subtitle}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
