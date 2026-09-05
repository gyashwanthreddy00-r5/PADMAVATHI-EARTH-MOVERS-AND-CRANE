// process-reminders: sends invoice reminder emails with PDF attachment (v2)
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { generateInvoicePdfBytes, toBase64 as sharedToBase64, formatDate, formatNumber, buildInvoiceLineDescription as sharedBuildDesc } from "../_shared/invoice-pdf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function replaceTemplateVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

interface ReminderRow {
  id: string;
  invoice_id: string;
  customer_id: string | null;
  reminder_stage: number;
  scheduled_at: string;
  sent_at: string | null;
  status: string;
  recipient_email: string | null;
  subject: string | null;
  error_message: string | null;
}

async function sendReminderEmail(
  adminClient: ReturnType<typeof createClient>,
  reminder: ReminderRow,
  reminderSettings: Record<string, unknown>,
  pdfBase64Override?: string,
): Promise<{ success: boolean; error?: string }> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    return { success: false, error: "RESEND_API_KEY is not available to the email function." };
  }

  // Load invoice with customer
  const { data: invoice, error: invError } = await adminClient
    .from("invoices")
    .select(`*, customer:customers!invoices_customer_id_fkey(id, name, address, email, phone, gstin, state, state_code)`)
    .eq("id", reminder.invoice_id)
    .maybeSingle();

  if (invError || !invoice) {
    return { success: false, error: "Invoice not found." };
  }

  // Load all payments to calculate accurate balance
  const { data: payments } = await adminClient
    .from("invoice_payments")
    .select("amount")
    .eq("invoice_id", reminder.invoice_id);

  const totalReceived = (payments ?? []).reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0);
  const grandTotal = Number(invoice.grand_total);
  const balanceAmount = Math.max(0, Math.round((grandTotal - totalReceived) * 100) / 100);

  // If fully paid, cancel this and all future reminders
  if (balanceAmount <= 0) {
    await adminClient.from("invoice_reminders").update({
      status: "cancelled",
      error_message: "Invoice fully paid — reminder cancelled.",
    }).eq("invoice_id", reminder.invoice_id).in("status", ["pending"]);

    // Also update invoice status
    await adminClient.from("invoices").update({
      amount_received: totalReceived,
      balance_amount: 0,
      invoice_status: "Paid",
      payment_status: "Paid",
    }).eq("id", reminder.invoice_id);

    return { success: false, error: "Invoice fully paid — reminder cancelled." };
  }

  // Get customer email — prefer the live customer record over the stale invoice copy
  const customerEmail = invoice.customer?.email ?? invoice.customer_email;
  const customerName = invoice.customer?.name ?? invoice.customer_name ?? "Customer";

  if (!customerEmail) {
    await adminClient.from("invoice_reminders").update({
      status: "missing_email",
      error_message: "Customer email address is missing.",
    }).eq("id", reminder.id);
    return { success: false, error: "Customer email address is missing." };
  }

  // Load invoice items
  const { data: items } = await adminClient
    .from("invoice_items")
    .select(`id, sl_no, description, hsn_sac, quantity, rate, unit, amount, batha, calculation_details, trip:trips!invoice_items_trip_entry_id_fkey(id, rate_type, total_hours, rental_amount, trip_date, place_of_work, capacity_tons, first_hour_rate, second_hour_rate, weekly_rate_snapshot, daily_rate_snapshot, monthly_rate_snapshot, vehicle:vehicles!trips_vehicle_id_fkey(id, registration_number, type, capacity))`)
    .eq("invoice_id", reminder.invoice_id)
    .order("sl_no", { ascending: true });

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

  // Determine payment status
  let paymentStatus = "UNPAID";
  if (totalReceived > 0 && balanceAmount > 0) paymentStatus = "PARTIALLY PAID";
  if (balanceAmount <= 0) paymentStatus = "PAID";

  // Build template variables
  const companyName = settings?.company_name ?? "PADMAVATHI EARTH MOVERS AND CRANE SERVICES";
  const companyPhone = settings?.phone ?? "";
  const companyEmail = settings?.email ?? "";
  const vehicleNumber = invoice.motor_vehicle_numbers ?? "";

  // Get service description from first item
  let serviceDescription = "";
  if (items && items.length > 0) {
    const firstTrip = (items[0] as Record<string, unknown>).trip as Record<string, unknown> | null;
    if (firstTrip) {
      const rebuilt = sharedBuildDesc(firstTrip as Record<string, unknown>);
      serviceDescription = rebuilt.description;
    } else {
      serviceDescription = ((items[0] as Record<string, unknown>).description as string) ?? "";
    }
  }

  const templateVars: Record<string, string> = {
    customer_name: customerName,
    customer_email: customerEmail,
    company_name: companyName,
    company_phone: companyPhone,
    company_email: companyEmail,
    service_date: formatDate(invoice.invoice_date),
    invoice_date: formatDate(invoice.invoice_date),
    invoice_number: invoice.invoice_number,
    reference_number: invoice.reference_no ?? "",
    vehicle_number: vehicleNumber,
    service_description: serviceDescription,
    total_amount: formatNumber(grandTotal),
    received_amount: formatNumber(totalReceived),
    balance_amount: formatNumber(balanceAmount),
    payment_status: paymentStatus,
  };

  // Select the right template based on stage
  let subjectTemplate = "";
  let bodyTemplate = "";
  if (reminder.reminder_stage === 1) {
    subjectTemplate = (reminderSettings.day1_subject as string) ?? "";
    bodyTemplate = (reminderSettings.day1_body as string) ?? "";
  } else if (reminder.reminder_stage === 10) {
    subjectTemplate = (reminderSettings.day10_subject as string) ?? "";
    bodyTemplate = (reminderSettings.day10_body as string) ?? "";
  } else if (reminder.reminder_stage === 20) {
    subjectTemplate = (reminderSettings.day20_subject as string) ?? "";
    bodyTemplate = (reminderSettings.day20_body as string) ?? "";
  }

  const subject = replaceTemplateVars(subjectTemplate, templateVars);
  const textBody = replaceTemplateVars(bodyTemplate, templateVars);

  // Build HTML email body with payment info table
  const htmlBody = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #333; max-width: 600px; margin: 0 auto;">
