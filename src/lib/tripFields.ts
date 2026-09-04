export interface TripFieldDef {
  key: string;
  label: string;
  getValue: (trip: Record<string, unknown>) => string | number | null;
}

function vehicleTypeLabelFromTrip(t: Record<string, unknown>): string {
  const vehicle = t.vehicle as { type?: string; capacity?: string } | undefined;
  const type = vehicle?.type;
  const capacity = (t.capacity_tons as string | number | null) || vehicle?.capacity;
  if (type === 'JCB') return 'JCB';
  if (type === 'Crane') {
    if (capacity != null) {
      const num = String(capacity).replace(/[^0-9.]/g, '');
      if (num) return `${num} Tons`;
    }
    return 'Crane';
  }
  return type ?? '-';
}

export const TRIP_FIELDS: TripFieldDef[] = [
  { key: 'trip_number', label: 'Trip No.', getValue: t => t.trip_number as string ?? '-' },
  { key: 'trip_date', label: 'Date', getValue: t => t.trip_date as string ?? '-' },
  { key: 'vehicle', label: 'Vehicle', getValue: t => (t.vehicle as { registration_number?: string })?.registration_number ?? '-' },
  { key: 'vehicle_type', label: 'Vehicle Type', getValue: vehicleTypeLabelFromTrip },
  { key: 'customer', label: 'Customer', getValue: t => (t.customer as { name?: string })?.name ?? '-' },
  { key: 'driver', label: 'Driver', getValue: t => (t.driver as { name?: string })?.name ?? '-' },
  { key: 'place_of_work', label: 'Place of Work', getValue: t => t.place_of_work as string ?? '-' },
  { key: 'in_time', label: 'In-Time', getValue: t => t.in_time as string ?? '-' },
  { key: 'out_time', label: 'Out-Time', getValue: t => t.out_time as string ?? '-' },
  { key: 'opening_hour_meter', label: 'Opening Meter', getValue: t => t.opening_hour_meter as number ?? '-' },
  { key: 'closing_hour_meter', label: 'Closing Meter', getValue: t => t.closing_hour_meter as number ?? '-' },
  { key: 'total_hours', label: 'Total Hours', getValue: t => t.total_hours as number ?? '-' },
  { key: 'rate_type', label: 'Rate Type', getValue: t => t.rate_type as string ?? '-' },
  { key: 'rental_amount', label: 'Rental Amount', getValue: t => t.rental_amount as number ?? '-' },
  { key: 'batha', label: 'Batha', getValue: t => t.batha as number ?? '-' },
  { key: 'total_amount', label: 'Total Amount', getValue: t => t.total_amount as number ?? '-' },
  { key: 'bill_status', label: 'Payment Status', getValue: t => t.bill_status as string ?? '-' },
  { key: 'remarks', label: 'Remarks', getValue: t => t.remarks as string ?? '-' },
];

const STORAGE_KEY = 'padmavathi_trip_field_selection';
const DEFAULT_FIELDS = [
  'trip_number', 'trip_date', 'vehicle', 'vehicle_type', 'customer', 'driver', 'place_of_work',
  'total_hours', 'rental_amount', 'batha', 'total_amount', 'bill_status',
];

export function getSelectedFields(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return DEFAULT_FIELDS;
}

export function setSelectedFields(fields: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fields));
}

export function getSelectedFieldDefs(): TripFieldDef[] {
  const selected = getSelectedFields();
  return TRIP_FIELDS.filter(f => selected.includes(f.key));
}
