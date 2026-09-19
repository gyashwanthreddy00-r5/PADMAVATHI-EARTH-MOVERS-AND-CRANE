import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useSettings } from '@/context/SettingsContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { useLang } from '@/context/LangContext';
import { Button, LoadingSpinner, inputClass, StatusBadge } from '@/components/ui/common';
import { Landmark, Download, Lock, LockOpen } from 'lucide-react';
import { classNames } from '@/lib/utils';
import {
  currentFinancialYear, recentFinancialYears, monthsInFinancialYear, monthLabel,
  fetchGstInvoicesForMonth, fetchPurchasesForMonth, fetchItcOverridesForPurchases,
  toSalesGstRows, toPurchaseGstRows, computeGstSummary, runGstErrorChecks,
  type SalesGstRow, type PurchaseGstRow,
} from '@/lib/gstReporting';
import { downloadGstAgentPack, type GstManualAdjustments } from '@/lib/gstExports';
import Dashboard from './Dashboard';
import SalesGst from './SalesGst';
import PurchaseGst from './PurchaseGst';
import MonthlySummary from './MonthlySummary';
import Gstr1 from './Gstr1';
import Gstr3b from './Gstr3b';
import ErrorCheck from './ErrorCheck';
import type { TranslationKey } from '@/lib/i18n';

// Page shell for the GST module - a READ-ONLY reporting layer over the
// existing `invoices` (invoice_type = 'GST') and `purchases` tables. This
// file only fetches, filters by the selected month, and hands rows down to
// each tab; it never writes to invoices/purchases/vendors/customers.

type TabKey = 'dashboard' | 'sales' | 'purchase' | 'summary' | 'gstr1' | 'gstr3b' | 'errors';

const TABS: { key: TabKey; labelKey: TranslationKey }[] = [
  { key: 'dashboard', labelKey: 'gstDashboard' },
  { key: 'sales', labelKey: 'salesGst' },
  { key: 'purchase', labelKey: 'purchaseGst' },
  { key: 'summary', labelKey: 'monthlySummary' },
  { key: 'gstr1', labelKey: 'gstr1' },
  { key: 'gstr3b', labelKey: 'gstr3b' },
  { key: 'errors', labelKey: 'errorCheck' },
];

const EMPTY_ADJUSTMENTS: GstManualAdjustments = { reverse_charge_amount: 0, exempt_nil_nongst_amount: 0, interest_amount: 0, late_fee_amount: 0 };

type ReviewState = 'Not Reviewed' | 'Under Review' | 'Reviewed';