${textBody.split("\n").map((l) => l.trim() === "" ? "<br/>" : `<p style="margin: 4px 0;">${l}</p>`).join("\n")}
<hr style="margin: 16px 0; border: none; border-top: 1px solid #ddd;"/>
<table style="border-collapse: collapse; width: 100%; font-size: 13px;">
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Invoice/Reference No:</td><td style="padding: 4px 8px; border: 1px solid #ddd;">${invoice.invoice_number}${invoice.reference_no ? " / " + invoice.reference_no : ""}</td></tr>
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Invoice Date:</td><td style="padding: 4px 8px; border: 1px solid #ddd;">${formatDate(invoice.invoice_date)}</td></tr>
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Total Amount:</td><td style="padding: 4px 8px; border: 1px solid #ddd;">Rs. ${formatNumber(grandTotal)}</td></tr>
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Amount Received:</td><td style="padding: 4px 8px; border: 1px solid #ddd; color: #16a34a;">Rs. ${formatNumber(totalReceived)}</td></tr>
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Outstanding Balance:</td><td style="padding: 4px 8px; border: 1px solid #ddd; color: #dc2626;">Rs. ${formatNumber(balanceAmount)}</td></tr>
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Payment Status:</td><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">${paymentStatus}</td></tr>
</table>
</div>`;

  // Generate PDF attachment — prefer the browser-generated PDF (identical to the
  // invoice email attachment, drawn from the same print-matching source) when the
  // manual "Send Reminder" button supplied one; fall back to server-side generation
  // for automated/scheduled reminders where no browser session is available.
  let pdfBase64: string;
  if (pdfBase64Override) {
    pdfBase64 = pdfBase64Override;
  } else {
    const pdfBytes = await generateInvoicePdfBytes(invoice, items ?? [], settings, invoiceSettings, totalReceived, balanceAmount);
    pdfBase64 = sharedToBase64(pdfBytes);
  }

  const senderEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "invoices@coreone-demo.in";

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Core1ERP <${senderEmail}>`,
      to: customerEmail,
      subject,
      text: textBody,
      html: htmlBody,
      attachments: [
        {
          filename: `Invoice_${invoice.invoice_number}.pdf`,
          content: pdfBase64,
        },
      ],
    }),
  });

  const resendResult = await resendResponse.json().catch(() => ({})) as { id?: string; message?: string; error?: string };

  if (!resendResponse.ok || !resendResult.id) {
    const rawMsg = resendResult.message ??
                   resendResult.error ??
                   `Resend API returned status ${resendResponse.status}`;
    const normalized = rawMsg.toLowerCase();
    const errMsg = normalized.includes("testing emails") || normalized.includes("verify a domain") || normalized.includes("testing mode")
      ? "Email delivery is still in testing mode. A sending domain must be verified before reminders can be sent to customers."
      : rawMsg;
    return { success: false, error: errMsg };
  }

  return { success: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") as string;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const { action, invoiceId, reminderStage, pdfBase64 } = body as {
      action?: string;
      invoiceId?: string;
      reminderStage?: number;
      pdfBase64?: string;
    };

    // Load reminder settings
    const { data: reminderSettings } = await adminClient
      .from("reminder_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (!reminderSettings) {
      return new Response(
        JSON.stringify({ error: "Reminder settings not configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === MANUAL SEND ===
    if (action === "send_manual" && invoiceId && reminderStage != null) {
      // Authenticate
      const authHeader = req.headers.get("Authorization") ?? "";
      const token = authHeader.replace("Bearer ", "").trim();
      if (!token) {
        return new Response(
          JSON.stringify({ error: "Unauthorized." }),
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

      // Check if this stage is enabled
      const stageEnabled = reminderStage === 1 ? reminderSettings.day1_enabled :
                           reminderStage === 10 ? reminderSettings.day10_enabled :
                           reminderStage === 20 ? reminderSettings.day20_enabled : false;
      if (!stageEnabled) {
        return new Response(
          JSON.stringify({ error: `Day ${reminderStage} reminder is disabled in settings.` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Find or create the reminder record
      let { data: reminder } = await adminClient
        .from("invoice_reminders")
        .select("*")
        .eq("invoice_id", invoiceId)
        .eq("reminder_stage", reminderStage)
        .maybeSingle() as { data: ReminderRow | null };

      if (!reminder) {
        // Load invoice to get the date
        const { data: inv } = await adminClient
          .from("invoices")
          .select("id, invoice_date, customer_id")
          .eq("id", invoiceId)
          .maybeSingle();

        if (!inv) {
          return new Response(
            JSON.stringify({ error: "Invoice not found." }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const scheduledAt = new Date(inv.invoice_date as string);
        scheduledAt.setDate(scheduledAt.getDate() + reminderStage);

        const { data: newReminder } = await adminClient
          .from("invoice_reminders")
          .insert({
            invoice_id: invoiceId,
            customer_id: inv.customer_id,
            reminder_stage: reminderStage,
            scheduled_at: scheduledAt.toISOString(),
            status: "pending",
          })
          .select("*")
          .maybeSingle() as { data: ReminderRow | null };

        reminder = newReminder;
      }

      if (!reminder) {
        return new Response(
          JSON.stringify({ error: "Could not create reminder record." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // If already sent, don't resend
      if (reminder.status === "sent") {
        return new Response(
          JSON.stringify({ error: `Day ${reminderStage} reminder was already sent on ${reminder.sent_at}.` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Reset to pending for retry
      if (reminder.status === "failed" || reminder.status === "missing_email") {
        await adminClient.from("invoice_reminders").update({
          status: "pending",
          error_message: null,
        }).eq("id", reminder.id);
        reminder.status = "pending";
      }

      const result = await sendReminderEmail(adminClient, reminder, reminderSettings, pdfBase64);

      if (result.success) {
        await adminClient.from("invoice_reminders").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          error_message: null,
        }).eq("id", reminder.id);

        return new Response(
          JSON.stringify({ success: true, message: `Day ${reminderStage} reminder sent successfully.` }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } else {
        await adminClient.from("invoice_reminders").update({
          status: reminder.status === "missing_email" ? "missing_email" : "failed",
          error_message: result.error,
        }).eq("id", reminder.id);

        return new Response(
          JSON.stringify({ error: result.error }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // === SCHEDULE REMINDERS FOR AN INVOICE ===
    if (action === "schedule" && invoiceId) {
      const stages = [
        { stage: 1, enabled: reminderSettings.day1_enabled && reminderSettings.enabled },
        { stage: 10, enabled: reminderSettings.day10_enabled && reminderSettings.enabled },
        { stage: 20, enabled: reminderSettings.day20_enabled && reminderSettings.enabled },
      ];

      // Load invoice
      const { data: inv } = await adminClient
        .from("invoices")
        .select("id, invoice_date, customer_id")
        .eq("id", invoiceId)
        .maybeSingle();

      if (!inv) {
        return new Response(
          JSON.stringify({ error: "Invoice not found." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const results: string[] = [];
      for (const { stage, enabled } of stages) {
        if (!enabled) continue;

        const scheduledAt = new Date(inv.invoice_date as string);
        scheduledAt.setDate(scheduledAt.getDate() + stage);

        // Insert if not exists (unique constraint protects duplicates)
        const { error } = await adminClient
          .from("invoice_reminders")
          .upsert({
            invoice_id: invoiceId,
            customer_id: inv.customer_id,
            reminder_stage: stage,
            scheduled_at: scheduledAt.toISOString(),
            status: "pending",
          }, { onConflict: "invoice_id,reminder_stage", ignoreDuplicates: true });

        if (error) {
          results.push(`Stage ${stage}: error - ${error.message}`);
        } else {
          results.push(`Stage ${stage}: scheduled for ${scheduledAt.toISOString().split("T")[0]}`);
        }
      }

      return new Response(
        JSON.stringify({ success: true, results }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === AUTOMATIC PROCESSING (CRON) ===
    // Find all pending reminders whose scheduled_at has passed
    const { data: pendingReminders, error: fetchError } = await adminClient
      .from("invoice_reminders")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(50) as { data: ReminderRow[] | null; error: { message: string } | null };

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch pending reminders." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!pendingReminders || pendingReminders.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No pending reminders to process.", processed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let sent = 0;
    let failed = 0;
    let cancelled = 0;

    for (const reminder of pendingReminders) {
      // Check if this stage is still enabled
      const stageEnabled = reminder.reminder_stage === 1 ? reminderSettings.day1_enabled :
                           reminder.reminder_stage === 10 ? reminderSettings.day10_enabled :
                           reminder.reminder_stage === 20 ? reminderSettings.day20_enabled : false;
      if (!reminderSettings.enabled || !stageEnabled) {
        await adminClient.from("invoice_reminders").update({
          status: "cancelled",
          error_message: "Reminder stage disabled in settings.",
        }).eq("id", reminder.id);
        cancelled++;
        continue;
      }

      const result = await sendReminderEmail(adminClient, reminder, reminderSettings);

      if (result.success) {
        await adminClient.from("invoice_reminders").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          error_message: null,
        }).eq("id", reminder.id);
        sent++;
      } else if (result.error?.includes("cancelled")) {
        cancelled++;
      } else if (result.error?.includes("missing")) {
        // missing_email already set in sendReminderEmail
        failed++;
      } else {
        await adminClient.from("invoice_reminders").update({
          status: "failed",
          error_message: result.error,
        }).eq("id", reminder.id);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: pendingReminders.length,
        sent,
        failed,
        cancelled,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});


