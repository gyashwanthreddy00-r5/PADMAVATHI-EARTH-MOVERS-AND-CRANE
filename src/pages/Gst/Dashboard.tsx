import { KpiCard } from '@/components/ui/common';
import { formatCurrency } from '@/lib/utils';
import type { GstMonthlySummary } from '@/lib/gstReporting';
import { IndianRupee, Receipt, TrendingUp, TrendingDown, ShoppingCart, FileText } from 'lucide-react';
import { useLang } from '@/context/LangContext';

interface Props {
  summary: GstMonthlySummary;
  salesCount: number;
  purchaseCount: number;
  monthLabel: string;
  fy: string;
}

export default function Dashboard({ summary, salesCount, purchaseCount, monthLabel, fy }: Props) {
  const { t } = useLang();
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">{t('gstSummaryNote').replace('{month}', monthLabel).replace('{fy}', fy)}</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label={t('totalSales')} value={formatCurrency(summary.totalSales)} icon={IndianRupee} color="blue" subtitle={`${salesCount} ${t('invoices')}`} />
        <KpiCard label={t('taxableSales')} value={formatCurrency(summary.taxableSales)} icon={Receipt} color="indigo" />
        <KpiCard label={t('totalPurchaseGst')} value={formatCurrency(summary.totalPurchase)} icon={ShoppingCart} color="slate" subtitle={`${purchaseCount} ${t('entriesLabel')}`} />
        <KpiCard label={t('netGstPayable')} value={formatCurrency(summary.netGstPayable)} icon={summary.netGstPayable >= 0 ? TrendingUp : TrendingDown} color={summary.netGstPayable >= 0 ? 'red' : 'emerald'} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard label={t('outputCgstLabel')} value={formatCurrency(summary.outputCgst)} icon={FileText} color="blue" />
        <KpiCard label={t('outputSgstLabel')} value={formatCurrency(summary.outputSgst)} icon={FileText} color="blue" />
        <KpiCard label={t('outputIgstLabel')} value={formatCurrency(summary.outputIgst)} icon={FileText} color="blue" />
        <KpiCard label={t('inputCgstLabel')} value={formatCurrency(summary.inputCgst)} icon={FileText} color="emerald" />
        <KpiCard label={t('inputSgstLabel')} value={formatCurrency(summary.inputSgst)} icon={FileText} color="emerald" />
        <KpiCard label={t('inputIgstLabel')} value={formatCurrency(summary.inputIgst)} icon={FileText} color="emerald" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 max-w-md ml-auto">
        <div className="flex justify-between py-1.5 text-sm"><span className="text-slate-500">{t('outputGst')}</span><span className="font-semibold text-slate-800">{formatCurrency(summary.totalOutputGst)}</span></div>
        <div className="flex justify-between py-1.5 text-sm border-b border-slate-100"><span className="text-slate-500">{t('lessEligibleItc')}</span><span className="font-semibold text-emerald-600">- {formatCurrency(summary.totalInputGst)}</span></div>
        <div className="flex justify-between py-2 text-base"><span className="font-bold text-slate-800">{t('netGstPayable')}</span><span className="font-bold text-blue-700">{formatCurrency(summary.netGstPayable)}</span></div>
      </div>
    </div>
  );
}