export default function Gst() {
  const { settings } = useSettings();
  const { user } = useAuth();
  const { show } = useToast();
  const { t } = useLang();

  const [fy, setFy] = useState(currentFinancialYear());
  const months = useMemo(() => monthsInFinancialYear(fy), [fy]);
  const [selected, setSelected] = useState(() => {
    const now = new Date();
    return { month: now.getMonth() + 1, year: now.getFullYear() };
  });
  const [tab, setTab] = useState<TabKey>('dashboard');

  const [loading, setLoading] = useState(true);
  const [salesRows, setSalesRows] = useState<SalesGstRow[]>([]);
  const [purchaseRows, setPurchaseRows] = useState<PurchaseGstRow[]>([]);
  const [reviewState, setReviewState] = useState<ReviewState>('Not Reviewed');
  const [adjustments, setAdjustments] = useState<GstManualAdjustments>(EMPTY_ADJUSTMENTS);
  const [savingAdjustments, setSavingAdjustments] = useState(false);
  const [packBusy, setPackBusy] = useState(false);

  const selectedLabel = monthLabel(selected.month, selected.year);

  // If the FY changes such that the currently-selected month isn't part of it
  // (e.g. picking a past FY), snap to that FY's most recent month instead of
  // showing a month that doesn't belong to it.
  useEffect(() => {
    if (!months.some(m => m.month === selected.month && m.year === selected.year)) {
      setSelected({ month: months[months.length - 1].month, year: months[months.length - 1].year });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fy]);

  const loadMonth = useCallback(async () => {
    setLoading(true);
    try {
      const [invoices, purchases, reviewRes, adjRes] = await Promise.all([
        fetchGstInvoicesForMonth(selected.month, selected.year),
        fetchPurchasesForMonth(selected.month, selected.year),
        supabase.from('gst_monthly_reviews').select('*').eq('financial_year', fy).eq('month', selected.month).maybeSingle(),
        supabase.from('gst_manual_adjustments').select('*').eq('financial_year', fy).eq('month', selected.month).maybeSingle(),
      ]);
      const itcOverrides = await fetchItcOverridesForPurchases(purchases.map(p => p.id));
      setSalesRows(toSalesGstRows(invoices));
      setPurchaseRows(toPurchaseGstRows(purchases, settings?.state_code ?? null, itcOverrides));
      setReviewState((reviewRes.data?.status as ReviewState | undefined) ?? 'Not Reviewed');
      setAdjustments(adjRes.data
        ? {
            reverse_charge_amount: Number(adjRes.data.reverse_charge_amount) || 0,
            exempt_nil_nongst_amount: Number(adjRes.data.exempt_nil_nongst_amount) || 0,
            interest_amount: Number(adjRes.data.interest_amount) || 0,
            late_fee_amount: Number(adjRes.data.late_fee_amount) || 0,
          }
        : EMPTY_ADJUSTMENTS);
    } catch (err) {
      show(`${t('unableToLoadGstData')}: ${err instanceof Error ? err.message : t('unknownError')}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [fy, selected.month, selected.year, settings?.state_code, show, t]);

  useEffect(() => { loadMonth(); }, [loadMonth]);

  const summary = useMemo(() => computeGstSummary(salesRows, purchaseRows), [salesRows, purchaseRows]);
  const issues = useMemo(() => runGstErrorChecks(salesRows, purchaseRows), [salesRows, purchaseRows]);

  const companyInfo = useMemo(() => settings
    ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin, pan: settings.pan }
    : { company_name: 'ERP' }, [settings]);

  async function saveReviewState(next: ReviewState) {
    const { error } = await supabase.from('gst_monthly_reviews').upsert({
      financial_year: fy,
      month: selected.month,
      status: next,
      reviewed_by: next === 'Reviewed' ? (user?.id ?? null) : undefined,
      reviewed_at: next === 'Reviewed' ? new Date().toISOString() : undefined,
      reopened_at: next === 'Not Reviewed' ? new Date().toISOString() : undefined,
    }, { onConflict: 'financial_year,month' });
    if (error) { show(`${t('unableToUpdateMonthStatus')}: ${error.message}`, 'error'); return; }
    setReviewState(next);
    show(`${t('monthMarkedAs')} ${next}. ${t('underlyingRecordsUnaffected')}`, 'success');
  }

  async function saveAdjustments(next: GstManualAdjustments) {
    setSavingAdjustments(true);
    const { error } = await supabase.from('gst_manual_adjustments').upsert({
      financial_year: fy, month: selected.month, ...next, updated_by: user?.id ?? null,
    }, { onConflict: 'financial_year,month' });
    setSavingAdjustments(false);
    if (error) { show(`${t('unableToSaveManualValues')}: ${error.message}`, 'error'); return; }
    setAdjustments(next);
    show(t('manuallyEnteredValuesSaved'), 'success');
  }

  async function handleDownloadPack() {
    setPackBusy(true);
    try {
      await downloadGstAgentPack(salesRows, purchaseRows, summary, issues, adjustments, selectedLabel, companyInfo);
    } catch (err) {
      show(`${t('unableToBuildGstAgentPack')}: ${err instanceof Error ? err.message : t('unknownError')}`, 'error');
    } finally {
      setPackBusy(false);
    }
  }

  const reviewVariant: Record<ReviewState, 'gray' | 'amber' | 'green'> = {
    'Not Reviewed': 'gray', 'Under Review': 'amber', 'Reviewed': 'green',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Landmark className="w-5 h-5 text-blue-600" />{t('gst')}</h2>
          <p className="text-sm text-slate-500">{t('gstReadOnlyDescription')}</p>
        </div>
        <Button onClick={handleDownloadPack} disabled={packBusy || loading}>
          <Download className="w-4 h-4" />{packBusy ? t('buildingPack') : t('downloadGstAgentPack')}
        </Button>
      </div>

      {/* Top bar: Financial Year / Month / GSTIN / Company Name */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        <label className="block">
          <span className="block text-xs font-semibold text-slate-500 mb-1">{t('financialYear')}</span>
          <select className={inputClass()} value={fy} onChange={e => setFy(e.target.value)}>
            {recentFinancialYears().map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-500 mb-1">{t('month')}</span>
          <select
            className={inputClass()}
            value={`${selected.month}-${selected.year}`}
            onChange={e => {
              const [m, y] = e.target.value.split('-').map(Number);
              setSelected({ month: m, year: y });
            }}
          >
            {months.map(m => <option key={`${m.month}-${m.year}`} value={`${m.month}-${m.year}`}>{m.label}</option>)}
          </select>
        </label>
        <div>
          <span className="block text-xs font-semibold text-slate-500 mb-1">{t('gstin')}</span>
          <p className="text-sm font-medium text-slate-800 py-2">{settings?.gstin ?? '-'}</p>
        </div>
        <div className="lg:col-span-2">
          <span className="block text-xs font-semibold text-slate-500 mb-1">{t('companyName')}</span>
          <p className="text-sm font-medium text-slate-800 py-2 truncate" title={settings?.company_name}>{settings?.company_name ?? '-'}</p>
        </div>
      </div>

      {/* Monthly status */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-500">{t('monthlyStatus')}:</span>
          <StatusBadge status={reviewState} variant={reviewVariant[reviewState]} />
        </div>
        <div className="flex items-center gap-2">
          {reviewState !== 'Under Review' && reviewState !== 'Reviewed' && (
            <Button variant="outline" size="sm" onClick={() => saveReviewState('Under Review')}>{t('startReview')}</Button>
          )}
          {reviewState !== 'Reviewed' && (
            <Button variant="secondary" size="sm" onClick={() => saveReviewState('Reviewed')}><Lock className="w-3.5 h-3.5" />{t('markReviewed')}</Button>
          )}
          {reviewState === 'Reviewed' && (
            <Button variant="outline" size="sm" onClick={() => saveReviewState('Not Reviewed')}><LockOpen className="w-3.5 h-3.5" />{t('reopenMonth')}</Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex flex-wrap gap-1">
        {TABS.map(tabItem => (
          <button
            key={tabItem.key}
            onClick={() => setTab(tabItem.key)}
            className={classNames(
              'px-3.5 py-2 text-sm font-semibold rounded-t-lg transition-colors',
              tab === tabItem.key ? 'bg-white border border-b-0 border-slate-200 text-blue-700' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {t(tabItem.labelKey)}
          </button>
        ))}
      </div>

      {loading ? <LoadingSpinner /> : (
        <div>
          {tab === 'dashboard' && <Dashboard summary={summary} salesCount={salesRows.filter(r => r.isCounted).length} purchaseCount={purchaseRows.length} monthLabel={selectedLabel} fy={fy} />}
          {tab === 'sales' && <SalesGst rows={salesRows} monthLabel={selectedLabel} company={companyInfo} />}
          {tab === 'purchase' && <PurchaseGst rows={purchaseRows} monthLabel={selectedLabel} company={companyInfo} onRefresh={loadMonth} />}
          {tab === 'summary' && <MonthlySummary summary={summary} />}
          {tab === 'gstr1' && <Gstr1 rows={salesRows} summary={summary} monthLabel={selectedLabel} company={companyInfo} />}
          {tab === 'gstr3b' && <Gstr3b summary={summary} adjustments={adjustments} onSave={saveAdjustments} saving={savingAdjustments} monthLabel={selectedLabel} company={companyInfo} />}
          {tab === 'errors' && <ErrorCheck issues={issues} monthLabel={selectedLabel} company={companyInfo} />}
        </div>
      )}
    </div>
  );
}
