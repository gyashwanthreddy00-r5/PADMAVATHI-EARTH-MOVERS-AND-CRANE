import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner, EmptyState } from '@/components/ui/common';
import { Plus, Pencil, Trash2, FileText } from 'lucide-react';
import type { PageEntry } from '@/types';

export default function PagesManagement() {
  const { t } = useLang();
  const { show } = useToast();
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PageEntry | null>(null);
  const [formPath, setFormPath] = useState('');
  const [formLabelKey, setFormLabelKey] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formSection, setFormSection] = useState('');
  const [formIcon, setFormIcon] = useState('');
  const [formSort, setFormSort] = useState(0);
  const [formActive, setFormActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchPages = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('pages').select('*').order('sort_order');
    if (error) { show(t('noPagesConfigured'), 'error'); setPages([]); }
    else setPages((data ?? []) as PageEntry[]);
    setLoading(false);
  }, [show]);

  useEffect(() => { fetchPages(); }, [fetchPages]);

  const openAdd = () => {
    setEditing(null); setFormPath(''); setFormLabelKey(''); setFormLabel(''); setFormSection(''); setFormIcon(''); setFormSort(0); setFormActive(true);
    setModalOpen(true);
  };
  const openEdit = (p: PageEntry) => {
    setEditing(p); setFormPath(p.path); setFormLabelKey(p.label_key); setFormLabel(p.label); setFormSection(p.section); setFormIcon(p.icon ?? ''); setFormSort(p.sort_order); setFormActive(p.is_active);
    setModalOpen(true);
  };

  const save = async () => {
    const path = formPath.trim();
    const label = formLabel.trim();
    const label_key = formLabelKey.trim();
    const section = formSection.trim();
    if (!path || !label || !label_key || !section) { show(t('required'), 'error'); return; }
    setSaving(true);
    const payload = { path, label_key, label, section, icon: formIcon.trim() || null, sort_order: formSort, is_active: formActive, updated_at: new Date().toISOString() };
    if (editing) {
      const { error } = await supabase.from('pages').update(payload).eq('id', editing.id);
      if (error) { show(error.code === '23505' ? t('duplicateError') : t('saveError'), 'error'); }
      else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchPages(); }
    } else {
      const { error } = await supabase.from('pages').insert(payload);
      if (error) { show(error.code === '23505' ? t('duplicateError') : t('saveError'), 'error'); }
      else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchPages(); }
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('pages').delete().eq('id', deleteId);
    if (error) show(t('deleteError'), 'error');
    else { show(t('deleteSuccess'), 'success'); fetchPages(); }
    setDeleteId(null);
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{t('pagesManagement')}</h2>
          <p className="text-sm text-slate-500">{pages.length} {t('pagesCount')}</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4" />{t('addNew')}</Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {pages.length === 0 ? (
          <div className="p-8"><EmptyState message={t('noPagesConfigured')} icon={FileText} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{t('path')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{t('label')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{t('section')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{t('icon')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{t('sort')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{t('status')}</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{t('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pages.map(page => (
                  <tr key={page.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-mono text-slate-700">{page.path}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{page.label}</td>
                    <td className="px-4 py-3 text-sm text-slate-500 capitalize">{page.section}</td>
                    <td className="px-4 py-3 text-sm text-slate-400">{page.icon ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-400 tabular-nums">{page.sort_order}</td>
                    <td className="px-4 py-3"><StatusBadge status={page.is_active ? t('active') : t('inactive')} variant={page.is_active ? 'green' : 'gray'} /></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => openEdit(page)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setDeleteId(page.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `${t('edit')} ${t('pagesManagement')}` : `${t('addNew')} ${t('pagesManagement')}`} size="lg"
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={save} disabled={saving}>{saving ? t('saving') : t('save')}</Button></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('pathUrl')} required><input className={inputClass()} value={formPath} onChange={e => setFormPath(e.target.value)} placeholder="/settings/users" /></Field>
          <Field label={t('labelKey')} required><input className={inputClass()} value={formLabelKey} onChange={e => setFormLabelKey(e.target.value)} placeholder="userManagement" /></Field>
          <Field label={t('displayLabel')} required><input className={inputClass()} value={formLabel} onChange={e => setFormLabel(e.target.value)} placeholder="User Management" /></Field>
          <Field label={t('section')} required><input className={inputClass()} value={formSection} onChange={e => setFormSection(e.target.value)} placeholder="settings" /></Field>
          <Field label={t('iconName')}><input className={inputClass()} value={formIcon} onChange={e => setFormIcon(e.target.value)} placeholder="Shield" /></Field>
          <Field label={t('sortOrder')}><input type="number" className={inputClass()} value={formSort} onChange={e => setFormSort(Number(e.target.value))} /></Field>
          <Field label={t('status')}>
            <select className={inputClass()} value={formActive ? 'true' : 'false'} onChange={e => setFormActive(e.target.value === 'true')}>
              <option value="true">{t('active')}</option>
              <option value="false">{t('inactive')}</option>
            </select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title={t('delete')} message={t('confirmDelete')} confirmText={t('delete')} danger />
    </div>
  );
}
