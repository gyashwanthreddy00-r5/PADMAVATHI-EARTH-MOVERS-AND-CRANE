import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { CompanySettings } from '@/types';

interface SettingsContextType {
  settings: CompanySettings | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const defaultSettings: CompanySettings = {
  id: '',
  company_name: 'PADMAVATHI EARTH MOVERS AND CRANE SERVICES',
  address: 'H.NO 1-5-364/40, SURYA NAGAR, OLD ALWAL, HYDERABAD - 500010',
  phone: null,
  email: 'padmavathicranes@gmail.com',
  gstin: '36ALVPA9612Q2ZA',
  logo_url: null,
  bank_details: null,
  diesel_rate: 95.50,
  invoice_prefix: 'PCS',
  invoice_start_number: 1,
  cgst_percent: 9,
  sgst_percent: 9,
  igst_percent: 18,
  gst_enabled: true,
  language: 'en',
  state: 'Telangana',
  state_code: '36',
  bank_name: 'Axis Bank Ltd',
  bank_account_name: 'PADMAVATHI CRANE SERVICES',
  bank_account_number: '914020039371713',
  bank_branch: null,
  bank_ifsc: 'UTIB0001378',
  authorized_signatory: null,
  signature_path: null,
  stamp_path: null,
  pan: null,
  created_at: '',
  updated_at: '',
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    // company_settings is meant to hold exactly one row, but nothing previously
    // enforced that - a save that raced the initial load (before `id` was known)
    // could INSERT a second row instead of UPDATE-ing the first. With more than one
    // row, an unordered fetch returns whichever one Postgres feels like, which reads
    // as edits randomly "reverting". Ordering by created_at makes the choice
    // deterministic (always the original row) until the DB-level fix below lands.
    const { data } = await supabase.from('company_settings').select('*').order('created_at', { ascending: true }).limit(1).maybeSingle();
    setSettings(data ?? defaultSettings);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <SettingsContext.Provider value={{ settings: settings ?? defaultSettings, loading, refresh }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
