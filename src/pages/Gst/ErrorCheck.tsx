import { Button, EmptyState, StatusBadge } from '@/components/ui/common';
import { CheckCircle2, FileSpreadsheet, ShieldAlert } from 'lucide-react';
import type { ExportCompanyInfo } from '@/lib/utils';
import type { GstIssue } from '@/lib/gstReporting';
import { exportGstErrorsExcel } from '@/lib/gstExports';

interface Props {
  issues: GstIssue[];
  monthLabel: string;
  company: ExportCompanyInfo;
}

const SEVERITY_VARIANT: Record<GstIssue['severity'], 'red' | 'amber' | 'green'> = { RED: 'red', ORANGE: 'amber', GREEN: 'green' };

export default function ErrorCheck({ issues, monthLabel, company }: Props) {
  const redCount = issues.filter(i => i.severity === 'RED').length;
  const orangeCount = issues.filter(i => i.severity === 'ORANGE').length;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {issues.length === 0 ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <span className="text-sm font-semibold text-emerald-700">No issues found for {monthLabel} - GREEN</span>
            </>
          ) : (
            <>
              <ShieldAlert className="w-5 h-5 text-amber-500" />
              <span className="text-sm font-semibold text-slate-700">{redCount} error{redCount === 1 ? '' : 's'}, {orangeCount} item{orangeCount === 1 ? '' : 's'} to review for {monthLabel}</span>
            </>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => exportGstErrorsExcel(issues, monthLabel, company)} disabled={issues.length === 0}><FileSpreadsheet className="w-4 h-4" />Export Excel</Button>
      </div>
      <p className="text-xs text-slate-400">Read-only check - this never modifies GST Billing or Purchase records, it only flags rows for your review.</p>

      {issues.length === 0 ? (
        <EmptyState message="No issues found for this month." icon={CheckCircle2} />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/90">
                {['Severity', 'Source', 'Reference', 'Issue'].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {issues.map((issue, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5"><StatusBadge status={issue.severity} variant={SEVERITY_VARIANT[issue.severity]} /></td>
                  <td className="px-3 py-2.5 text-sm text-slate-600 whitespace-nowrap">{issue.source}</td>
                  <td className="px-3 py-2.5 text-sm font-medium text-slate-700 whitespace-nowrap">{issue.reference}</td>
                  <td className="px-3 py-2.5 text-sm text-slate-600">{issue.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
