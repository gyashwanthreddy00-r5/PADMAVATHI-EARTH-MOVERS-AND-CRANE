import type { Vehicle, RateMaster, RateType } from '@/types';

export function normalizeCapacity(cap: string | null | undefined): string {
  if (!cap) return '';
  return cap.trim().replace(/[^0-9.]/g, '');
}

/**
 * Find the applicable Rate Master record for a given vehicle and trip/bill date.
 *
 * Matching rules:
 * - For JCB vehicles: match rate_master rows with vehicle_type = 'JCB'
 * - For Crane vehicles: match by capacity_tons, only considering
 *   rate_master rows with vehicle_type = 'Crane'
 * - Only consider rows with status 'Active' or 'Closed'
 * - effective_from <= tripDate and (effective_to is null OR effective_to >= tripDate)
 * - Return the latest-effective record (sorted by effective_from DESC)
 */
export function findRateMasterForVehicle(
  vehicle: Vehicle | undefined,
  rateMasterRates: RateMaster[],
  tripDate: string,
): RateMaster | null {
  if (!vehicle || rateMasterRates.length === 0) return null;

  const isEffective = (rm: RateMaster) =>
    (rm.status === 'Active' || rm.status === 'Closed') &&
    rm.effective_from <= tripDate &&
    (!rm.effective_to || rm.effective_to >= tripDate);

  if (vehicle.type === 'JCB') {
    const jcbRates = rateMasterRates
      .filter(rm => rm.vehicle_type === 'JCB' && isEffective(rm))
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    return jcbRates[0] ?? null;
  }

  // Crane vehicles: match by capacity_tons only
  const capacity = vehicle.capacity?.trim() ?? '';
  const capNum = normalizeCapacity(capacity);

  const matching = rateMasterRates
    .filter(rm => {
      if (!isEffective(rm)) return false;
      if (rm.vehicle_type !== 'Crane') return false;
      const rmCap = rm.capacity_tons?.trim() ?? '';
      if (rmCap === capacity) return true;
      if (capNum && rmCap === capNum) return true;
      return false;
    })
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));

  return matching[0] ?? null;
}

/**
 * Resolve the rate type to use for calculation.
 *
 * The user's selected rate type always takes precedence.
 * If the rate master's rate_type is 'Both', the user's selection governs.
 * If the rate master's rate_type is a specific type, we still honor the user's
 * selection so billing matches what the operator chose on the form.
 */
export function resolveEffectiveRateType(
  selectedRateType: RateType,
  rateMaster: RateMaster | null,
): RateType {
  if (!rateMaster) return selectedRateType;
  return selectedRateType;
}
