import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner, EmptyState } from '@/components/ui/common';
import { Plus, Pencil, Trash2, Shield, Lock } from 'lucide-react';
import type { Role } from '@/types';

export default function RolesPermissions() {
  const { t } = useLang();
  const { show } = useToast();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('roles').select('*').order('is_system', { ascending: false }).order('name');
    if (error) { show(t('noRolesConfigured'), 'error'); setRoles([]); }
    else setRoles((data ?? []) as Role[]);
    setLoading(false);
  }, [show]);

  useEffect(() => { fetchRoles(); }, [fetchRoles]);

  const openAdd = () => { setEditing(null); setFormName(''); setFormDesc(''); setModalOpen(true); };
  const openEdit = (r: Role) => { setEditing(r); setFormName(r.name); setFormDesc(r.description ?? ''); setModalOpen(true); };

  const save = async () => {
    const name = formName.trim();
    if (!name) { show(t('required'), 'error'); return; }
    setSaving(true);
    if (editing) {
      const { error } = await supabase.from('roles').update({ name, description: formDesc.trim() || null, updated_at: new Date().toISOString() }).eq('id', editing.id);
      if (error) { show(error.code === '23505' ? t('duplicateError') : t('saveError'), 'error'); }
      else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchRoles(); }
    } else {
      const { error } = await supabase.from('roles').insert({ name, description: formDesc.trim() || null, is_system: false, is_active: true });
      if (error) { show(error.code === '23505' ? t('duplicateError') : t('saveError'), 'error'); }
      else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchRoles(); }
    }
    setSaving(false);
  };

  const toggleActive = async (r: Role) => {
    const { error } = await supabase.from('roles').update({ is_active: !r.is_active, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (error) show(t('saveError'), 'error'); else fetchRoles();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const role = roles.find(r => r.id === deleteId);
    if (role?.is_system) { show(t('systemRoleNoDelete'), 'error'); setDeleteId(null); return; }
    const { error } = await supabase.from('roles').delete().eq('id', deleteId);
    if (error) show(t('deleteError'), 'error');
    else { show(t('deleteSuccess'), 'success'); fetchRoles(); }
    setDeleteId(null);
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{t('rolesAndPermissions')}</h2>
          <p className="text-sm text-slate-500">{roles.length} {t('rolesCount')}</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4" />{t('addNew')}</Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {roles.length === 0 ? (
          <div className="p-8"><EmptyState message={t('noRolesConfigured')} icon={Shield} /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{t('roleName')}</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{t('roleDescription')}</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {roles.map(role => (
                <tr key={role.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-blue-500 flex-shrink-0" />
                      <span className="text-sm font-semibold text-slate-800">{role.name}</span>
                      {role.is_system && <Lock className="w-3.5 h-3.5 text-slate-400" />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">{role.description ?? '-'}</td>
                  <td className="px-4 py-3"><StatusBadge status={role.is_active ? t('active') : t('inactive')} variant={role.is_active ? 'green' : 'gray'} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-1 justify-end">
                      {!role.is_system && (
                        <button onClick={() => toggleActive(role)} className="px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors">
                          {role.is_active ? t('inactive') : t('active')}
                        </button>
                      )}
                      <button onClick={() => openEdit(role)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Pencil className="w-4 h-4" /></button>
                      {!role.is_system && (
                        <button onClick={() => setDeleteId(role.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `${t('edit')} ${t('roleName')}` : `${t('addNew')} ${t('roleName')}`}
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={save} disabled={saving}>{saving ? t('saving') : t('save')}</Button></>}>
        <div className="space-y-4">
          <Field label={t('roleName')} required><input className={inputClass()} value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Manager, Operator, Accountant" autoFocus /></Field>
          <Field label={t('roleDescription')}><input className={inputClass()} value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="What this role can do..." /></Field>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title={t('delete')} message={t('deleteRoleNote')} confirmText={t('delete')} danger />
    </div>
  );
}
