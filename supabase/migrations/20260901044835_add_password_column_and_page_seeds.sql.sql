-- Add password column to user_profiles
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS password text;

-- Seed new RBAC management page entries
INSERT INTO pages (path, label_key, label, section, icon, sort_order) VALUES
  ('/settings/pages', 'pagesManagement', 'Pages Management', 'settings', 'FileText', 31),
  ('/settings/role-pages', 'rolePageAssignment', 'Role-Page Assignment', 'settings', 'Link', 32)
ON CONFLICT (path) DO UPDATE SET
  label_key = EXCLUDED.label_key,
  label = EXCLUDED.label,
  section = EXCLUDED.section,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- Link new pages to Admin role
INSERT INTO role_pages (role_id, page_id)
SELECT r.id, p.id FROM roles r CROSS JOIN pages p
WHERE r.name = 'Admin' AND p.path IN ('/settings/pages', '/settings/role-pages')
ON CONFLICT (role_id, page_id) DO NOTHING;
