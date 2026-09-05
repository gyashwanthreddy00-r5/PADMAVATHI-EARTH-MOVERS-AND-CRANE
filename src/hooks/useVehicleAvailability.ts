import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Vehicle, MonthlyContract } from '@/types';

export type VehicleAvailabilityStatus = 'Available' | 'Working' | 'Maintenance' | 'Inactive' | 'Under Monthly Contract';

export interface VehicleAvailability extends Vehicle {
  availabilityStatus: VehicleAvailabilityStatus;
  activeContract: MonthlyContract | null;
}

function isContractActive(c: MonthlyContract): boolean {
  if (c.status !== 'Active') return false;
  const today = new Date().toISOString().split('T')[0];
  if (c.start_date > today) return false;
  if (c.end_date && c.end_date < today) return false;
  return true;
}

export function useVehicleAvailability() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [contracts, setContracts] = useState<MonthlyContract[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    const [vRes, cRes] = await Promise.all([
      supabase.from('vehicles').select('*').order('registration_number'),
      supabase.from('monthly_contracts').select('*'),
    ]);
    setVehicles((vRes.data ?? []) as Vehicle[]);
    setContracts((cRes.data ?? []) as MonthlyContract[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const channel = supabase
      .channel('vehicle-availability')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_contracts' }, fetchAll)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchAll]);

  const bookedVehicleIds = new Set<string>();
  contracts.forEach(c => {
    if (isContractActive(c) && c.vehicle_id) bookedVehicleIds.add(c.vehicle_id);
  });

  const vehiclesWithAvailability: VehicleAvailability[] = vehicles.map(v => {
    const activeContract = contracts.find(c => c.vehicle_id === v.id && isContractActive(c)) ?? null;
    let availabilityStatus: VehicleAvailabilityStatus;
    if (activeContract) {
      availabilityStatus = 'Under Monthly Contract';
    } else if (!v.active) {
      availabilityStatus = 'Inactive';
    } else {
      availabilityStatus = v.status;
    }
    return { ...v, availabilityStatus, activeContract };
  });

  const isVehicleBooked = (vehicleId: string): boolean => bookedVehicleIds.has(vehicleId);

  const getActiveContractForVehicle = (vehicleId: string): MonthlyContract | null =>
    contracts.find(c => c.vehicle_id === vehicleId && isContractActive(c)) ?? null;

  return {
    vehicles: vehiclesWithAvailability,
    rawVehicles: vehicles,
    contracts,
    bookedVehicleIds,
    isVehicleBooked,
    getActiveContractForVehicle,
    loading,
    refresh: fetchAll,
  };
}
