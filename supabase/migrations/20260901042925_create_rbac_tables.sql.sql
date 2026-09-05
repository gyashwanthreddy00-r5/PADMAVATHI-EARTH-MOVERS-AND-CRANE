/*
# Role-Based Access Control (RBAC) tables

Creates:
- roles: definable roles (e.g. Admin, Manager, Operator)
- pages: every navigable page in the app
- role_pages: which pages each role can access
- user_roles: which roles each user has

Seeds all current app pages and a default "Admin" role with full access.
Existing admin users are linked to the Admin role.
*/

-- =============================================================
-- 1. roles
-- =============================================================
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roles_select" ON roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "roles_insert" ON roles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "roles_update" ON roles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "roles_delete" ON roles FOR DELETE TO authenticated USING (true);

-- =============================================================
-- 2. pages
-- =============================================================
CREATE TABLE IF NOT EXISTS pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path text NOT NULL UNIQUE,
  label_key text NOT NULL,
  label text NOT NULL,
  section text NOT NULL,
  icon text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pages_select" ON pages FOR SELECT TO authenticated USING (true);
CREATE POLICY "pages_insert" ON pages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "pages_update" ON pages FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "pages_delete" ON pages FOR DELETE TO authenticated USING (true);

-- =============================================================
-- 3. role_pages (which pages each role can access)
-- =============================================================
CREATE TABLE IF NOT EXISTS role_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, page_id)
);

ALTER TABLE role_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "role_pages_select" ON role_pages FOR SELECT TO authenticated USING (true);
CREATE POLICY "role_pages_insert" ON role_pages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "role_pages_update" ON role_pages FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "role_pages_delete" ON role_pages FOR DELETE TO authenticated USING (true);

-- =============================================================
-- 4. user_roles (which roles each user has)
-- =============================================================
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role_id)
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_roles_select" ON user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "user_roles_insert" ON user_roles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "user_roles_update" ON user_roles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "user_roles_delete" ON user_roles FOR DELETE TO authenticated USING (true);

-- =============================================================
-- 5. Seed all app pages
-- =============================================================
INSERT INTO pages (path, label_key, label, section, icon, sort_order) VALUES
  ('/',              'dashboard',              'Dashboard',              'dashboard', 'LayoutDashboard', 1),
  ('/vehicles',      'craneMaster',            'Crane Master',           'masters',   'Truck',           2),
  ('/employees',     'employeeMaster',         'Employee Master',        'masters',   'Users',           3),
  ('/rates',         'rateMaster',             'Rate Master',            'masters',   'Tag',             4),
  ('/customers',     'customers',              'Customers',              'masters',   'Users',           5),
  ('/contracts',     'monthlyContracts',       'Monthly Contracts',      'masters',   'FileText',        6),
  ('/trips',         'tripEntries',            'Trip Entries',           'operations','ClipboardList',   7),
  ('/cash-upi',      'cashUpi',                'Cash / UPI',             'operations','Receipt',         8),
  ('/gst-billing',   'gstCompanyBilling',      'GST / Company Billing',  'operations','FileText',        9),
  ('/diesel',        'dieselEntry',            'Diesel Entry',           'operations','Fuel',            10),
  ('/attendance',    'attendance',             'Attendance',             'operations','CalendarCheck',   11),
  ('/maintenance',   'maintenance',            'Maintenance',            'operations','Wrench',          12),
  ('/emi',           'emiVehicles',            'EMI Vehicles',           'operations','CreditCard',      13),
  ('/invoices',      'customerInvoices',       'Customer Invoices',      'billing',   'FileText',        14),
  ('/settings',      'settings',               'Settings',               'settings',  'Settings',        15),
  ('/settings/maintenance-types', 'maintenanceTypes', 'Maintenance Types', 'settings', 'Wrench',        16),
  ('/settings/roles','rolesAndPermissions',    'Roles & Permissions',    'settings',  'Shield',          17),
  ('/settings/users','userManagement',         'User Management',        'settings',  'Users',           18),
  ('/reports/trips',             'tripReport',           'Trip Report',           'reports', 'BarChart3', 19),
  ('/reports/diesel',            'dieselReport',          'Diesel Report',         'reports', 'BarChart3', 20),
  ('/reports/attendance',        'attendanceReport',      'Attendance Report',     'reports', 'BarChart3', 21),
  ('/reports/maintenance',       'maintenanceReport',     'Maintenance Report',    'reports', 'BarChart3', 22),
  ('/reports/emi',               'emiReport',             'EMI Report',            'reports', 'BarChart3', 23),
  ('/reports/salary',            'salaryStatement',       'Salary Statement',      'reports', 'BarChart3', 24),
  ('/reports/daily-vehicle',     'dailyVehicleReport',    'Daily Vehicle Report',  'reports', 'BarChart3', 25),
  ('/reports/monthly',           'monthlyReport',         'Monthly Report',        'reports', 'BarChart3', 26),
  ('/reports/profit-loss',       'profitLoss',            'Profit & Loss',         'reports', 'TrendingUp',27),
  ('/reports/cash-bills',        'cashBillReport',        'Cash Bill Report',      'reports', 'BarChart3', 28),
  ('/reports/customer-billing',  'customerBillingReport', 'Customer Billing Report','reports','BarChart3', 29),
  ('/reports/vehicle-wise',      'vehicleWiseReport',     'Vehicle-Wise Report',   'reports', 'TrendingUp',30)
ON CONFLICT (path) DO UPDATE SET
  label_key = EXCLUDED.label_key,
  label = EXCLUDED.label,
  section = EXCLUDED.section,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- =============================================================
-- 6. Create default Admin role and link all pages to it
-- =============================================================
INSERT INTO roles (name, description, is_system, is_active)
VALUES ('Admin', 'Full access to all pages', true, true)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, updated_at = now();

-- Link all pages to the Admin role
INSERT INTO role_pages (role_id, page_id)
SELECT r.id, p.id FROM roles r CROSS JOIN pages p
WHERE r.name = 'Admin'
ON CONFLICT (role_id, page_id) DO NOTHING;

-- =============================================================
-- 7. Link existing admin users to the Admin role
-- =============================================================
INSERT INTO user_roles (user_id, role_id)
SELECT up.id, r.id
FROM user_profiles up
CROSS JOIN roles r
WHERE r.name = 'Admin'
  AND up.role = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = up.id AND ur.role_id = r.id
  );

-- =============================================================
-- 8. Triggers for updated_at on new tables
-- =============================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roles','pages','role_pages','user_roles'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END;
$$;
