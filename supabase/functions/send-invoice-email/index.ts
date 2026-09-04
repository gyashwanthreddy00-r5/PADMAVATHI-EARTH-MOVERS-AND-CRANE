import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function formatDate(d: string): string {
  const dt = new Date(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function amountInWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const twoDigit = (n: number): string => {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
  };
  const threeDigit = (n: number): string => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    let s = "";
    if (h) s += ones[h] + " Hundred";
    if (r) s += (h ? " " : "") + twoDigit(r);
    return s;
  };
  const inWords = (n: number): string => {
    if (n === 0) return "Zero";
    const lakh = Math.floor(n / 100000);
    const thousand = Math.floor((n % 100000) / 1000);
    const hundred = n % 1000;
    let s = "";
    if (lakh) s += twoDigit(lakh) + " Lakh";
    if (thousand) s += (lakh ? " " : "") + twoDigit(thousand) + " Thousand";
    if (hundred) s += (lakh || thousand ? " " : "") + threeDigit(hundred);
    return s;
  };
  let words = inWords(rupees) + " Rupees";
  if (paise > 0) words += " and " + inWords(paise) + " Paise";
  return words + " Only";
}

function buildInvoiceLineDescription(trip: {
  rate_type: string;
  total_hours: number;
  rental_amount: number;
  trip_date: string;
  place_of_work: string;
  capacity_tons: number | null;
  first_hour_rate: number | null;
  second_hour_rate: number | null;
  weekly_rate_snapshot: number | null;
  daily_rate_snapshot: number | null;
  monthly_rate_snapshot: number | null;
  vehicle: { registration_number: string; type: string; capacity: string | null } | null;
} | null): { description: string; calculation_details: string } {
  if (!trip) return { description: "", calculation_details: "" };
  const vehicle = trip.vehicle;
  const vehicleStr = vehicle ? `${vehicle.registration_number} (${vehicle.type}${vehicle.capacity ? " - " + vehicle.capacity : ""})` : "";
  const capacityStr = trip.capacity_tons ? `${trip.capacity_tons} Ton` : "";
  const placeStr = trip.place_of_work ?? "";
  const dateStr = trip.trip_date ? formatDate(trip.trip_date) : "";
  const rateType = trip.rate_type ?? "";

  let descParts: string[] = [];
  if (vehicleStr) descParts.push(vehicleStr);
  if (capacityStr) descParts.push(capacityStr);
  if (placeStr) descParts.push(`Place: ${placeStr}`);
  if (dateStr) descParts.push(`Date: ${dateStr}`);
  const description = descParts.join(", ");

  let calcParts: string[] = [];
  if (rateType === "Hourly" || rateType === "Couple Hours") {
    const hrs = trip.total_hours ?? 0;
    const firstRate = trip.first_hour_rate ?? 0;
    const secondRate = trip.second_hour_rate ?? 0;
    if (hrs <= 1) {
      calcParts.push(`1st Hour: 1 × ${formatNumber(firstRate)} = ${formatNumber(firstRate)}`);
    } else {
      const remaining = hrs - 1;
      const secondAmount = Math.round(remaining * secondRate * 100) / 100;
      calcParts.push(`1st Hour: 1 × ${formatNumber(firstRate)} = ${formatNumber(firstRate)}`);
      calcParts.push(`2nd+ Hours: ${remaining} × ${formatNumber(secondRate)} = ${formatNumber(secondAmount)}`);
    }
  } else if (rateType === "Daily") {
    const dailyRate = trip.daily_rate_snapshot ?? 0;
    calcParts.push(`Daily Rate: 1 × ${formatNumber(dailyRate)} = ${formatNumber(dailyRate)}`);
  } else if (rateType === "Monthly") {
    const monthlyRate = trip.monthly_rate_snapshot ?? 0;
    calcParts.push(`Monthly Rate: 1 × ${formatNumber(monthlyRate)} = ${formatNumber(monthlyRate)}`);
  } else if (rateType === "Couple Hours" && trip.weekly_rate_snapshot) {
    const coupleRate = trip.weekly_rate_snapshot;
    calcParts.push(`Couple Hours: 1 × ${formatNumber(coupleRate)} = ${formatNumber(coupleRate)}`);
  }
  return { description, calculation_details: calcParts.join("\n") };
}

