// Resolves a customer's saved CC email addresses (`customers.cc_emails`, one
// comma/semicolon-separated string) into a clean recipient list — validated,
// deduped, and with the primary "to" address excluded so nobody is billed
// twice. Shared by every edge function that emails a customer (invoice,
// balance/full statement, reminders) so CC behaves identically everywhere.
export function resolveCustomerCcList(
  rawCcEmails: string | null | undefined,
  primaryEmail: string,
): { ccList: string[]; invalidCc: string[] } {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const rawList = (rawCcEmails ?? "")
    .split(/[,;]/)
    .map((e) => e.trim())
    .filter(Boolean);
  const invalidCc = rawList.filter((e) => !emailPattern.test(e));
  const seen = new Set<string>([primaryEmail.toLowerCase()]);
  const ccList: string[] = [];
  for (const e of rawList) {
    if (!emailPattern.test(e)) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ccList.push(e);
  }
  return { ccList, invalidCc };
}
