import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner, EmptyState } from '@/components/ui/common';
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Wrench } from 'lucide-react';
import type { MaintenanceTypeConfig } from '@/types';

export default function MaintenanceTypes() {
  const { t } = useLang();
  const { show } = useToast();
  const [types, setTypes] = useState<MaintenanceTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceTypeConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');

  const fetchTypes = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('maintenance_types').select('*').order('sort_order', { ascending: true });
    if (error) {
      show('Unable to load maintenance types.', 'error');
      setTypes([]);
    } else {
      setTypes((data ?? []) as MaintenanceTypeConfig[]);
    }
    setLoading(false);
  }, [show]);

  useEffect(() => { fetchTypes(); }, [fetchTypes]);

  const openAdd = () => { setEditing(null); setFormName(''); setModalOpen(true); };
  const openEdit = (mt: MaintenanceTypeConfig) => { setEditing(mt); setFormName(mt.name); setModalOpen(true); };

  const save = async () => {
    const name = formName.trim();
    if (!name) { show(t('required'), 'error'); return; }
    setSaving(true);
    if (editing) {
      const { error } = await supabase.from('maintenance_types').update({ name, updated_at: new Date().toISOString() }).eq('id', editing.id);
      if (error) {
        if (error.code === '23505') show(t('duplicateError'), 'error');
        else show(t('saveError'), 'error');
      } else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchTypes(); }
    } else {
      const maxSort = types.length > 0 ? Math.max(...types.map(ty => ty.sort_order)) : 0;
      const { error } = await supabase.from('maintenance_types').insert({ name, sort_order: maxSort + 1, is_active: true });
      if (error) {
        if (error.code === '23505') show(t('duplicateError'), 'error');
        else show(t('saveError'), 'error');
      } else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchTypes(); }
    }
    setSaving(false);
  };

  const toggleActive = async (mt: MaintenanceTypeConfig) => {
    const { error } = await supabase.from('maintenance_types').update({ is_active: !mt.is_active, updated_at: new Date().toISOString() }).eq('id', mt.id);
    if (error) show(t('saveError'), 'error');
    else { show(`${mt.name} ${!mt.is_active ? t('active') : t('inactive')}`, 'success'); fetchTypes(); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('maintenance_types').delete().eq('id', deleteId);
    if (error) show(t('deleteError'), 'error');
    else { show(t('deleteSuccess'), 'success'); fetchTypes(); }
    setDeleteId(null);
  };

  const moveOrder = async (mt: MaintenanceTypeConfig, direction: 'up' | 'down') => {
    const sorted = [...types].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex(s => s.id === mt.id);
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === sorted.length - 1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    const swapItem = sorted[swapIdx];
    await Promise.all([
      supabase.from('maintenance_types').update({ sort_order: swapItem.sort_order }).eq('id', mt.id),
      supabase.from('maintenance_types').update({ sort_order: mt.sort_order }).eq('id', swapItem.id),
    ]);
    fetchTypes();
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{t('maintenanceTypes')}</h2>
          <p className="text-sm text-slate-500">{types.length} {t('maintenanceTypes')}</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4" />{t('addNew')}</Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {types.length === 0 ? (
          <div className="p-8"><EmptyState message={t('noMaintenanceTypes')} icon={Wrench} /></div>
        ) : (
          <div className="divide-y divide-slate-100">
            {[...types].sort((a, b) => a.sort_order - b.sort_order).map((mt, idx) => (
              <div key={mt.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => moveOrder(mt, 'up')} disabled={idx === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button onClick={() => moveOrder(mt, 'down')} disabled={idx === types.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"><ArrowDown className="w-3.5 h-3.5" /></button>
                </div>
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-blue-600">{idx + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{mt.name}</p>
                </div>
                <StatusBadge status={mt.is_active ? t('active') : t('inactive')} variant={mt.is_active ? 'green' : 'gray'} />
                <button onClick={() => toggleActive(mt)} className="px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors">
                  {mt.is_active ? t('inactive') : t('active')}
                </button>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(mt)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => setDeleteId(mt.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          {t('deactivateDeleteNote')}
        </p>
      </div>

      <Modal
        open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? `${t('edit')} ${t('maintenanceType')}` : `${t('addNew')} ${t('maintenanceType')}`}
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={save} disabled={saving}>{saving ? t('saving') : t('save')}</Button></>}
      >
        <Field label={t('maintenanceType')} required>
          <input className={inputClass()} value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Batteries, Tyres, Oil Change..." autoFocus />
        </Field>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title={t('delete')} message={t('deleteTypeNote')} confirmText={t('delete')} danger />
    </div>
  );
}
