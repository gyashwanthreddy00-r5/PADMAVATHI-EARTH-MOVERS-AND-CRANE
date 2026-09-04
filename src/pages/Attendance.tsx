import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Button, Field, inputClass, LoadingSpinner, StatusBadge, EmptyState } from '@/components/ui/common';
import { CheckCircle2, CheckSquare, Square, Users, CalendarCheck, FileSpreadsheet } from 'lucide-react';
import { formatDate, todayISO, exportToExcelWithCompany } from '@/lib/utils';
import { useSettings } from '@/context/SettingsContext';
import { DatePicker } from '@/components/ui/DatePicker';
import type { Employee, AttendanceRecord, AttendanceStatus, AttendanceWithEmployee } from '@/types';

const STATUS_COLORS: Record<AttendanceStatus, string> = {
  Present: 'bg-emerald-600 text-white hover:bg-emerald-700',
  Absent: 'bg-red-600 text-white hover:bg-red-700',
  Holiday: 'bg-blue-600 text-white hover:bg-blue-700',
};
const STATUS_INACTIVE: Record<AttendanceStatus, string> = {
  Present: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  Absent: 'bg-red-50 text-red-700 hover:bg-red-100',
  Holiday: 'bg-blue-50 text-blue-700 hover:bg-blue-100',
};
const BULK_BTN_STYLE: Record<AttendanceStatus, string> = {
  Present: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm',
  Absent: 'bg-red-600 hover:bg-red-700 text-white shadow-sm',
  Holiday: 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm',
};
export default function Attendance() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();
  const [records, setRecords] = useState<AttendanceWithEmployee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [bulkStatus, setBulkStatus] = useState<AttendanceStatus>('Present');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceStatus>>({});

  // Report filters
  const [reportDateFilter, setReportDateFilter] = useState('');
  const [reportEmployeeFilter, setReportEmployeeFilter] = useState('');
  const [reportRoleFilter, setReportRoleFilter] = useState('');
  const [reportStatusFilter, setReportStatusFilter] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [eRes, aRes] = await Promise.all([
      supabase.from('employees').select('*').eq('active', true).order('name'),
      supabase.from('attendance').select('*, employee:employees(id,name,role,salary,advance_salary,phone)').eq('attendance_date', date).eq('is_cancelled', false),
    ]);
    setEmployees((eRes.data ?? []) as Employee[]);
    setRecords((aRes.data ?? []) as AttendanceWithEmployee[]);

    const existing: Record<string, AttendanceStatus> = {};
    (aRes.data ?? []).forEach((r: AttendanceRecord & { employee_id: string }) => {
      existing[r.employee_id] = r.status;
    });
    setAttendanceMap(existing);
    setSelectedIds(new Set());
    setLoading(false);
  }, [date]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Summary cards
  const summary = useMemo(() => {
    const present = Object.values(attendanceMap).filter(s => s === 'Present').length;
    const absent = Object.values(attendanceMap).filter(s => s === 'Absent').length;
    const holiday = Object.values(attendanceMap).filter(s => s === 'Holiday').length;
    return { present, absent, holiday, total: employees.length };
  }, [attendanceMap, employees]);

  const toggleEmployee = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(employees.map(e => e.id)));
  const deselectAll = () => setSelectedIds(new Set());

  const markSelected = async () => {
    if (selectedIds.size === 0) { show('Please select at least one employee.', 'error'); return; }
    setSaving(true);
    let successCount = 0;
    try {
      for (const employeeId of selectedIds) {
        const { data: existing } = await supabase
          .from('attendance')
          .select('id')
          .eq('attendance_date', date)
          .eq('employee_id', employeeId)
          .eq('is_cancelled', false)
          .maybeSingle();

        if (existing) {
          const { error } = await supabase.from('attendance').update({ status: bulkStatus }).eq('id', existing.id);
          if (!error) successCount++;
        } else {
          const { error } = await supabase.from('attendance').insert({ attendance_date: date, employee_id: employeeId, status: bulkStatus });
          if (!error) successCount++;
        }
      }
      setAttendanceMap(prev => {
        const next = { ...prev };
        selectedIds.forEach(id => { next[id] = bulkStatus; });
        return next;
      });
      const empWord = successCount === 1 ? 'employee' : 'employees';
      show(`Attendance marked ${bulkStatus} for ${successCount} ${empWord}.`, 'success');
      setSelectedIds(new Set());
      fetchAll();
    } catch {
      show(t('saveError'), 'error');
    }
    setSaving(false);
  };

  // Individual override — updates single record
  const overrideStatus = async (employeeId: string, status: AttendanceStatus) => {
    setAttendanceMap(prev => ({ ...prev, [employeeId]: status }));
    const { data: existing } = await supabase
      .from('attendance')
      .select('id')
      .eq('attendance_date', date)
      .eq('employee_id', employeeId)
      .eq('is_cancelled', false)
      .maybeSingle();

    if (existing) {
      await supabase.from('attendance').update({ status }).eq('id', existing.id);
    } else {
      await supabase.from('attendance').insert({ attendance_date: date, employee_id: employeeId, status });
    }
  };

  // Filtered report records
  const filteredReport = useMemo(() => {
    let result = records;
    if (reportDateFilter) result = result.filter(r => r.attendance_date === reportDateFilter);
    if (reportEmployeeFilter) result = result.filter(r => r.employee?.name?.toLowerCase().includes(reportEmployeeFilter.toLowerCase()));
    if (reportRoleFilter) result = result.filter(r => r.employee?.role === reportRoleFilter);
    if (reportStatusFilter) result = result.filter(r => r.status === reportStatusFilter);
    return result;
  }, [records, reportDateFilter, reportEmployeeFilter, reportRoleFilter, reportStatusFilter]);

  const exportReport = () => {
    const headers = ['Employee', 'Role', 'Phone', 'Date', 'Status'];
    const rows = filteredReport.map(r => [
      r.employee?.name ?? '-', r.employee?.role ?? '-', r.employee?.phone ?? '-',
      formatDate(r.attendance_date), r.status,
    ]);
    exportToExcelWithCompany(
      'Attendance_Report.csv', 'Attendance Report',
      settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin } : { company_name: 'Crane ERP' },
      reportDateFilter ? formatDate(reportDateFilter) : formatDate(date), todayISO(),
      [reportRoleFilter, reportStatusFilter].filter(Boolean).join(', '),
      headers, rows,
    );
  };

  const reportColumns: Column<AttendanceWithEmployee>[] = [
    { key: 'employee', header: t('name'), render: r => r.employee?.name ?? '-' },
    { key: 'role', header: t('role'), render: r => r.employee?.role ?? '-' },
    { key: 'phone', header: t('phone'), render: r => r.employee?.phone ?? '-' },
    { key: 'attendance_date', header: t('date'), sortable: true, render: r => formatDate(r.attendance_date) },
    { key: 'status', header: t('status'), render: r => <StatusBadge status={r.status} /> },
  ];

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Present</span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600"><CheckCircle2 className="w-4 h-4" /></div>
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-600">{summary.present}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Absent</span>
            <div className="p-2 rounded-lg bg-red-50 text-red-600"><Users className="w-4 h-4" /></div>
          </div>
          <div className="mt-2 text-2xl font-bold text-red-600">{summary.absent}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Holiday</span>
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600"><CalendarCheck className="w-4 h-4" /></div>
          </div>
          <div className="mt-2 text-2xl font-bold text-blue-600">{summary.holiday}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total</span>
            <div className="p-2 rounded-lg bg-slate-100 text-slate-600"><Users className="w-4 h-4" /></div>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-800">{summary.total}</div>
        </div>
      </div>

      {/* Attendance Entry */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">{t('bulkAttendance')}</h3>
        <div className="flex flex-col sm:flex-row gap-4 items-end mb-4">
          <Field label={t('attendanceDate')}>
            <DatePicker value={date} onChange={v => setDate(v)} />
          </Field>
          <Field label="Attendance Status">
            <select className={inputClass()} value={bulkStatus} onChange={e => setBulkStatus(e.target.value as AttendanceStatus)}>
              <option value="Present">{t('present')}</option>
              <option value="Absent">{t('absent')}</option>
              <option value="Holiday">{t('holiday')}</option>
            </select>
          </Field>
          <div className="flex gap-2">
            <Button variant="outline" onClick={selectAll}><CheckSquare className="w-4 h-4" />{t('selectAll')}</Button>
            <Button variant="outline" onClick={deselectAll}><Square className="w-4 h-4" />Clear</Button>
          </div>
          <button
            onClick={markSelected}
            disabled={saving || selectedIds.size === 0}
            className={`inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2.5 text-base ${BULK_BTN_STYLE[bulkStatus]}`}
          >
            {saving ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />{t('saving')}</> : <><CheckCircle2 className="w-4 h-4" />Mark Selected as {bulkStatus}</>}
          </button>
        </div>

        {/* Employee list with checkboxes + individual override */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-left w-10"></th>
                  <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-left">Employee</th>
                  <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-left">Role</th>
                  <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-left hidden sm:table-cell">Phone</th>
                  <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-center">Status Override</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.length === 0 ? (
                  <tr><td colSpan={5}><EmptyState message="No active employees" icon={Users} /></td></tr>
                ) : (
                  employees.map(e => {
                    const currentStatus = attendanceMap[e.id] ?? null;
                    const isSelected = selectedIds.has(e.id);
                    return (
                      <tr key={e.id} className={`transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleEmployee(e.id)}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-3 py-2 text-sm font-medium text-slate-700">{e.name}</td>
                        <td className="px-3 py-2 text-sm text-slate-500">{e.role}</td>
                        <td className="px-3 py-2 text-sm text-slate-500 hidden sm:table-cell">{e.phone ?? '-'}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-center gap-1">
                            {(['Present', 'Absent', 'Holiday'] as AttendanceStatus[]).map(s => (
                              <button
                                key={s}
                                onClick={() => overrideStatus(e.id, s)}
                                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                                  currentStatus === s ? STATUS_COLORS[s] : STATUS_INACTIVE[s]
                                }`}
                              >
                                {t(s.toLowerCase() as 'present' | 'absent' | 'holiday')}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        {selectedIds.size > 0 && (
          <p className="text-xs text-slate-500 mt-2">
            {selectedIds.size} {selectedIds.size === 1 ? 'employee' : 'employees'} selected — will be marked as {bulkStatus}
          </p>
        )}
      </div>

      {/* Attendance Report */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">{t('attendanceReport')} — {formatDate(date)}</h3>
          <Button variant="outline" size="sm" onClick={exportReport}><FileSpreadsheet className="w-4 h-4" />Excel</Button>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
            <DatePicker
              value={reportDateFilter}
              onChange={v => setReportDateFilter(v)}
              placeholder="Filter by date"
            />
            <input
              type="text"
              className={inputClass()}
              value={reportEmployeeFilter}
              onChange={e => setReportEmployeeFilter(e.target.value)}
              placeholder="Filter by employee name"
            />
            <select className={inputClass()} value={reportRoleFilter} onChange={e => setReportRoleFilter(e.target.value)}>
              <option value="">All Roles</option>
              <option value="Driver">Driver</option>
              <option value="Operator">Operator</option>
              <option value="Helper">Helper</option>
              <option value="Other">Other</option>
            </select>
            <select className={inputClass()} value={reportStatusFilter} onChange={e => setReportStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="Present">Present</option>
              <option value="Absent">Absent</option>
              <option value="Holiday">Holiday</option>
            </select>
          </div>
          <DataTable columns={reportColumns} data={filteredReport} searchKeys={[]} pageSize={50} emptyMessage="No attendance records for selected filters" showSerialNumber />
        </div>
      </div>
    </div>
  );
}
