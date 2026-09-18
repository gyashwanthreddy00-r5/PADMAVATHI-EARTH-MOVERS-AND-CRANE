import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useSettings } from '@/context/SettingsContext';
import { useToast } from '@/components/ui/Toast';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import { Plus, Pencil, Trash2, Download, Filter, X, Landmark, Star } from 'lucide-react';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { buildXlsxWithCompany } from '@/lib/exportXlsx';
import { DatePicker } from '@/components/ui/DatePicker';
import type { BankTransaction, BankAccount, PaymentMode } from '@/types';

const ALL_BANKS = '__all__';

interface LedgerRow extends BankTransaction {
  runningBalance: number;
  bank_account?: { bank_name: string } | null;
}

interface AccountSummary {
  account: BankAccount;
  opening: number;
  credit: number;
  debit: number;
  closing: number;
}

const emptyTxnForm = {
  bank_account_id: '',
  transaction_date: todayISO(),
  transaction_type: 'Debit' as 'Credit' | 'Debit',
  payment_mode: 'Bank Transfer' as PaymentMode,
  particulars: '',
  category: '',
  description: '',
  reference_number: '',
  amount: null as number | null,
};

const emptyAccountForm = {
  bank_name: '',
  account_holder_name: '',
  account_number: '',
  ifsc_code: '',
  branch_name: '',
  account_type: 'Current' as 'Current' | 'Savings',
  opening_balance: 0 as number,
  is_default: false,
};

