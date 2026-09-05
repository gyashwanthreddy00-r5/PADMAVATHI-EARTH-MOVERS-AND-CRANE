import { useState, useRef, useEffect, useCallback } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { classNames, todayISO } from '@/lib/utils';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function toISO(d: Date): string {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().split('T')[0];
}

function fromISO(iso: string): Date {
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(y, m - 1, day);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDisplay(iso: string): string {
  if (!iso) return '';
  const d = fromISO(iso);
  if (isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export interface DatePickerProps {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  error?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'DD/MM/YYYY',
  className,
  disabled,
  min,
  max,
  error,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    if (value) return fromISO(value);
    return new Date();
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  useEffect(() => {
    if (!open || !containerRef.current || !panelRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + panelRect.width > viewportWidth - 8) {
      left = Math.max(8, viewportWidth - panelRect.width - 8);
    }
    if (top + panelRect.height > viewportHeight - 8) {
      top = rect.top - panelRect.height - 4;
      if (top < 8) top = 8;
    }
    setPanelPos({ top, left });
  }, [open]);

  const todayISOStr = todayISO();
  const minDate = min ? fromISO(min) : null;
  const maxDate = max ? fromISO(max) : null;

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));

  const prevMonth = () => setViewMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setViewMonth(new Date(year, month + 1, 1));
  const selectDate = (d: Date) => {
    onChange(toISO(d));
    close();
  };

  const isDisabled = (d: Date): boolean => {
    if (minDate && d < minDate) return true;
    if (maxDate && d > maxDate) return true;
    return false;
  };

  const inputClasses = classNames(
    'w-full px-3 py-2 text-sm font-normal border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors placeholder:text-slate-400 placeholder:font-normal',
    error ? 'border-red-300 bg-red-50/30' : 'border-slate-200 bg-white',
    disabled && 'opacity-50 cursor-not-allowed',
    className,
  );

  return (
    <div ref={containerRef} className="relative">
      <div
        className={classNames(inputClasses, 'flex items-center gap-2 cursor-pointer', !disabled && 'hover:border-slate-300')}
        onClick={() => !disabled && setOpen(o => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!disabled) setOpen(o => !o); }
        }}
      >
        <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
        <span className={classNames('flex-1', !value && 'text-slate-400')}>{value ? formatDisplay(value) : placeholder}</span>
        {value && !disabled && (
          <button
            type="button"
            className="p-0.5 text-slate-300 hover:text-red-500 transition-colors"
            onClick={e => { e.stopPropagation(); onChange(''); }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div
          ref={panelRef}
          className="fixed z-[80] bg-white rounded-xl shadow-xl border border-slate-200 p-4 w-[280px]"
          style={panelPos ? { top: panelPos.top, left: panelPos.left } : { visibility: 'hidden' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-bold text-slate-800">{MONTH_NAMES[month]} {year}</span>
            <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday headings */}
          <div className="grid grid-cols-7 gap-0 mb-1">
            {WEEKDAY_LABELS.map(wd => (
              <div key={wd} className="text-center text-[10px] font-bold text-slate-400 uppercase py-1">{wd}</div>
            ))}
          </div>

          {/* Date grid */}
          <div className="grid grid-cols-7 gap-0">
            {days.map((d, i) => {
              if (!d) return <div key={i} />;
              const iso = toISO(d);
              const isSelected = value === iso;
              const isToday = todayISOStr === iso;
              const disabled = isDisabled(d);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  onClick={() => selectDate(d)}
                  className={classNames(
                    'aspect-square flex items-center justify-center text-xs font-medium rounded-lg transition-all m-0.5',
                    disabled && 'text-slate-200 cursor-not-allowed',
                    !disabled && !isSelected && !isToday && 'text-slate-700 hover:bg-blue-50 hover:text-blue-700',
                    !disabled && !isSelected && isToday && 'text-blue-600 hover:bg-blue-50 ring-1 ring-blue-200',
                    isSelected && 'bg-blue-600 text-white hover:bg-blue-700 font-bold shadow-sm',
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => { onChange(todayISOStr); close(); }}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors"
            >
              Today
            </button>
            <button
              type="button"
              onClick={close}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- DateTimePicker ---------- */

function parseDateTimeLocal(iso: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const [datePart, timePart] = iso.split('T');
  return { date: datePart ?? '', time: (timePart ?? '').slice(0, 5) };
}

function to12Hour(time24: string): { hour: number; minute: number; period: 'AM' | 'PM' } {
  if (!time24) {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    return { hour: h === 0 ? 12 : h > 12 ? h - 12 : h, minute: m, period: h >= 12 ? 'PM' : 'AM' };
  }
  const [hStr, mStr] = time24.split(':');
  const h = Number(hStr) || 0;
  const m = Number(mStr) || 0;
  return {
    hour: h === 0 ? 12 : h > 12 ? h - 12 : h,
    minute: m,
    period: h >= 12 ? 'PM' : 'AM',
  };
}

function to24Hour(hour: number, minute: number, period: 'AM' | 'PM'): string {
  let h = hour;
  if (period === 'AM' && h === 12) h = 0;
  if (period === 'PM' && h !== 12) h += 12;
  return `${pad2(h)}:${pad2(minute)}`;
}

function formatTimeDisplay(time24: string): string {
  if (!time24) return '';
  const { hour, minute, period } = to12Hour(time24);
  return `${pad2(hour)}:${pad2(minute)} ${period}`;
}

function formatDateTimeDisplay(iso: string): string {
  if (!iso) return '';
  const { date, time } = parseDateTimeLocal(iso);
  const dateDisplay = formatDisplay(date);
  const timeDisplay = formatTimeDisplay(time);
  return [dateDisplay, timeDisplay].filter(Boolean).join('  ');
}

export interface DateTimePickerProps {
  value: string;
  onChange: (isoDateTime: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  error?: string;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'DD/MM/YYYY  hh:mm AM/PM',
  className,
  disabled,
  error,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const { date } = parseDateTimeLocal(value);
    return date ? fromISO(date) : new Date();
  });
  const [selectedDate, setSelectedDate] = useState(() => parseDateTimeLocal(value).date);
  const [hour, setHour] = useState(() => to12Hour(parseDateTimeLocal(value).time).hour);
  const [minute, setMinute] = useState(() => to12Hour(parseDateTimeLocal(value).time).minute);
  const [period, setPeriod] = useState<'AM' | 'PM'>(() => to12Hour(parseDateTimeLocal(value).time).period);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  // Sync internal state when value changes externally
  useEffect(() => {
    const { date, time } = parseDateTimeLocal(value);
    setSelectedDate(date);
    if (time) {
      const t = to12Hour(time);
      setHour(t.hour);
      setMinute(t.minute);
      setPeriod(t.period);
    }
    if (date) setViewMonth(fromISO(date));
  }, [value]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  useEffect(() => {
    if (!open || !containerRef.current || !panelRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + panelRect.width > viewportWidth - 8) {
      left = Math.max(8, viewportWidth - panelRect.width - 8);
    }
    if (top + panelRect.height > viewportHeight - 8) {
      top = rect.top - panelRect.height - 4;
      if (top < 8) top = 8;
    }
    setPanelPos({ top, left });
  }, [open]);

  const todayISOStr = todayISO();
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));

  const prevMonth = () => setViewMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setViewMonth(new Date(year, month + 1, 1));

  const selectDate = (d: Date) => {
    const iso = toISO(d);
    setSelectedDate(iso);
    if (!value) {
      const now = new Date();
      const t = to12Hour(`${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
      setHour(t.hour);
      setMinute(t.minute);
      setPeriod(t.period);
    }
  };

  const applyAndClose = () => {
    if (!selectedDate) { onChange(''); close(); return; }
    const time24 = to24Hour(hour, minute, period);
    onChange(`${selectedDate}T${time24}`);
    close();
  };

  const clear = () => {
    onChange('');
    close();
  };

  const inputClasses = classNames(
    'w-full px-3 py-2 text-sm font-normal border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors placeholder:text-slate-400 placeholder:font-normal',
    error ? 'border-red-300 bg-red-50/30' : 'border-slate-200 bg-white',
    disabled && 'opacity-50 cursor-not-allowed',
    className,
  );

  return (
    <div ref={containerRef} className="relative">
      <div
        className={classNames(inputClasses, 'flex items-center gap-2 cursor-pointer', !disabled && 'hover:border-slate-300')}
        onClick={() => !disabled && setOpen(o => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!disabled) setOpen(o => !o); }
        }}
      >
        <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
        <span className={classNames('flex-1 truncate', !value && 'text-slate-400')}>{value ? formatDateTimeDisplay(value) : placeholder}</span>
        {value && !disabled && (
          <button
            type="button"
            className="p-0.5 text-slate-300 hover:text-red-500 transition-colors"
            onClick={e => { e.stopPropagation(); clear(); }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div
          ref={panelRef}
          className="fixed z-[80] bg-white rounded-xl shadow-xl border border-slate-200 p-4 w-[320px]"
          style={panelPos ? { top: panelPos.top, left: panelPos.left } : { visibility: 'hidden' }}
        >
          {/* Calendar header */}
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-bold text-slate-800">{MONTH_NAMES[month]} {year}</span>
            <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday headings */}
          <div className="grid grid-cols-7 gap-0 mb-1">
            {WEEKDAY_LABELS.map(wd => (
              <div key={wd} className="text-center text-[10px] font-bold text-slate-400 uppercase py-1">{wd}</div>
            ))}
          </div>

          {/* Date grid */}
          <div className="grid grid-cols-7 gap-0">
            {days.map((d, i) => {
              if (!d) return <div key={i} />;
              const iso = toISO(d);
              const isSelected = selectedDate === iso;
              const isToday = todayISOStr === iso;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectDate(d)}
                  className={classNames(
                    'aspect-square flex items-center justify-center text-xs font-medium rounded-lg transition-all m-0.5',
                    !isSelected && !isToday && 'text-slate-700 hover:bg-blue-50 hover:text-blue-700',
                    !isSelected && isToday && 'text-blue-600 hover:bg-blue-50 ring-1 ring-blue-200',
                    isSelected && 'bg-blue-600 text-white hover:bg-blue-700 font-bold shadow-sm',
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* Time picker section */}
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Time</div>
            <div className="flex items-center gap-2">
              {/* Hour */}
              <div className="flex-1">
                <label className="block text-[10px] font-semibold text-slate-400 mb-1 text-center">Hour</label>
                <div className="max-h-[120px] overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-50">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHour(h)}
                      className={classNames(
                        'w-full py-1 text-xs font-medium text-center transition-colors',
                        hour === h ? 'bg-blue-600 text-white font-bold' : 'text-slate-600 hover:bg-blue-50',
                      )}
                    >
                      {pad2(h)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Minute */}
              <div className="flex-1">
                <label className="block text-[10px] font-semibold text-slate-400 mb-1 text-center">Minute</label>
                <div className="max-h-[120px] overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-50">
                  {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMinute(m)}
                      className={classNames(
                        'w-full py-1 text-xs font-medium text-center transition-colors',
                        minute === m ? 'bg-blue-600 text-white font-bold' : 'text-slate-600 hover:bg-blue-50',
                      )}
                    >
                      {pad2(m)}
                    </button>
                  ))}
                </div>
              </div>

              {/* AM/PM */}
              <div className="flex-1">
                <label className="block text-[10px] font-semibold text-slate-400 mb-1 text-center">AM/PM</label>
                <div className="rounded-lg border border-slate-200 divide-y divide-slate-50">
                  <button
                    type="button"
                    onClick={() => setPeriod('AM')}
                    className={classNames(
                      'w-full py-2 text-xs font-bold text-center transition-colors',
                      period === 'AM' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-blue-50',
                    )}
                  >
                    AM
                  </button>
                  <button
                    type="button"
                    onClick={() => setPeriod('PM')}
                    className={classNames(
                      'w-full py-2 text-xs font-bold text-center transition-colors',
                      period === 'PM' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-blue-50',
                    )}
                  >
                    PM
                  </button>
                </div>
              </div>
            </div>

            {/* Preview */}
            <div className="mt-2 text-center text-xs font-semibold text-slate-500">
              {selectedDate ? `${formatDisplay(selectedDate)}  ${pad2(hour)}:${pad2(minute)} ${period}` : 'Select a date'}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
            <button type="button" onClick={clear} className="text-xs font-semibold text-slate-400 hover:text-red-500 transition-colors">
              Clear
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={close} className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors">
                Cancel
              </button>
              <button type="button" onClick={applyAndClose} className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
