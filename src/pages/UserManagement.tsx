import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner, EmptyState } from '@/components/ui/common';
import { Plus, Pencil, Trash2, Users, Shield, Eye, EyeOff, Search, Power, UserCheck, UserX } from 'lucide-react';
import type { Role } from '@/types';

interface UserWithRoles {
  id: string;
  auth_user_id: string;
  username: string;
  display_name: string | null;
  role: string;
  active: boolean;
  password?: string;
  created_at: string;
  updated_at: string;
  roles: Array<{ id: string; name: string; is_active: boolean }>;
}

export default function UserManagement() {
  const { t } = useLang();
  const { show } = useToast();
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserWithRoles | null>(null);
  const [formUsername, setFormUsername] = useState('');
  const [formDisplay, setFormDisplay] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [formRoleIds, setFormRoleIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [search, setSearch] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [usersRes, rolesRes] = await Promise.all([
      supabase.from('user_profiles').select('id, auth_user_id, username, display_name, role, active, password, created_at, updated_at').order('username'),
      supabase.from('roles').select('*').order('is_system', { ascending: false }).order('name'),
    ]);
    if (usersRes.error || rolesRes.error) { show(t('noUsersFound'), 'error'); setLoading(false); return; }
    const userList = (usersRes.data ?? []) as Omit<UserWithRoles, 'roles'>[];
    const roleList = (rolesRes.data ?? []) as Role[];

    const { data: urData } = await supabase.from('user_roles').select('user_id, role_id, roles!inner(id, name, is_active)');
    const urMap: Record<string, Array<{ id: string; name: string; is_active: boolean }>> = {};
    for (const ur of (urData as Array<{ user_id: string; role_id: string; roles: { id: string; name: string; is_active: boolean } }> | null) ?? []) {
      if (!urMap[ur.user_id]) urMap[ur.user_id] = [];
      urMap[ur.user_id].push({ id: ur.role_id, name: ur.roles.name, is_active: ur.roles.is_active });
    }
    setUsers(userList.map(u => ({ ...u, roles: urMap[u.id] ?? [] })));
    setRoles(roleList);
    setLoading(false);
  }, [show]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter(u => u.active).length,
    inactive: users.filter(u => !u.active).length,
    withRoles: users.filter(u => u.roles.length > 0).length,
  }), [users]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      u.username.toLowerCase().includes(q) ||
      (u.display_name ?? '').toLowerCase().includes(q) ||
      u.roles.some(r => r.name.toLowerCase().includes(q))
    );
  }, [users, search]);

  const openAdd = () => {
    setEditing(null); setFormUsername(''); setFormDisplay(''); setFormPassword(''); setPasswordError(''); setFormActive(true); setFormRoleIds(new Set());
    setShowPassword(false);
    setModalOpen(true);
  };
  const openEdit = (u: UserWithRoles) => {
    setEditing(u); setFormUsername(u.username); setFormDisplay(u.display_name ?? ''); setFormPassword(u.password ?? ''); setPasswordError(''); setFormActive(u.active);
    setFormRoleIds(new Set(u.roles.map(r => r.id)));
    setShowPassword(false);
    setModalOpen(true);
  };

  const toggleFormRole = (roleId: string, checked: boolean) => {
    setFormRoleIds(prev => { const next = new Set(prev); if (checked) next.add(roleId); else next.delete(roleId); return next; });
  };

  const toggleUserStatus = async (user: UserWithRoles) => {
    setTogglingId(user.id);
    const { data: result, error: functionError } = await supabase.functions.invoke('create-user', {
      body: { action: 'toggle-status', profile_id: user.id, active: !user.active },
    });
    if (functionError || result?.error) {
      show(result?.error ?? 'Unable to update status. Please try again.', 'error');
    } else {
      show(`${user.display_name ?? user.username} ${!user.active ? t('userNowActive') : t('userNowInactive')}.`, 'success');
      fetchAll();
    }
    setTogglingId(null);
  };

  const save = async () => {
    const username = formUsername.trim().toLowerCase();
    if (!username) { show(t('required'), 'error'); return; }
    const passwordChanged = !editing || formPassword !== editing.password;
    if (passwordChanged && formPassword.length < 6) {
      setPasswordError(t('passwordMinLength'));
      show(t('passwordMinLength'), 'error');
      return;
    }
    setPasswordError('');
    setSaving(true);

    if (editing) {
      const passwordToSend = formPassword === editing.password ? undefined : (formPassword || undefined);
      const { data: result, error: functionError } = await supabase.functions.invoke('create-user', {
        body: {
          action: 'update',
          profile_id: editing.id,
          username,
          display_name: formDisplay.trim() || null,
          password: passwordToSend,
          active: formActive,
        },
      });

      if (functionError || result?.error) {
        const message = result?.error ?? functionError?.message ?? 'Unable to save the user. Please try again.';
        show(message, 'error');
        setSaving(false);
        return;
      }

      const currentRoleIds = new Set(editing.roles.map(r => r.id));
      const toAdd = [...formRoleIds].filter(id => !currentRoleIds.has(id));
      const toRemove = [...currentRoleIds].filter(id => !formRoleIds.has(id));
      const ops: Promise<unknown>[] = [];
      if (toAdd.length > 0) ops.push(supabase.from('user_roles').insert(toAdd.map(id => ({ user_id: editing.id, role_id: id }))));
      if (toRemove.length > 0) ops.push(supabase.from('user_roles').delete().eq('user_id', editing.id).in('role_id', toRemove));
      await Promise.all(ops);
      show(t('saveSuccess'), 'success'); setModalOpen(false); fetchAll();
    } else {
      if (!formPassword) { show(t('passwordRequiredNew'), 'error'); setSaving(false); return; }

      const { data: result, error: functionError } = await supabase.functions.invoke('create-user', {
        body: {
          action: 'create',
          username,
          password: formPassword,
          display_name: formDisplay.trim() || username,
          active: formActive,
        },
      });

      if (functionError || result?.error) {
        const message = result?.error ?? functionError?.message ?? 'Unable to create the user. Please try again.';
        show(message, 'error');
        setSaving(false);
        return;
      }

      const { data: newUser, error: profileError } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('username', username)
        .maybeSingle();

      if (profileError || !newUser) {
        show('User was created, but roles could not be assigned. Please assign them from the user list.', 'error');
        setModalOpen(false);
        fetchAll();
        setSaving(false);
        return;
      }

      if (formRoleIds.size > 0) {
        const { error: roleError } = await supabase.from('user_roles').insert(
          [...formRoleIds].map(id => ({ user_id: newUser.id, role_id: id })),
        );
        if (roleError) {
          show('User was created, but roles could not be assigned. Please assign them from the user list.', 'error');
          setModalOpen(false);
          fetchAll();
          setSaving(false);
          return;
        }
      }

      show(t('saveSuccess'), 'success');
      setModalOpen(false);
      fetchAll();
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setSaving(true);

    const { data: result, error: functionError } = await supabase.functions.invoke('create-user', {
      body: { action: 'delete', profile_id: deleteId },
    });

    if (functionError || result?.error) {
      show(result?.error ?? 'Unable to delete the user. Please try again.', 'error');
    } else {
      show(t('deleteSuccess'), 'success');
      fetchAll();
    }

    setDeleteId(null);
    setSaving(false);
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{t('userManagement')}</h2>
          <p className="text-sm text-slate-500">{stats.total} {t('usersCount')}</p>
        </div>
        <Button onClick={openAdd}><Plus className="w-4 h-4" />{t('addNew')}</Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <Users className="w-5 h-5 text-blue-600" />
          </div>
          <div><p className="text-2xl font-bold text-slate-800">{stats.total}</p><p className="text-xs text-slate-500">{t('totalUsers')}</p></div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <UserCheck className="w-5 h-5 text-emerald-600" />
          </div>
          <div><p className="text-2xl font-bold text-slate-800">{stats.active}</p><p className="text-xs text-slate-500">{t('active')}</p></div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
            <UserX className="w-5 h-5 text-slate-500" />
          </div>
          <div><p className="text-2xl font-bold text-slate-800">{stats.inactive}</p><p className="text-xs text-slate-500">{t('inactive')}</p></div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
            <Shield className="w-5 h-5 text-amber-600" />
          </div>
          <div><p className="text-2xl font-bold text-slate-800">{stats.withRoles}</p><p className="text-xs text-slate-500">{t('withRoles')}</p></div>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          className={`${inputClass()} pl-10`}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('searchUser')}
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {filteredUsers.length === 0 ? (
          <div className="p-8"><EmptyState message={search ? t('noUsersMatch') : t('noUsersFound')} icon={Users} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">User</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Roles</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{t('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map(user => (
                  <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-xs font-bold text-slate-600 flex-shrink-0">
                          {(user.display_name ?? user.username ?? 'U')[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{user.display_name ?? user.username}</p>
                          <p className="text-xs text-slate-400 truncate">{user.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {user.roles.length === 0 ? (
                          <span className="text-xs text-slate-400 italic">{t('noRoleAssigned')}</span>
                        ) : user.roles.map(r => (
                          <span key={r.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                            <Shield className="w-3 h-3" />{r.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={user.active ? t('active') : t('inactive')} variant={user.active ? 'green' : 'gray'} /></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => toggleUserStatus(user)}
                          disabled={togglingId === user.id}
                          title={user.active ? t('deactivate') : t('activate')}
                          className={`p-1.5 rounded-md transition-colors disabled:opacity-50 ${user.active ? 'text-slate-500 hover:text-amber-600 hover:bg-amber-50' : 'text-slate-500 hover:text-emerald-600 hover:bg-emerald-50'}`}
                        >
                          <Power className="w-4 h-4" />
                        </button>
                        <button onClick={() => openEdit(user)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setDeleteId(user.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `${t('edit')} ${t('userManagement')}` : `${t('addNew')} ${t('userManagement')}`} size="lg"
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={save} disabled={saving}>{saving ? t('saving') : t('save')}</Button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('username')} required>
              <input className={inputClass()} value={formUsername} onChange={e => setFormUsername(e.target.value)} placeholder="login username" autoFocus />
            </Field>
            <Field label={t('displayName')}>
              <input className={inputClass()} value={formDisplay} onChange={e => setFormDisplay(e.target.value)} placeholder="Full name" />
            </Field>
            <Field label={t('password')} required={!editing}>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className={`${inputClass()} pr-10`}
                  value={formPassword}
                  onChange={e => {
                    const value = e.target.value;
                    setFormPassword(value);
                    setPasswordError(value.length > 0 && value.length < 6 ? 'Password must be at least 6 characters.' : '');
                  }}
                  placeholder={editing ? t('currentPasswordEdit') : t('setPassword')}
                  autoComplete="new-password"
                  minLength={6}
                  aria-invalid={!!passwordError}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  title={showPassword ? t('hidePassword') : t('showPassword')}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {passwordError ? (
                <p className="mt-1.5 text-xs font-medium text-red-600">{passwordError}</p>
              ) : editing ? (
                <p className="mt-1.5 text-xs text-slate-400">{t('currentPasswordNote')}</p>
              ) : (
                <p className="mt-1.5 text-xs text-slate-400">{t('passwordMinLength')}</p>
              )}
            </Field>
            <Field label={t('status')}>
              <select className={inputClass()} value={formActive ? 'true' : 'false'} onChange={e => setFormActive(e.target.value === 'true')}>
                <option value="true">{t('active')}</option>
                <option value="false">{t('inactive')}</option>
              </select>
            </Field>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-2">{t('assignRoles')}</p>
            <div className="space-y-2">
              {roles.length === 0 ? (
                <p className="text-sm text-slate-400">{t('noRolesAvailable')}</p>
              ) : roles.map(role => (
                <label key={role.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer">
                  <input type="checkbox" checked={formRoleIds.has(role.id)} onChange={e => toggleFormRole(role.id, e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-800">{role.name}</span>
                    {role.description && <p className="text-xs text-slate-400 truncate">{role.description}</p>}
                  </div>
                  <StatusBadge status={role.is_active ? t('active') : t('inactive')} variant={role.is_active ? 'green' : 'gray'} />
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title={t('delete')} message={`${t('confirmDelete')}`} confirmText={t('delete')} danger />
    </div>
  );
}
