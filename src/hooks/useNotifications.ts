import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import type { Employee, Vehicle, EmiRecord } from '@/types';

export type NotificationSeverity = 'expired' | 'due-soon' | 'due-today' | 'overdue';

export interface AppNotification {
  id: string;
  severity: NotificationSeverity;
  category: 'license' | 'eye_test' | 'fitness' | 'emi';
  title: string;
  subtitle: string;
  daysOffset: number;
  navigateTo: string;
}

const SOON_DAYS = 30;

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function useNotifications() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [emiRecords, setEmiRecords] = useState<EmiRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const [eRes, vRes, emiRes] = await Promise.all([
      supabase.from('employees').select('*').eq('active', true),
      supabase.from('vehicles').select('*').eq('active', true),
      supabase.from('emi_records').select('*'),
    ]);
    setEmployees((eRes.data ?? []) as Employee[]);
    setVehicles((vRes.data ?? []) as Vehicle[]);
    setEmiRecords((emiRes.data ?? []) as EmiRecord[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch();
    const channel = supabase
      .channel('notifications-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, fetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, fetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emi_records' }, fetch)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetch]);

  const notifications = useMemo<AppNotification[]>(() => {
    const list: AppNotification[] = [];

    for (const emp of employees) {
      if (emp.license_expiry) {
        const d = daysUntil(emp.license_expiry);
        if (d < 0) {
          list.push({
            id: `lic-exp-${emp.id}`,
            severity: 'expired',
            category: 'license',
            title: `${emp.name} — License Expired`,
            subtitle: `Expired ${Math.abs(d)} day${Math.abs(d) !== 1 ? 's' : ''} ago`,
            daysOffset: d,
            navigateTo: '/employees',
          });
        } else if (d <= SOON_DAYS) {
          list.push({
            id: `lic-soon-${emp.id}`,
            severity: d === 0 ? 'due-today' : 'due-soon',
            category: 'license',
            title: `${emp.name} — License Expiring Soon`,
            subtitle: d === 0 ? 'Expires today' : `${d} day${d !== 1 ? 's' : ''} remaining`,
            daysOffset: d,
            navigateTo: '/employees',
          });
        }
      }

      if (emp.role === 'Driver' && emp.eye_test_expiry_date) {
        const d = daysUntil(emp.eye_test_expiry_date);
        if (d < 0) {
          list.push({
            id: `eye-exp-${emp.id}`,
            severity: 'expired',
            category: 'eye_test',
            title: `${emp.name} — Eye Test Expired`,
            subtitle: `Expired ${Math.abs(d)} day${Math.abs(d) !== 1 ? 's' : ''} ago`,
            daysOffset: d,
            navigateTo: '/employees',
          });
        } else if (d <= SOON_DAYS) {
          list.push({
            id: `eye-soon-${emp.id}`,
            severity: d === 0 ? 'due-today' : 'due-soon',
            category: 'eye_test',
            title: `${emp.name} — Eye Test Expiring Soon`,
            subtitle: d === 0 ? 'Expires today' : `${d} day${d !== 1 ? 's' : ''} remaining`,
            daysOffset: d,
            navigateTo: '/employees',
          });
        }
      }
    }

    for (const v of vehicles) {
      if (v.fitness_expiry_date) {
        const d = daysUntil(v.fitness_expiry_date);
        if (d < 0) {
          list.push({
            id: `fit-exp-${v.id}`,
            severity: 'expired',
            category: 'fitness',
            title: `${v.registration_number} — Fitness Expired`,
            subtitle: `Expired ${Math.abs(d)} day${Math.abs(d) !== 1 ? 's' : ''} ago`,
            daysOffset: d,
            navigateTo: '/vehicles',
          });
        } else if (d <= SOON_DAYS) {
          list.push({
            id: `fit-soon-${v.id}`,
            severity: d === 0 ? 'due-today' : 'due-soon',
            category: 'fitness',
            title: `${v.registration_number} — Fitness Expiring Soon`,
            subtitle: d === 0 ? 'Expires today' : `${d} day${d !== 1 ? 's' : ''} remaining`,
            daysOffset: d,
            navigateTo: '/vehicles',
          });
        }
      }
    }

    const vehicleMap = new Map(vehicles.map(v => [v.id, v]));
    for (const emi of emiRecords) {
      if (emi.status === 'Paid') continue;
      const vehicle = emi.vehicle_id ? vehicleMap.get(emi.vehicle_id) : null;
      const vehicleLabel = vehicle?.registration_number ?? 'Unknown';
      const amount = formatCurrency(emi.emi_amount);
      const d = daysUntil(emi.due_date);
      if (d < 0) {
        list.push({
          id: `emi-ovd-${emi.id}`,
          severity: 'overdue',
          category: 'emi',
          title: `EMI OVERDUE — ${vehicleLabel}`,
          subtitle: `${amount} — ${Math.abs(d)} day${Math.abs(d) !== 1 ? 's' : ''} overdue`,
          daysOffset: d,
          navigateTo: '/emi',
        });
      } else if (d === 0) {
        list.push({
          id: `emi-due-today-${emi.id}`,
          severity: 'due-today',
          category: 'emi',
          title: `EMI DUE TODAY — ${vehicleLabel}`,
          subtitle: `${amount} — Due Today`,
          daysOffset: d,
          navigateTo: '/emi',
        });
      } else if (d <= 5) {
        list.push({
          id: `emi-due-soon-${emi.id}`,
          severity: 'due-soon',
          category: 'emi',
          title: `EMI Due Soon — ${vehicleLabel}`,
          subtitle: `${amount} — ${d} day${d !== 1 ? 's' : ''} remaining`,
          daysOffset: d,
          navigateTo: '/emi',
        });
      }
    }

    list.sort((a, b) => a.daysOffset - b.daysOffset);
    return list;
  }, [employees, vehicles, emiRecords]);

  const counts = useMemo(() => {
    const expired = notifications.filter(n => n.severity === 'expired' || n.severity === 'overdue').length;
    const dueSoon = notifications.filter(n => n.severity === 'due-soon').length;
    const dueToday = notifications.filter(n => n.severity === 'due-today').length;
    return { total: notifications.length, expired, dueSoon, dueToday };
  }, [notifications]);

  return { notifications, counts, loading };
}
