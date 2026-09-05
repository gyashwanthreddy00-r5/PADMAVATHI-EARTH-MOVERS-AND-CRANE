import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { generateInvoicePdfBytes, toBase64, formatDate, formatNumber } from "../_shared/invoice-pdf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") as string;
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

    // Use anon-key client to verify the user's JWT — service role bypasses auth
    const authClient = createClient(supabaseUrl, anonKey ?? serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: callerUser, error: callerError } = await authClient.auth.getUser(token);
    if (callerError || !callerUser.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: invalid or expired session." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { invoiceId, pdfBase64 } = body as { invoiceId: string; pdfBase64?: string };
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

    // Get customer email — prefer the live customer record over the stale invoice copy
    const customerEmail = invoice.customer?.email ?? invoice.customer_email;
    const customerName = invoice.customer?.name ?? invoice.customer_name ?? "Customer";

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

    // Use browser-generated PDF if provided, otherwise generate server-side
    let pdfBase64Str: string;
    if (pdfBase64) {
      pdfBase64Str = pdfBase64;
    } else {
      const pdfBytes = await generateInvoicePdfBytes(invoice, items ?? [], settings, invoiceSettings, totalReceived, balanceAmount);
      pdfBase64Str = toBase64(pdfBytes);
    }

    // Determine sender email
    const senderEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "invoices@coreone-demo.in";
    const senderName = "Core1ERP";

    const resendBody: Record<string, unknown> = {
      from: `${senderName} <${senderEmail}>`,
      to: customerEmail,
      subject,
      text: textBody,
      html: emailWrapper,
      attachments: [
        {
          filename: `Invoice_${invoice.invoice_number}.pdf`,
          content: pdfBase64Str,
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

    const resendResult = await resendResponse.json().catch(() => ({})) as { id?: string; message?: string; error?: string };

    if (!resendResponse.ok || !resendResult.id) {
      const rawMsg = resendResult.message ??
                     resendResult.error ??
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