export default function Bank() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTxns, setLoadingTxns] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BankTransaction | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [form, setForm] = useState(emptyTxnForm);

  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null);
  const [accountForm, setAccountForm] = useState(emptyAccountForm);
  const [savingAccount, setSavingAccount] = useState(false);

  const [filters, setFilters] = useState({ from: '', to: '', transaction_type: '', payment_mode: '', source_module: '' });

  const fetchAccounts = useCallback(async () => {
    const { data } = await supabase.from('bank_accounts').select('*').eq('is_active', true).order('is_default', { ascending: false }).order('bank_name');
    const list = (data ?? []) as BankAccount[];
    setAccounts(list);
    setSelectedAccountId(prev => prev && list.some(a => a.id === prev) ? prev : (list.find(a => a.is_default)?.id ?? list[0]?.id ?? ''));
    setLoading(false);
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const fetchTransactions = useCallback(async (accountId: string) => {
    if (!accountId) { setTransactions([]); return; }
    setLoadingTxns(true);
    let query = supabase.from('bank_transactions').select('*, bank_account:bank_accounts(bank_name)').eq('is_cancelled', false);
    if (accountId !== ALL_BANKS) query = query.eq('bank_account_id', accountId);
    const { data } = await query.order('transaction_date', { ascending: true }).order('created_at', { ascending: true });
    setTransactions((data ?? []) as unknown as BankTransaction[]);
    setLoadingTxns(false);
  }, []);

  useEffect(() => { fetchTransactions(selectedAccountId); }, [selectedAccountId, fetchTransactions]);

  const isAllBanks = selectedAccountId === ALL_BANKS;
  const selectedAccount = useMemo(() => accounts.find(a => a.id === selectedAccountId) ?? null, [accounts, selectedAccountId]);

  const sourceModules = useMemo(() => Array.from(new Set(transactions.map(t2 => t2.source_module))).sort(), [transactions]);

  // Running balance is computed over the FULL unfiltered, date-ordered ledger
  // (opening balance + every credit/debit in order), then filters are
  // applied for display only - so the balance column always reflects the
  // true ledger position, not a recalculation over a filtered subset. In
  // "All Banks" mode, each account's rows get their own running balance
  // (grouped internally by bank_account_id) since two real bank accounts
  // can never share one running total, even when displayed together.
  const ledger: LedgerRow[] = useMemo(() => {
    if (!isAllBanks) {
      let running = Number(selectedAccount?.opening_balance ?? 0);
      return transactions.map(tx => {
        running += tx.transaction_type === 'Credit' ? Number(tx.amount) : -Number(tx.amount);
        return { ...tx, runningBalance: Math.round(running * 100) / 100 };
      });
    }
    const runningByAccount = new Map<string, number>();
    for (const a of accounts) runningByAccount.set(a.id, Number(a.opening_balance));
    return transactions.map(tx => {
      const prev = runningByAccount.get(tx.bank_account_id) ?? 0;
      const next = prev + (tx.transaction_type === 'Credit' ? Number(tx.amount) : -Number(tx.amount));
      runningByAccount.set(tx.bank_account_id, next);
      return { ...tx, runningBalance: Math.round(next * 100) / 100 };
    });
  }, [transactions, selectedAccount, accounts, isAllBanks]);

  const filteredLedger = useMemo(() => {
    return ledger.filter(r => {
      if (filters.from && r.transaction_date < filters.from) return false;
      if (filters.to && r.transaction_date > filters.to) return false;
      if (filters.transaction_type && r.transaction_type !== filters.transaction_type) return false;
      if (filters.payment_mode && r.payment_mode !== filters.payment_mode) return false;
      if (filters.source_module && r.source_module !== filters.source_module) return false;
      return true;
    }).sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.created_at.localeCompare(a.created_at));
  }, [ledger, filters]);

  const totals = useMemo(() => {
    const credit = transactions.reduce((s, tx) => s + (tx.transaction_type === 'Credit' ? Number(tx.amount) : 0), 0);
    const debit = transactions.reduce((s, tx) => s + (tx.transaction_type === 'Debit' ? Number(tx.amount) : 0), 0);
    const closing = Number(selectedAccount?.opening_balance ?? 0) + credit - debit;
    return { credit, debit, closing };
  }, [transactions, selectedAccount]);

  // Per-account breakdown, used only in "All Banks" mode, plus a grand total.
  const accountSummaries: AccountSummary[] = useMemo(() => {
    return accounts.map(account => {
      const own = transactions.filter(tx => tx.bank_account_id === account.id);
      const credit = own.reduce((s, tx) => s + (tx.transaction_type === 'Credit' ? Number(tx.amount) : 0), 0);
      const debit = own.reduce((s, tx) => s + (tx.transaction_type === 'Debit' ? Number(tx.amount) : 0), 0);
      const opening = Number(account.opening_balance);
      return { account, opening, credit, debit, closing: opening + credit - debit };
    });
  }, [accounts, transactions]);

  const grandTotal = useMemo(() => accountSummaries.reduce((acc, s) => ({
    opening: acc.opening + s.opening, credit: acc.credit + s.credit, debit: acc.debit + s.debit, closing: acc.closing + s.closing,
  }), { opening: 0, credit: 0, debit: 0, closing: 0 }), [accountSummaries]);

  const clearFilters = () => setFilters({ from: '', to: '', transaction_type: '', payment_mode: '', source_module: '' });
  const hasActiveFilters = filters.from || filters.to || filters.transaction_type || filters.payment_mode || filters.source_module;

  // ---------------- Manual transaction CRUD ----------------

  const openAddManual = () => { setEditing(null); setForm({ ...emptyTxnForm, bank_account_id: isAllBanks ? '' : selectedAccountId }); setModalOpen(true); };
  const openEditManual = (tx: BankTransaction) => {
    setEditing(tx);
    setForm({
      bank_account_id: tx.bank_account_id,
      transaction_date: tx.transaction_date,
      transaction_type: tx.transaction_type,
      payment_mode: tx.payment_mode,
      particulars: tx.particulars,
      category: tx.category ?? '',
      description: tx.description ?? '',
      reference_number: tx.reference_number ?? '',
      amount: tx.amount,
    });
    setModalOpen(true);
  };

  const saveManual = async () => {
    if (!form.bank_account_id) { show(t('selectBankAccount'), 'error'); return; }
    if (!form.particulars.trim()) { show(`${t('particulars')} - ${t('required')}`, 'error'); return; }
    if (!form.amount || form.amount <= 0) { show(`${t('amount')} - ${t('required')}`, 'error'); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      bank_account_id: form.bank_account_id,
      transaction_date: form.transaction_date,
      transaction_type: form.transaction_type,
      payment_mode: form.payment_mode,
      particulars: form.particulars.trim(),
      category: form.category || null,
      description: form.description || null,
      reference_number: form.reference_number || null,
      amount: form.amount,
      source_module: 'Manual Bank Entry',
    };
    const { error } = editing
      ? await supabase.from('bank_transactions').update(payload).eq('id', editing.id)
      : await supabase.from('bank_transactions').insert({ ...payload, created_by: user?.id ?? null });
    if (error) show(t('saveError'), 'error');
    else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchTransactions(selectedAccountId); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('bank_transactions').update({ is_cancelled: true }).eq('id', deleteId);
    if (error) show(t('deleteError'), 'error');
    else { show(t('deleteSuccess'), 'success'); fetchTransactions(selectedAccountId); }
    setDeleteId(null);
  };

  // ---------------- Bank Account CRUD ----------------

  const openAddAccount = () => { setEditingAccount(null); setAccountForm({ ...emptyAccountForm, is_default: accounts.length === 0 }); setAccountModalOpen(true); };
  const openEditAccount = (a: BankAccount) => {
    setEditingAccount(a);
    setAccountForm({
      bank_name: a.bank_name,
      account_holder_name: a.account_holder_name ?? '',
      account_number: a.account_number ?? '',
      ifsc_code: a.ifsc_code ?? '',
      branch_name: a.branch_name ?? '',
      account_type: (a.account_type as 'Current' | 'Savings') ?? 'Current',
      opening_balance: a.opening_balance,
      is_default: a.is_default,
    });
    setAccountModalOpen(true);
  };

  const saveAccount = async () => {
    if (!accountForm.bank_name.trim()) { show(`${t('bankName')} - ${t('required')}`, 'error'); return; }
    setSavingAccount(true);
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      bank_name: accountForm.bank_name.trim(),
      account_holder_name: accountForm.account_holder_name.trim() || null,
      account_number: accountForm.account_number.trim() || null,
      ifsc_code: accountForm.ifsc_code.trim() || null,
      branch_name: accountForm.branch_name.trim() || null,
      account_type: accountForm.account_type,
      opening_balance: accountForm.opening_balance,
      is_default: accountForm.is_default,
    };
    try {
      // Postgres enforces only one is_default=true row via a partial unique
      // index - clear the current default first so switching default never
      // hits that constraint. editingAccount is null when adding a brand
      // new account (e.g. the very first one, which is always forced
      // default) - .neq() must not run with an empty-string id in that
      // case, since 'id' is a uuid column and '' is not a valid uuid literal.
      if (payload.is_default) {
        const clearQuery = supabase.from('bank_accounts').update({ is_default: false }).eq('is_default', true);
        const { error: clearErr } = editingAccount ? await clearQuery.neq('id', editingAccount.id) : await clearQuery;
        if (clearErr) throw clearErr;
      }
      const { error } = editingAccount
        ? await supabase.from('bank_accounts').update(payload).eq('id', editingAccount.id)
        : await supabase.from('bank_accounts').insert({ ...payload, created_by: user?.id ?? null });
      if (error) throw error;
      show(t('saveSuccess'), 'success');
      setAccountModalOpen(false);
      await fetchAccounts();
    } catch (err) {
      const message = (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string')
        ? (err as { message: string }).message
        : err instanceof Error ? err.message : t('saveError');
      console.error('Bank account save error:', err);
      show(message, 'error');
    }
    setSavingAccount(false);
  };

  // Bank-page-only export: builds on the shared buildXlsxWithCompany() (used
  // untouched, so every other page's Excel export is unaffected) and then
  // appends a bank-statement summary block itself - this function is the
  // only place that logic lives.
  const handleExport = async () => {
    if (filteredLedger.length === 0) { show('No data to export', 'error'); return; }
    const companyInfo = settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin } : { company_name: 'Crane ERP' };
    const headers = [t('date'), t('particulars'), t('transactionType'), t('paymentMode'), t('bankAccount'), t('referenceNumber'), t('debit'), t('credit'), t('runningBalance')];
    const rows = [...filteredLedger].reverse().map(r => [
      formatDate(r.transaction_date), r.particulars, r.transaction_type, r.payment_mode, r.bank_account?.bank_name ?? '—', r.reference_number ?? '-',
      r.transaction_type === 'Debit' ? Number(r.amount) : 0,
      r.transaction_type === 'Credit' ? Number(r.amount) : 0,
      r.runningBalance,
    ]);

    // The summary below is driven purely by the selected Date Range (not by
    // the Type/Mode/Source filters, which only narrow which rows the table
    // above shows) - Opening Balance is the true carried-forward balance
    // from every prior transaction on this account, never hardcoded to 0,
    // and Closing = Opening + period Credits - period Debits. In "All Banks"
    // mode this is computed once per account, since two real bank accounts
    // can never share one opening/closing balance.
    const periodFrom = filters.from || null;
    const periodTo = filters.to || null;
    const periodFor = (accountId: string, openingBalance: number) => {
      let opening = openingBalance;
      let debit = 0;
      let credit = 0;
      for (const tx of transactions) {
        if (tx.bank_account_id !== accountId) continue;
        const amt = Number(tx.amount);
        if (periodFrom && tx.transaction_date < periodFrom) {
          opening += tx.transaction_type === 'Credit' ? amt : -amt;
        } else if (!periodTo || tx.transaction_date <= periodTo) {
          if (tx.transaction_type === 'Credit') credit += amt; else debit += amt;
        }
      }
      opening = Math.round(opening * 100) / 100;
      debit = Math.round(debit * 100) / 100;
      credit = Math.round(credit * 100) / 100;
      return { opening, debit, credit, closing: Math.round((opening + credit - debit) * 100) / 100 };
    };

    const periodLabel = periodFrom || periodTo
      ? `${periodFrom ? formatDate(periodFrom) : 'Start'} to ${periodTo ? formatDate(periodTo) : 'Today'}`
      : 'All Records';

    const wb = buildXlsxWithCompany(
      isAllBanks ? 'Bank Statement - All Banks' : `Bank Statement - ${selectedAccount?.bank_name ?? ''}`,
      companyInfo, periodLabel, new Date().toLocaleString('en-IN'), '',
      headers, rows,
    );
    const ws = wb.worksheets[0];
    const CURRENCY_FMT = '"₹" #,##0.00';
    const THIN = { style: 'thin' as const };
    const MEDIUM = { style: 'medium' as const };

    const addSummaryBlock = (title: string, lines: [string, number][], emphasizeLast: boolean) => {
      ws.addRow([]);
      const titleRow = ws.addRow([title]);
      ws.mergeCells(titleRow.number, 1, titleRow.number, 2);
      titleRow.font = { bold: true, size: 12 };
      titleRow.height = 20;
      lines.forEach(([label, value], idx) => {
        const isLast = emphasizeLast && idx === lines.length - 1;
        const row = ws.addRow([label, value]);
        row.height = 18;
        row.getCell(1).font = { bold: true, size: 11 };
        row.getCell(1).alignment = { horizontal: 'left' };
        row.getCell(2).font = { bold: true, size: 11 };
        row.getCell(2).numFmt = CURRENCY_FMT;
        row.getCell(2).alignment = { horizontal: 'right' };
        row.getCell(1).border = { top: THIN, bottom: THIN, left: THIN };
        row.getCell(2).border = { top: THIN, bottom: THIN, right: THIN };
        if (isLast) {
          row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F0D9' } };
          row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F0D9' } };
          row.getCell(1).border = { top: MEDIUM, bottom: MEDIUM, left: MEDIUM };
          row.getCell(2).border = { top: MEDIUM, bottom: MEDIUM, right: MEDIUM };
        }
      });
    };

    if (isAllBanks) {
      accounts.forEach(a => {
        const p = periodFor(a.id, Number(a.opening_balance));
        addSummaryBlock(`${a.bank_name.toUpperCase()} SUMMARY`, [
          ['Opening Balance:', p.opening],
          ['Total Debits:', p.debit],
          ['Total Credits:', p.credit],
          ['Closing Balance:', p.closing],
        ], true);
      });
      const grand = accounts.reduce((acc, a) => {
        const p = periodFor(a.id, Number(a.opening_balance));
        return { opening: acc.opening + p.opening, debit: acc.debit + p.debit, credit: acc.credit + p.credit, closing: acc.closing + p.closing };
      }, { opening: 0, debit: 0, credit: 0, closing: 0 });
      addSummaryBlock('OVERALL TOTAL (ALL BANKS)', [
        ['Opening Balance:', Math.round(grand.opening * 100) / 100],
        ['Total Debits:', Math.round(grand.debit * 100) / 100],
        ['Total Credits:', Math.round(grand.credit * 100) / 100],
        ['Closing Balance:', Math.round(grand.closing * 100) / 100],
      ], true);
    } else if (selectedAccount) {
      const p = periodFor(selectedAccount.id, Number(selectedAccount.opening_balance));
      addSummaryBlock('BANK STATEMENT SUMMARY', [
        ['Opening Balance:', p.opening],
        ['Total Debits:', p.debit],
        ['Total Credits:', p.credit],
        ['Closing Balance:', p.closing],
      ], true);
    }

    ws.getColumn(1).width = Math.max(ws.getColumn(1).width ?? 10, 20);
    ws.getColumn(2).width = Math.max(ws.getColumn(2).width ?? 10, 18);

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isAllBanks ? 'Bank_Statement_All_Banks.xlsx' : `Bank_Statement_${selectedAccount?.bank_name ?? ''}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const columns: Column<LedgerRow>[] = [
    { key: 'transaction_date', header: t('date'), sortable: true, render: r => formatDate(r.transaction_date) },
    { key: 'particulars', header: t('particulars'), render: r => (
      <div>
        <span className="font-medium text-slate-800">{r.particulars}</span>
        <span className="block text-xs text-slate-400">{r.source_module}{r.category ? ` · ${r.category}` : ''}</span>
      </div>
    ) },
    { key: 'transaction_type', header: t('transactionType'), render: r => <StatusBadge status={r.transaction_type} variant={r.transaction_type === 'Credit' ? 'green' : 'red'} /> },
    { key: 'payment_mode', header: t('paymentMode'), render: r => r.payment_mode },
    { key: 'bank_account', header: t('bankAccount'), render: r => r.bank_account?.bank_name ?? '—' },
    { key: 'reference_number', header: t('referenceNumber'), render: r => r.reference_number ?? r.cheque_number ?? '-' },
    { key: 'debit', header: t('debit'), align: 'right', render: r => r.transaction_type === 'Debit' ? <span className="font-medium text-red-600">{formatCurrency(r.amount)}</span> : '-' },
    { key: 'credit', header: t('credit'), align: 'right', render: r => r.transaction_type === 'Credit' ? <span className="font-medium text-emerald-600">{formatCurrency(r.amount)}</span> : '-' },
    { key: 'runningBalance', header: t('runningBalance'), align: 'right', render: r => <span className="font-semibold text-slate-800">{formatCurrency(r.runningBalance)}</span> },
    {
      key: 'actions', header: t('actions'), align: 'center',
      render: r => r.source_module === 'Manual Bank Entry' ? (
        <div className="flex justify-center gap-1">
          <button onClick={() => openEditManual(r)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Pencil className="w-4 h-4" /></button>
          <button onClick={() => setDeleteId(r.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 className="w-4 h-4" /></button>
        </div>
      ) : <span className="text-xs text-slate-300">—</span>,
    },
  ];

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* Bank account selector */}
      <div className="flex items-center gap-2 flex-wrap">
        {accounts.length > 1 && (
          <button
            onClick={() => setSelectedAccountId(ALL_BANKS)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${isAllBanks ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
          >
            <Landmark className="w-4 h-4" />
            {t('allBanks')}
          </button>
        )}
        {accounts.map(a => (
          <button
            key={a.id}
            onClick={() => setSelectedAccountId(a.id)}
            className={`group flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${a.id === selectedAccountId ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
          >
            <Landmark className="w-4 h-4" />
            {a.bank_name}
            {a.is_default && <Star className={`w-3 h-3 ${a.id === selectedAccountId ? 'text-white fill-white' : 'text-amber-500 fill-amber-500'}`} />}
            <span
              role="button"
              tabIndex={-1}
              onClick={e => { e.stopPropagation(); openEditAccount(a); }}
              className={`ml-1 p-0.5 rounded ${a.id === selectedAccountId ? 'hover:bg-blue-700' : 'hover:bg-slate-200'}`}
            >
              <Pencil className="w-3 h-3" />
            </span>
          </button>
        ))}
        <Button variant="outline" size="sm" onClick={openAddAccount}><Plus className="w-4 h-4" />{t('addBankAccount')}</Button>
      </div>

      {!selectedAccount && !isAllBanks ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center text-slate-500">
          {t('addBankAccount')}
        </div>
      ) : (
        <>
          {isAllBanks ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">{t('bankAccount')}</th>
                    <th className="text-right px-4 py-2 font-medium text-slate-600">{t('openingBalance')}</th>
                    <th className="text-right px-4 py-2 font-medium text-emerald-600">{t('totalCredit')}</th>
                    <th className="text-right px-4 py-2 font-medium text-red-600">{t('totalDebit')}</th>
                    <th className="text-right px-4 py-2 font-medium text-blue-600">{t('closingBalance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {accountSummaries.map(s => (
                    <tr key={s.account.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-medium text-slate-800 flex items-center gap-1.5"><Landmark className="w-3.5 h-3.5 text-slate-400" />{s.account.bank_name}{s.account.is_default && <Star className="w-3 h-3 text-amber-500 fill-amber-500" />}</td>
                      <td className="px-4 py-2 text-right text-slate-700">{formatCurrency(s.opening)}</td>
                      <td className="px-4 py-2 text-right text-emerald-700">{formatCurrency(s.credit)}</td>
                      <td className="px-4 py-2 text-right text-red-700">{formatCurrency(s.debit)}</td>
                      <td className="px-4 py-2 text-right font-semibold text-blue-700">{formatCurrency(s.closing)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-4 py-2 font-bold text-slate-800">{t('overallTotal')}</td>
                    <td className="px-4 py-2 text-right font-bold text-slate-800">{formatCurrency(grandTotal.opening)}</td>
                    <td className="px-4 py-2 text-right font-bold text-emerald-700">{formatCurrency(grandTotal.credit)}</td>
                    <td className="px-4 py-2 text-right font-bold text-red-700">{formatCurrency(grandTotal.debit)}</td>
                    <td className="px-4 py-2 text-right font-bold text-blue-700">{formatCurrency(grandTotal.closing)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : selectedAccount && (
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
                <p className="text-xs text-slate-500">{t('openingBalance')}</p>
                <p className="text-lg font-bold text-slate-800">{formatCurrency(selectedAccount.opening_balance)}</p>
              </div>
              <div className="bg-white rounded-lg border border-emerald-200 p-3 shadow-sm">
                <p className="text-xs text-emerald-600">{t('totalCredit')}</p>
                <p className="text-lg font-bold text-emerald-700">{formatCurrency(totals.credit)}</p>
              </div>
              <div className="bg-white rounded-lg border border-red-200 p-3 shadow-sm">
                <p className="text-xs text-red-600">{t('totalDebit')}</p>
                <p className="text-lg font-bold text-red-700">{formatCurrency(totals.debit)}</p>
              </div>
              <div className="bg-white rounded-lg border border-blue-200 p-3 shadow-sm">
                <p className="text-xs text-blue-600 flex items-center gap-1"><Landmark className="w-3.5 h-3.5" />{t('closingBalance')}</p>
                <p className="text-lg font-bold text-blue-700">{formatCurrency(totals.closing)}</p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowFilters(s => !s)}><Filter className="w-4 h-4" />{t('filter')}</Button>
              {hasActiveFilters && <Button variant="outline" size="sm" onClick={clearFilters}><X className="w-4 h-4" />{t('clear')}</Button>}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleExport} disabled={filteredLedger.length === 0}><Download className="w-4 h-4" />{t('export')}</Button>
              <Button onClick={openAddManual}><Plus className="w-4 h-4" />{t('addManualEntry')}</Button>
            </div>
          </div>

          {showFilters && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <Field label={t('from')}>
                  <DatePicker value={filters.from} onChange={v => setFilters(f => ({ ...f, from: v }))} />
                </Field>
                <Field label={t('to')}>
                  <DatePicker value={filters.to} onChange={v => setFilters(f => ({ ...f, to: v }))} />
                </Field>
                <Field label={t('transactionType')}>
                  <select className={inputClass()} value={filters.transaction_type} onChange={e => setFilters(f => ({ ...f, transaction_type: e.target.value }))}>
                    <option value="">{t('all')}</option>
                    <option value="Credit">Credit</option>
                    <option value="Debit">Debit</option>
                  </select>
                </Field>
                <Field label={t('paymentMode')}>
                  <select className={inputClass()} value={filters.payment_mode} onChange={e => setFilters(f => ({ ...f, payment_mode: e.target.value }))}>
                    <option value="">{t('all')}</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Bank">Bank</option>
                    <option value="Credit">Credit</option>
                    <option value="UPI">UPI</option>
                    <option value="Cheque">Cheque</option>
                    <option value="NEFT">NEFT</option>
                    <option value="RTGS">RTGS</option>
                    <option value="Online">Online</option>
                    <option value="Other">Other</option>
                  </select>
                </Field>
                <Field label={t('sourceModule')}>
                  <select className={inputClass()} value={filters.source_module} onChange={e => setFilters(f => ({ ...f, source_module: e.target.value }))}>
                    <option value="">{t('all')}</option>
                    {sourceModules.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
              </div>
            </div>
          )}

          {loadingTxns ? <LoadingSpinner /> : (
            <DataTable columns={columns} data={filteredLedger} searchKeys={['particulars', 'reference_number', 'category']} searchPlaceholder={`${t('search')}...`} showSerialNumber />
          )}
        </>
      )}

      {/* Manual transaction modal */}
      <Modal
        open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? `${t('edit')} ${t('manualBankEntry')}` : t('addManualEntry')}
        closeOnBackdropClick={false}
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={saveManual} disabled={saving}>{saving ? t('saving') : t('save')}</Button></>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('bankAccount')} required>
            <select className={inputClass()} value={form.bank_account_id} onChange={e => setForm(f => ({ ...f, bank_account_id: e.target.value }))}>
              <option value="">{t('selectBankAccount')}</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name}</option>)}
            </select>
          </Field>
          <Field label={t('date')} required>
            <DatePicker value={form.transaction_date} onChange={v => setForm(f => ({ ...f, transaction_date: v }))} />
          </Field>
          <Field label={t('transactionType')} required>
            <select className={inputClass()} value={form.transaction_type} onChange={e => setForm(f => ({ ...f, transaction_type: e.target.value as 'Credit' | 'Debit' }))}>
              <option value="Debit">Debit</option>
              <option value="Credit">Credit</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('particulars')} required>
              <input className={inputClass()} value={form.particulars} onChange={e => setForm(f => ({ ...f, particulars: e.target.value }))} placeholder="e.g. Bank interest, service charge..." />
            </Field>
          </div>
          <Field label={t('amount')} required>
            <input type="number" step="0.01" min="0" className={inputClass()} value={form.amount ?? ''} onChange={e => setForm(f => ({ ...f, amount: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
          <Field label={t('paymentMode')}>
            <select className={inputClass()} value={form.payment_mode} onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value as PaymentMode }))}>
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="UPI">UPI</option>
              <option value="Cheque">Cheque</option>
              <option value="NEFT">NEFT</option>
              <option value="RTGS">RTGS</option>
              <option value="Other">Other</option>
            </select>
          </Field>
          <Field label={t('referenceNumber')}>
            <input className={inputClass()} value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} />
          </Field>
          <Field label={t('category')}>
            <input className={inputClass()} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="Optional" />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('remarks')}>
              <input className={inputClass()} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional notes" />
            </Field>
          </div>
        </div>
      </Modal>

      {/* Bank account add/edit modal */}
      <Modal
        open={accountModalOpen} onClose={() => setAccountModalOpen(false)}
        title={editingAccount ? `${t('edit')} ${t('bankAccount')}` : t('addBankAccount')}
        closeOnBackdropClick={false}
        footer={<><Button variant="secondary" onClick={() => setAccountModalOpen(false)}>{t('cancel')}</Button><Button onClick={saveAccount} disabled={savingAccount}>{savingAccount ? t('saving') : t('save')}</Button></>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('bankName')} required>
            <input className={inputClass()} value={accountForm.bank_name} onChange={e => setAccountForm(f => ({ ...f, bank_name: e.target.value }))} placeholder="e.g. Axis Bank" />
          </Field>
          <Field label={t('accountHolderName')}>
            <input className={inputClass()} value={accountForm.account_holder_name} onChange={e => setAccountForm(f => ({ ...f, account_holder_name: e.target.value }))} />
          </Field>
          <Field label={t('accountNumber')}>
            <input className={inputClass()} value={accountForm.account_number} onChange={e => setAccountForm(f => ({ ...f, account_number: e.target.value }))} />
          </Field>
          <Field label={t('ifscCode')}>
            <input className={inputClass()} value={accountForm.ifsc_code} onChange={e => setAccountForm(f => ({ ...f, ifsc_code: e.target.value }))} />
          </Field>
          <Field label={t('branchName')}>
            <input className={inputClass()} value={accountForm.branch_name} onChange={e => setAccountForm(f => ({ ...f, branch_name: e.target.value }))} />
          </Field>
          <Field label={t('accountType')}>
            <select className={inputClass()} value={accountForm.account_type} onChange={e => setAccountForm(f => ({ ...f, account_type: e.target.value as 'Current' | 'Savings' }))}>
              <option value="Current">{t('current')}</option>
              <option value="Savings">{t('savings')}</option>
            </select>
          </Field>
          <Field label={t('openingBalance')}>
            <input type="number" step="0.01" className={inputClass()} value={accountForm.opening_balance} onChange={e => setAccountForm(f => ({ ...f, opening_balance: e.target.value === '' ? 0 : Number(e.target.value) }))} />
          </Field>
          <div className="sm:col-span-2 flex items-center gap-2 pt-2">
            <input type="checkbox" id="is_default" checked={accountForm.is_default} onChange={e => setAccountForm(f => ({ ...f, is_default: e.target.checked }))} className="w-4 h-4" />
            <label htmlFor="is_default" className="text-sm text-slate-700">{t('setAsDefault')}</label>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title={t('delete')} message={t('confirmDelete')} confirmText={t('delete')} danger />
    </div>
  );
}
