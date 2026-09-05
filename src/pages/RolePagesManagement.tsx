import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { LoadingSpinner, EmptyState } from '@/components/ui/common';
import { Link } from 'lucide-react';
import { classNames } from '@/lib/utils';
import type { Role, PageEntry } from '@/types';

export default function RolePagesManagement() {
  const { t } = useLang();
  const { show } = useToast();
  const [roles, setRoles] = useState<Role[]>([]);
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [rolePageMap, setRolePageMap] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [rolesRes, pagesRes, rpRes] = await Promise.all([
      supabase.from('roles').select('*').order('is_system', { ascending: false }).order('name'),
      supabase.from('pages').select('*').order('sort_order'),
      supabase.from('role_pages').select('role_id, page_id'),
    ]);
    if (rolesRes.error || pagesRes.error || rpRes.error) { show(t('noRolesAvailable'), 'error'); setLoading(false); return; }
    const roleList = (rolesRes.data ?? []) as Role[];
    const pageList = (pagesRes.data ?? []) as PageEntry[];
    const rpList = (rpRes.data ?? []) as Array<{ role_id: string; page_id: string }>;
    const map: Record<string, Set<string>> = {};
    for (const r of roleList) map[r.id] = new Set();
    for (const rp of rpList) { if (map[rp.role_id]) map[rp.role_id].add(rp.page_id); }
    setRoles(roleList); setPages(pageList); setRolePageMap(map);
    if (roleList.length > 0 && !selectedRoleId) setSelectedRoleId(roleList[0].id);
    setLoading(false);
  }, [show, selectedRoleId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const togglePage = async (roleId: string, pageId: string, checked: boolean) => {
    if (checked) {
      const { error } = await supabase.from('role_pages').insert({ role_id: roleId, page_id: pageId });
      if (error) { show(t('saveError'), 'error'); return; }
      setRolePageMap(prev => ({ ...prev, [roleId]: new Set([...prev[roleId], pageId]) }));
    } else {
      const { error } = await supabase.from('role_pages').delete().eq('role_id', roleId).eq('page_id', pageId);
      if (error) { show(t('saveError'), 'error'); return; }
      setRolePageMap(prev => { const next = new Set(prev[roleId]); next.delete(pageId); return { ...prev, [roleId]: next }; });
    }
  };

  const toggleSectionAll = async (roleId: string, section: string, checked: boolean) => {
    const sectionPages = pages.filter(p => p.section === section);
    const pageIds = sectionPages.map(p => p.id);
    if (checked) {
      const toAdd = pageIds.filter(pid => !rolePageMap[roleId].has(pid));
      if (toAdd.length === 0) return;
      const { error } = await supabase.from('role_pages').insert(toAdd.map(pid => ({ role_id: roleId, page_id: pid })));
      if (error) { show(t('saveError'), 'error'); return; }
      setRolePageMap(prev => ({ ...prev, [roleId]: new Set([...prev[roleId], ...toAdd]) }));
    } else {
      const toRemove = pageIds.filter(pid => rolePageMap[roleId].has(pid));
      if (toRemove.length === 0) return;
      const { error } = await supabase.from('role_pages').delete().eq('role_id', roleId).in('page_id', toRemove);
      if (error) { show(t('saveError'), 'error'); return; }
      setRolePageMap(prev => { const next = new Set(prev[roleId]); toRemove.forEach(pid => next.delete(pid)); return { ...prev, [roleId]: next }; });
    }
  };

  const sections = [...new Set(pages.map(p => p.section))];
  const sectionLabel = (s: string): string => {
    const labels: Record<string, string> = { dashboard: 'Dashboard', masters: 'Masters', operations: 'Operations', billing: 'Billing', reports: 'Reports', settings: 'Settings' };
    return labels[s] ?? s;
  };

  if (loading) return <LoadingSpinner />;

  const currentRole = roles.find(r => r.id === selectedRoleId);
  const selectedPages = selectedRoleId ? (rolePageMap[selectedRoleId] ?? new Set<string>()) : new Set<string>();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800">{t('rolePageAssignment')}</h2>
        <p className="text-sm text-slate-500">{t('assignPagesToRole')}</p>
      </div>

      {roles.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm"><div className="p-8"><EmptyState message={t('noRolesAvailable')} icon={Link} /></div></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100"><p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t('rolesAndPermissions')}</p></div>
            <div className="divide-y divide-slate-100">
              {roles.map(role => (
                <button key={role.id} onClick={() => setSelectedRoleId(role.id)}
                  className={classNames('w-full flex items-center gap-3 px-4 py-3 text-left transition-colors', selectedRoleId === role.id ? 'bg-blue-50' : 'hover:bg-slate-50')}>
                  <Link className={classNames('w-4 h-4 flex-shrink-0', selectedRoleId === role.id ? 'text-blue-600' : 'text-slate-400')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{role.name}</p>
                    {role.description && <p className="text-xs text-slate-400 truncate">{role.description}</p>}
                  </div>
                  <span className="text-xs text-slate-400 tabular-nums">{rolePageMap[role.id]?.size ?? 0}/{pages.length}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{currentRole?.name ?? t('selectRole')}</p>
              <span className="text-xs text-slate-400">{selectedPages.size}/{pages.length} {t('pagesAssigned')}</span>
            </div>
            <div className="p-4 max-h-[60vh] overflow-y-auto">
              <div className="space-y-4">
                {sections.map(section => {
                  const sectionPages = pages.filter(p => p.section === section);
                  if (sectionPages.length === 0) return null;
                  const allChecked = sectionPages.every(p => selectedPages.has(p.id));
                  const someChecked = sectionPages.some(p => selectedPages.has(p.id));
                  return (
                    <div key={section}>
                      <label className="flex items-center gap-2 mb-2">
                        <input type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = !allChecked && someChecked; }}
                          onChange={e => toggleSectionAll(selectedRoleId!, section, e.target.checked)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" disabled={!selectedRoleId || currentRole?.is_system} />
                        <span className="text-sm font-bold text-slate-700 uppercase tracking-wide">{sectionLabel(section)}</span>
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 ml-6">
                        {sectionPages.map(page => {
                          const checked = selectedPages.has(page.id);
                          return (
                            <label key={page.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 transition-colors cursor-pointer">
                              <input type="checkbox" checked={checked} onChange={e => togglePage(selectedRoleId!, page.id, e.target.checked)}
                                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" disabled={!selectedRoleId || currentRole?.is_system} />
                              <span className="text-xs text-slate-600 truncate">{page.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