function generateInvoiceHTML(
  inv: Record<string, unknown>,
  items: Record<string, unknown>[],
  settings: Record<string, unknown> | null,
  invoiceSettings: Record<string, unknown> | null,
): string {
  const compName = (settings?.company_name as string) ?? "";
  const compAddr = ((settings?.address as string) ?? "").split("\n").filter(Boolean);
  const compGstin = (settings?.gstin as string) ?? "";
  const compState = (settings?.state as string) ?? "";
  const compStateCode = (settings?.state_code as string) ?? "";
  const compEmail = (settings?.email as string) ?? "";
  const compPhone = (settings?.phone as string) ?? "";
  const compPan = (settings?.pan as string) ?? "";
  const compLogo = (settings?.logo_url as string) ?? "";
  const compSign = (settings?.signature_url as string) ?? "";
  const compAuth = (settings?.authorized_signatory as string) ?? "";
  const bankName = (settings?.bank_name as string) ?? "";
  const bankAcctName = (settings?.bank_account_name as string) ?? "";
  const bankAcctNo = (settings?.bank_account_number as string) ?? "";
  const bankBranch = (settings?.bank_branch as string) ?? "";
  const bankIfsc = (settings?.bank_ifsc as string) ?? "";

  const customer = inv.customer as Record<string, unknown> | null;
  const cName = (inv.customer_name as string) ?? (customer?.name as string) ?? "-";
  const cAddr = ((inv.customer_address as string) ?? (customer?.address as string) ?? "").split("\n").filter(Boolean);
  const cGstin = (inv.customer_gstin as string) ?? (customer?.gstin as string) ?? "-";
  const cState = (customer?.state as string) ?? "-";
  const cStateCode = (customer?.state_code as string) ?? "-";

  const conName = (inv.consignee_name as string) ?? cName;
  const conAddrRaw = (inv.consignee_address as string) ?? (customer?.address as string) ?? "";
  const conAddr = conAddrRaw.split("\n").filter(Boolean);
  const conGstin = (inv.consignee_gstin as string) ?? cGstin;
  const conState = (inv.consignee_state as string) ?? cState;
  const conStateCode = (inv.consignee_state_code as string) ?? cStateCode;

  const taxable = Number(inv.taxable_amount);
  const cgstAmt = Number(inv.cgst_amount);
  const sgstAmt = Number(inv.sgst_amount);
  const igstAmt = Number(inv.igst_amount);
  const totalTax = cgstAmt + sgstAmt + igstAmt;
  const grand = Number(inv.grand_total);
  const received = Number(inv.amount_received);
  const balance = Math.max(0, grand - received);
  const isIgst = igstAmt > 0;

  const declaration = (inv.declaration as string) ||
    (invoiceSettings?.declaration as string) ||
    "We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.";

  const words = (inv.amount_in_words as string) ?? amountInWords(grand);

  const addrLine = (lines: string[]) => lines.map((l) => `<p style="margin:1px 0">${l}</p>`).join("");

  const itemsRows = items.map((it, i) => {
    const trip = it.trip as Parameters<typeof buildInvoiceLineDescription>[0];
    let displayDesc = it.description as string;
    let displayCalc = it.calculation_details as string | null;
    if (trip) {
      const rebuilt = buildInvoiceLineDescription(trip);
      displayDesc = rebuilt.description;
      displayCalc = rebuilt.calculation_details;
    }
    const calcLines = displayCalc ? displayCalc.split("\n").filter(Boolean) : [];
    const calcHtml = calcLines.length > 0
      ? `<div style="margin-top:3px;font-size:8px;color:#555;line-height:1.5">${calcLines.map((l) => `<div>${l}</div>`).join("")}</div>`
      : "";
    return `
    <tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${displayDesc}${calcHtml}</td>
      <td style="text-align:center">${it.hsn_sac}</td>
      <td style="text-align:center">${formatNumber(Number(it.quantity))}</td>
      <td style="text-align:right">${formatNumber(Number(it.rate))}</td>
      <td style="text-align:center">${it.unit}</td>
      <td style="text-align:right">${formatNumber(Number(it.amount))}</td>
    </tr>`;
  }).join("");

  const metaRow = (label: string, val: string | null | undefined) =>
    val ? `<div style="display:flex"><span style="width:130px;font-weight:600;color:#475569">${label}</span><span>${val}</span></div>` : "";

  const hasBank = bankName || bankAcctName || bankAcctNo || bankIfsc;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Tax Invoice - ${inv.invoice_number}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Arial', 'Helvetica', sans-serif; font-size: 11px; color: #000; margin: 0; padding: 0; }
  .inv { max-width: 800px; margin: 0 auto; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 8px; }
  .hdr-left h1 { font-size: 15px; margin: 0 0 2px 0; text-transform: uppercase; font-weight: 800; letter-spacing: 0.02em; }
  .hdr-left p { margin: 1px 0; font-size: 10px; }
  .ti-box { text-align: center; border: 2px solid #000; padding: 4px 18px; }
  .ti-box h2 { font-size: 13px; margin: 0; letter-spacing: 1px; font-weight: 700; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-top: 6px; border-bottom: 1px solid #000; padding-bottom: 6px; align-items: start; }
  .meta-col { font-size: 10px; }
  .meta-col:first-child { border-right: 1px solid #000; padding-right: 8px; }
  .meta-col:last-child { padding-left: 8px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin: 0; border-bottom: 1px solid #000; align-items: stretch; }
  .party { padding: 6px 8px; font-size: 10px; vertical-align: top; }
  .party:first-child { border-right: 1px solid #000; }
  .party h3 { font-size: 9px; text-transform: uppercase; margin: 0 0 3px 0; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
  .party .nm { font-weight: 700; font-size: 12px; margin: 1px 0; }
  .party p { margin: 1px 0; }
  table.it { width: 100%; border-collapse: collapse; margin: 0; }
  table.it th { background: #000; color: #fff; padding: 5px 4px; font-size: 9px; text-transform: uppercase; border: 1px solid #000; font-weight: 700; }
  table.it td { padding: 4px; border: 1px solid #999; font-size: 10px; }
  table.it td:nth-child(1) { text-align: center; width: 28px; }
  table.it td:nth-child(2) { line-height: 1.4; }
  table.it td:nth-child(3) { text-align: center; width: 55px; }
  table.it td:nth-child(4) { text-align: center; width: 45px; }
  table.it td:nth-child(5) { text-align: right; width: 60px; }
  table.it td:nth-child(6) { text-align: center; width: 35px; }
  table.it td:nth-child(7) { text-align: right; width: 70px; }
  .tax-area { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-top: 0; border-bottom: 1px solid #000; align-items: stretch; }
  .tax-left { padding: 6px 8px; border-right: 1px solid #000; }
  .tax-right { padding: 6px 8px; }
  table.tt { width: 100%; border-collapse: collapse; font-size: 9px; }
  table.tt th { background: #f0f0f0; padding: 3px; border: 1px solid #999; text-align: center; }
  table.tt td { padding: 3px; border: 1px solid #999; text-align: center; }
  table.gt { width: 100%; border-collapse: collapse; }
  table.gt td { padding: 4px 6px; font-size: 10px; border: none; }
  table.gt .lbl { text-align: left; }
  table.gt .val { text-align: right; }
  table.gt .grand { font-weight: 800; font-size: 13px; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 5px 6px; }
  .amt-words { font-size: 10px; font-style: italic; margin: 5px 0; padding: 3px 6px; border: 1px solid #999; background: #f8f8f8; font-weight: 600; }
  .bot { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-top: 8px; align-items: stretch; }
  .bot-left { padding-right: 8px; }
  .bot-right { padding-left: 8px; border-left: 1px solid #000; min-height: 80px; }
  .bot h3 { font-size: 9px; text-transform: uppercase; margin: 0 0 3px 0; }
  .bot p { margin: 1px 0; font-size: 10px; }
  .sign { margin-top: 20px; display: flex; justify-content: space-between; align-items: flex-end; min-height: 90px; }
  .sign-r { text-align: right; }
  .sign-r p { margin: 1px 0; font-size: 10px; }
  .footer { text-align: center; margin-top: 10px; font-size: 8px; color: #888; border-top: 1px solid #ccc; padding-top: 4px; }
  .remarks { font-size: 10px; margin: 4px 0; }
  .pay-line { font-size: 10px; margin: 3px 0; }
</style></head><body>
<div class="inv">
  <div class="hdr">
    <div class="hdr-left">
      ${compLogo ? `<img src="${compLogo}" alt="Logo" style="max-height:45px;max-width:110px;margin-bottom:3px"/>` : ""}
      <h1>${compName}</h1>
      ${addrLine(compAddr)}
      ${compGstin ? `<p><strong>GSTIN/UIN:</strong> ${compGstin}</p>` : ""}
      ${compState ? `<p><strong>State Name:</strong> ${compState}${compStateCode ? `, Code: ${compStateCode}` : ""}</p>` : ""}
      ${compEmail ? `<p><strong>E-Mail:</strong> ${compEmail}</p>` : ""}
      ${compPhone ? `<p><strong>Phone:</strong> ${compPhone}</p>` : ""}
      ${compPan ? `<p><strong>PAN:</strong> ${compPan}</p>` : ""}
    </div>
    <div class="ti-box"><h2>TAX INVOICE</h2></div>
  </div>
  <div class="meta">
    <div class="meta-col">
      ${metaRow("Invoice No.", inv.invoice_number as string)}
      ${metaRow("Dated", formatDate(inv.invoice_date as string))}
      ${metaRow("Reference No. & Date", inv.reference_no as string)}
    </div>
    <div class="meta-col">
      ${metaRow("Motor Vehicle No.", inv.motor_vehicle_numbers as string)}
      ${metaRow("Financial Year", inv.financial_year as string)}
    </div>
  </div>
  <div class="parties">
    <div class="party">
      <h3>Consignee (Ship To)</h3>
      <p class="nm">${conName}</p>
      ${addrLine(conAddr)}
      ${conGstin && conGstin !== "-" ? `<p><strong>GSTIN/UIN:</strong> ${conGstin}</p>` : ""}
    </div>
    <div class="party">
      <h3>Buyer (Bill To)</h3>
      <p class="nm">${cName}</p>
      ${addrLine(cAddr)}
      ${cGstin && cGstin !== "-" ? `<p><strong>GSTIN/UIN:</strong> ${cGstin}</p>` : ""}
    </div>
  </div>
  <table class="it">
    <thead><tr><th>Sl No.</th><th>Description of Services</th><th>HSN/SAC</th><th>Quantity</th><th>Rate</th><th>Per</th><th>Amount</th></tr></thead>
    <tbody>${itemsRows}</tbody>
  </table>
  <div class="tax-area">
    <div class="tax-left">
      <table class="tt">
        <thead><tr><th>HSN/SAC</th><th>Taxable Value</th>${isIgst ? "<th>IGST Rate</th><th>IGST Amt</th>" : "<th>CGST Rate</th><th>CGST Amt</th><th>SGST Rate</th><th>SGST Amt</th>"}<th>Total Tax</th></tr></thead>
        <tbody><tr><td>${invoiceSettings?.hsn_sac ?? "997319"}</td><td>${formatNumber(taxable)}</td>${isIgst ? `<td>${inv.igst_percent}%</td><td>${formatNumber(igstAmt)}</td>` : `<td>${inv.cgst_percent}%</td><td>${formatNumber(cgstAmt)}</td><td>${inv.sgst_percent}%</td><td>${formatNumber(sgstAmt)}</td>`}<td>${formatNumber(totalTax)}</td></tr></tbody>
      </table>
      <div class="amt-words"><strong>Amount Chargeable (in words):</strong><br/>INR ${words}</div>
      ${inv.remarks ? `<div class="remarks"><strong>Remarks:</strong> ${inv.remarks}</div>` : ""}
    </div>
    <div class="tax-right">
      <table class="gt">
        <tr><td class="lbl">Taxable Amount:</td><td class="val">${formatNumber(taxable)}</td></tr>
        ${cgstAmt > 0 ? `<tr><td class="lbl">CGST (${inv.cgst_percent}%):</td><td class="val">${formatNumber(cgstAmt)}</td></tr>` : ""}
        ${sgstAmt > 0 ? `<tr><td class="lbl">SGST (${inv.sgst_percent}%):</td><td class="val">${formatNumber(sgstAmt)}</td></tr>` : ""}
        ${igstAmt > 0 ? `<tr><td class="lbl">IGST (${inv.igst_percent}%):</td><td class="val">${formatNumber(igstAmt)}</td></tr>` : ""}
        <tr class="grand"><td class="lbl">Grand Total:</td><td class="val">&#8377;${formatNumber(grand)}</td></tr>
      </table>
      <div class="pay-line"><strong>Received:</strong> &#8377;${formatNumber(received)}</div>
      <div class="pay-line"><strong>Balance:</strong> &#8377;${formatNumber(balance)}</div>
    </div>
  </div>
  <div class="bot">
    <div class="bot-left"><h3>Declaration</h3><p>${declaration}</p></div>
    <div class="bot-right">
      ${hasBank ? `<h3>Company's Bank Details</h3>${bankAcctName ? `<p><strong>A/c Holder's Name:</strong> ${bankAcctName}</p>` : ""}${bankName ? `<p><strong>Bank Name:</strong> ${bankName}</p>` : ""}${bankAcctNo ? `<p><strong>A/c No.:</strong> ${bankAcctNo}</p>` : ""}${bankBranch || bankIfsc ? `<p><strong>Branch &amp; IFSC:</strong> ${[bankBranch, bankIfsc].filter(Boolean).join(" - ")}</p>` : ""}` : "<p>&nbsp;</p>"}
    </div>
  </div>
  <div class="sign">
    <div></div>
    <div class="sign-r">
      <p>for ${compName}</p>
      ${compSign ? `<img src="${compSign}" alt="Signature" style="max-height:60px;max-width:150px;margin:4px 0"/>` : "<br/><br/><br/>"}
      <p><strong>Authorized Signatory</strong></p>
      ${compAuth ? `<p>${compAuth}</p>` : ""}
    </div>
  </div>
  <div class="footer">This is a Computer Generated Invoice</div>
</div>
</body></html>`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: "Email service is not configured: RESEND_API_KEY is unavailable to the email function." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") as string;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error: unable to access database." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: authentication required to send emails." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: callerUser, error: callerError } = await adminClient.auth.getUser(token);
    if (callerError || !callerUser.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: invalid or expired session." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { invoiceId } = body as { invoiceId: string };
    if (!invoiceId) {
      return new Response(
        JSON.stringify({ error: "Invoice ID is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load invoice with customer
    const { data: invoice, error: invError } = await adminClient
      .from("invoices")
      .select(`*, customer:customers!invoices_customer_id_fkey(id, name, address, email, phone, gstin, state, state_code)`)
      .eq("id", invoiceId)
      .maybeSingle();

    if (invError || !invoice) {
      return new Response(
        JSON.stringify({ error: "Invoice not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load invoice items with trip/vehicle data
    const { data: items, error: itemsError } = await adminClient
      .from("invoice_items")
      .select(`id, sl_no, description, hsn_sac, quantity, rate, unit, amount, batha, calculation_details, trip:trips!invoice_items_trip_entry_id_fkey(id, rate_type, total_hours, rental_amount, trip_date, place_of_work, capacity_tons, first_hour_rate, second_hour_rate, weekly_rate_snapshot, daily_rate_snapshot, monthly_rate_snapshot, vehicle:vehicles!trips_vehicle_id_fkey(id, registration_number, type, capacity))`)
      .eq("invoice_id", invoiceId)
      .order("sl_no", { ascending: true });

    if (itemsError) {
      return new Response(
        JSON.stringify({ error: "Failed to load invoice items." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load all payments for this invoice to calculate accurate received/balance
    const { data: payments } = await adminClient
      .from("invoice_payments")
      .select("amount")
      .eq("invoice_id", invoiceId);

    const totalReceivedFromPayments = (payments ?? []).reduce((sum: number, p: { amount: number }) => sum + Number(p.amount), 0);
    const grandTotal = Number(invoice.grand_total);
    const balanceAmount = Math.max(0, Math.round((grandTotal - totalReceivedFromPayments) * 100) / 100);

    // Use the payment-calculated received amount if it differs from the stored amount
    const totalReceived = Math.round(totalReceivedFromPayments * 100) / 100;

    // Load company settings
    const { data: settings } = await adminClient
      .from("company_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    // Load invoice settings
    const { data: invoiceSettings } = await adminClient
      .from("invoice_settings")
      .select("hsn_sac, declaration")
      .limit(1)
      .maybeSingle();

    // Get customer email from authoritative DB data
    const customerEmail = invoice.customer_email ?? invoice.customer?.email;
    const customerName = invoice.customer_name ?? invoice.customer?.name ?? "Customer";

    if (!customerEmail) {
      return new Response(
        JSON.stringify({ error: "This customer does not have an email address configured. Please add an email in Customer Master." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Update the invoice's amount_received/balance if they were stale
    if (totalReceived !== Number(invoice.amount_received)) {
      const newStatus = balanceAmount <= 0 ? "Paid" : (totalReceived > 0 ? "Partially Paid" : "Generated");
      await adminClient.from("invoices").update({
        amount_received: totalReceived,
        balance_amount: balanceAmount,
        invoice_status: newStatus,
        payment_status: newStatus === "Paid" ? "Paid" : "Pending",
      }).eq("id", invoiceId);
      invoice.amount_received = totalReceived;
      invoice.balance_amount = balanceAmount;
    }

    // Generate invoice HTML
    const invoiceHTML = generateInvoiceHTML(invoice, items ?? [], settings, invoiceSettings);

    // Build email content
    const companyName = settings?.company_name ?? "PADMAVATHI EARTH MOVERS AND CRANE SERVICES";
    const companyAddress = settings?.address ?? "H.NO 1-5-3640/40, SURYA NAGAR, OLD ALWAL, HYDERABAD - 500010";
    const companyGstin = settings?.gstin ?? "36ALVPA9612Q2ZA";

    const subject = `Tax Invoice ${invoice.invoice_number} - ${companyName}`;

    const textBody = `Dear ${customerName},

Please find attached your tax invoice ${invoice.invoice_number} dated ${formatDate(invoice.invoice_date)}.

Invoice Amount: Rs. ${formatNumber(grandTotal)}
Received: Rs. ${formatNumber(totalReceived)}
Balance: Rs. ${formatNumber(balanceAmount)}

Thank you for your business.

Regards,
${companyName}
${companyAddress}
GSTIN: ${companyGstin}`;

    const emailWrapper = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #333; max-width: 600px; margin: 0 auto;">
<p>Dear ${customerName},</p>
<p>Please find attached your tax invoice <strong>${invoice.invoice_number}</strong> dated ${formatDate(invoice.invoice_date)}.</p>
<table style="margin: 16px 0; border-collapse: collapse; width: 100%;">
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Invoice Amount:</td><td style="padding: 4px 8px; border: 1px solid #ddd;">Rs. ${formatNumber(grandTotal)}</td></tr>
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Received:</td><td style="padding: 4px 8px; border: 1px solid #ddd; color: #16a34a;">Rs. ${formatNumber(totalReceived)}</td></tr>
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Balance:</td><td style="padding: 4px 8px; border: 1px solid #ddd; color: #dc2626;">Rs. ${formatNumber(balanceAmount)}</td></tr>
</table>
<p>Thank you for your business.</p>
<p style="margin-top: 24px;">Regards,<br/><strong>${companyName}</strong><br/>${companyAddress}<br/>GSTIN: ${companyGstin}</p>
</div>`;

    // Convert invoice HTML to base64 for attachment (chunked to avoid call stack overflow)
    const htmlBytes = new TextEncoder().encode(invoiceHTML);
    const htmlBase64 = toBase64(htmlBytes);

    // Determine sender email
    const senderEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "onboarding@resend.dev";
    const senderName = companyName;

    const resendBody: Record<string, unknown> = {
      from: `${senderName} <${senderEmail}>`,
      to: customerEmail,
      subject,
      text: textBody,
      html: emailWrapper,
      attachments: [
        {
          filename: `Invoice_${invoice.invoice_number}.html`,
          content: htmlBase64,
        },
      ],
    };

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendBody),
    });

    const resendResult = await resendResponse.json().catch(() => ({}));

    if (!resendResponse.ok) {
      const rawMsg = (resendResult as { message?: string; error?: string })?.message ??
                     (resendResult as { message?: string; error?: string })?.error ??
                     `Resend API returned status ${resendResponse.status}`;
      const normalized = rawMsg.toLowerCase();
      const errMsg = normalized.includes("testing emails") || normalized.includes("verify a domain") || normalized.includes("testing mode")
        ? "Email delivery is still in testing mode. A sending domain must be verified before invoices can be sent to customers."
        : rawMsg;

      await adminClient.from("invoices").update({
        email_status: "FAILED",
        email_error: errMsg,
      }).eq("id", invoiceId);

      return new Response(
        JSON.stringify({ error: errMsg }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Update invoice with sent status
    await adminClient.from("invoices").update({
      email_status: "SENT",
      email_sent_at: new Date().toISOString(),
      email_sent_to: customerEmail,
      email_error: null,
    }).eq("id", invoiceId);

    return new Response(
      JSON.stringify({
        success: true,
        sentTo: customerEmail,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
