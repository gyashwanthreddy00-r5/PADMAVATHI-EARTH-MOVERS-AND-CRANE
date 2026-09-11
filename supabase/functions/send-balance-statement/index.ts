import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { formatDate, formatNumber } from "../_shared/invoice-pdf.ts";
import { renderPdfViaBrowserless } from "../_shared/browserless.ts";

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
    // `pdfHtmls` is new and OPTIONAL — existing callers (e.g. Settlement Report's own
    // Email Statement action) that never send it keep getting the exact same inline-table
    // email with no attachment as before. Only a caller that explicitly sends a non-empty
    // pdfHtmls array (Customer Statements' Email Balance Statement) gets the new
    // "statement is attached as a PDF" subject/body below.
    const { customerId, invoiceIds, pdfHtmls, statementLabel } = body as {
      customerId: string;
      invoiceIds: string[];
      pdfHtmls?: { filename: string; html: string }[];
      // e.g. "Balance Statement" or "Full Statement" — only used for the subject/body
      // text when attachments are present; defaults to "Balance Statement" if omitted.
      statementLabel?: string;
    };
    if (!customerId || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return new Response(
        JSON.stringify({ error: "customerId and a non-empty invoiceIds list are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Every attachment (the statement summary and each invoice alike) is rendered here via
    // Browserless (real Chromium, the same path the single-invoice Email action uses) from
    // the print-view HTML the client sends - never pre-built client-side - so each PDF is
    // pixel-identical to its Print view. A failure on one document is logged and skipped
    // rather than failing the whole email.
    const allAttachments: { filename: string; content: string }[] = [];
    for (const entry of pdfHtmls ?? []) {
      try {
        const content = await renderPdfViaBrowserless(entry.html);
        allAttachments.push({ filename: entry.filename, content });
      } catch (renderErr) {
        console.error(`Browserless render failed for ${entry.filename}:`, renderErr);
      }
    }

    const hasAttachments = allAttachments.length > 0;

    const { data: customer, error: custError } = await adminClient
      .from("customers")
      .select("id, name, email, phone, gstin, address")
      .eq("id", customerId)
      .maybeSingle();

    if (custError || !customer) {
      return new Response(
        JSON.stringify({ error: "Customer not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!customer.email) {
      return new Response(
        JSON.stringify({ error: "This customer does not have an email address configured. Please add an email in Customer Master." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: invoices, error: invError } = await adminClient
      .from("invoices")
      .select("id, invoice_number, invoice_date, grand_total, discount_enabled, final_payable_amount, is_cancelled")
      .in("id", invoiceIds)
      .eq("customer_id", customerId);

    if (invError || !invoices || invoices.length === 0) {
      return new Response(
        JSON.stringify({ error: "No matching invoices found for this customer." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const validInvoices = invoices.filter((inv) => !inv.is_cancelled);

    const { data: payments } = await adminClient
      .from("invoice_payments")
      .select("invoice_id, amount")
      .in("invoice_id", validInvoices.map((inv) => inv.id));

    const paidByInvoice = new Map<string, number>();
    for (const p of payments ?? []) {
      paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount));
    }

    const rows = validInvoices
      .map((inv) => {
        const payable = inv.discount_enabled ? Number(inv.final_payable_amount ?? inv.grand_total) : Number(inv.grand_total);
        const received = Math.round((paidByInvoice.get(inv.id) ?? 0) * 100) / 100;
        const balance = Math.max(0, Math.round((payable - received) * 100) / 100);
        const status = received <= 0 ? "Pending" : balance <= 0 ? "Paid" : "Partially Paid";
        return { invoice_number: inv.invoice_number, invoice_date: inv.invoice_date, payable, received, balance, status };
      })
      .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date));

    const totalInvoiced = Math.round(rows.reduce((s, r) => s + r.payable, 0) * 100) / 100;
    const totalReceived = Math.round(rows.reduce((s, r) => s + r.received, 0) * 100) / 100;
    const totalOutstanding = Math.round(rows.reduce((s, r) => s + r.balance, 0) * 100) / 100;

    const { data: settings } = await adminClient
      .from("company_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    const companyName = settings?.company_name ?? "PADMAVATHI EARTH MOVERS AND CRANE SERVICES";
    const companyAddress = settings?.address ?? "";
    const companyPhone = settings?.phone ?? "";
    const companyEmail = settings?.email ?? "";

    // Unchanged default (no attachments passed, e.g. Settlement Report's own Email
    // Statement action) keeps its original subject/body exactly as before.
    const label = statementLabel || "Balance Statement";
    const subject = hasAttachments
      ? `${label} - ${customer.name}`
      : `Account Statement – ${companyName} – Outstanding Balance`;

    const tableRowsHtml = rows.map((r, idx) => `<tr>
<td style="padding:4px 8px;border:1px solid #ddd;text-align:center;">${idx + 1}</td>
<td style="padding:4px 8px;border:1px solid #ddd;">${formatDate(r.invoice_date)}</td>
<td style="padding:4px 8px;border:1px solid #ddd;">${r.invoice_number ?? "-"}</td>
<td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">Rs. ${formatNumber(r.payable)}</td>
<td style="padding:4px 8px;border:1px solid #ddd;text-align:right;color:#16a34a;">Rs. ${formatNumber(r.received)}</td>
<td style="padding:4px 8px;border:1px solid #ddd;text-align:right;color:#dc2626;">Rs. ${formatNumber(r.balance)}</td>
<td style="padding:4px 8px;border:1px solid #ddd;text-align:center;">${r.status.toUpperCase()}</td>
</tr>`).join("");

    const textRows = rows.map((r, idx) =>
      `${idx + 1}. ${formatDate(r.invoice_date)}  ${r.invoice_number}  Total: Rs.${formatNumber(r.payable)}  Received: Rs.${formatNumber(r.received)}  Balance: Rs.${formatNumber(r.balance)}  [${r.status}]`
    ).join("\n");

    const textBody = `Dear ${customer.name},

Please find below the latest account statement for your account with ${companyName}.

Account Summary
Total Invoiced: Rs. ${formatNumber(totalInvoiced)}
Total Received: Rs. ${formatNumber(totalReceived)}
Total Outstanding: Rs. ${formatNumber(totalOutstanding)}

${textRows}

Kindly arrange payment for the outstanding balance at your earliest convenience. If payment has already been made, please share the payment details with us for reconciliation.

Regards,
${companyName}
${companyPhone}
${companyEmail}`;

    const emailWrapper = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #333; max-width: 700px; margin: 0 auto;">
<p>Dear ${customer.name},</p>
<p>Please find below the latest account statement for your account with ${companyName}.</p>
<p style="font-weight:600; margin-bottom:4px;">Account Summary</p>
<table style="margin: 4px 0 12px; border-collapse: collapse; width: 100%;">
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Total Invoiced:</td><td style="padding: 4px 8px; border: 1px solid #ddd;">Rs. ${formatNumber(totalInvoiced)}</td></tr>
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Total Received:</td><td style="padding: 4px 8px; border: 1px solid #ddd; color: #16a34a;">Rs. ${formatNumber(totalReceived)}</td></tr>
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Total Outstanding:</td><td style="padding: 4px 8px; border: 1px solid #ddd; color: #dc2626; font-weight:600;">Rs. ${formatNumber(totalOutstanding)}</td></tr>
</table>
<table style="margin: 16px 0; border-collapse: collapse; width: 100%; font-size: 13px;">
<thead><tr style="background:#f1f5f9;">
<th style="padding:4px 8px;border:1px solid #ddd;">SL.NO</th>
<th style="padding:4px 8px;border:1px solid #ddd;">DATE</th>
<th style="padding:4px 8px;border:1px solid #ddd;">INVOICE NO</th>
<th style="padding:4px 8px;border:1px solid #ddd;">TOTAL</th>
<th style="padding:4px 8px;border:1px solid #ddd;">RECEIVED</th>
<th style="padding:4px 8px;border:1px solid #ddd;">BALANCE</th>
<th style="padding:4px 8px;border:1px solid #ddd;">STATUS</th>
</tr></thead>
<tbody>${tableRowsHtml}</tbody>
</table>
<p style="margin-top: 16px;">Kindly arrange payment for the outstanding balance at your earliest convenience. If payment has already been made, please share the payment details with us for reconciliation.</p>
<p style="margin-top: 24px;">Regards,<br/><strong>${companyName}</strong><br/>${companyPhone}<br/>${companyEmail}</p>
</div>`;

    // When a PDF/attachments are sent along (Customer Statements' Email Balance
    // Statement), the email body is the short "please find attached" note from the
    // spec — the statement itself is in the PDF, not retyped as an inline HTML table.
    const attachedTextBody = `Dear ${customer.name},

Please find attached your ${label.toLowerCase()} for the selected period.

Regards,
${companyName}`;
    const attachedEmailWrapper = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #333; max-width: 700px; margin: 0 auto;">
<p>Dear ${customer.name},</p>
<p>Please find attached your ${label.toLowerCase()} for the selected period.</p>
<p style="margin-top: 24px;">Regards,<br/><strong>${companyName}</strong></p>
</div>`;

    const senderEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "invoices@coreone-demo.in";
    const senderName = "Core1ERP";

    const resendBody: Record<string, unknown> = {
      from: `${senderName} <${senderEmail}>`,
      to: customer.email,
      subject,
      text: hasAttachments ? attachedTextBody : textBody,
      html: hasAttachments ? attachedEmailWrapper : emailWrapper,
    };
    if (hasAttachments) {
      resendBody.attachments = allAttachments.map((a) => ({ filename: a.filename, content: a.content }));
    }

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
      const rawMsg = resendResult.message ?? resendResult.error ?? `Resend API returned status ${resendResponse.status}`;
      const normalized = rawMsg.toLowerCase();
      const errMsg = normalized.includes("testing emails") || normalized.includes("verify a domain") || normalized.includes("testing mode")
        ? "Email delivery is still in testing mode. A sending domain must be verified before statements can be sent to customers."
        : rawMsg;
      return new Response(
        JSON.stringify({ error: errMsg }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, sentTo: customer.email }),
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
