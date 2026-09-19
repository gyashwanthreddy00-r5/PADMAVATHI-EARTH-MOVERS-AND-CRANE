import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function formatCurrency(amount: number): string {
  const value = Number(amount) || 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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
    const { customerId, poNumber, currentBalance, requiredInvoiceAmount, additionalAmount } = body as {
      customerId?: string; poNumber?: string; currentBalance?: number; requiredInvoiceAmount?: number; additionalAmount?: number;
    };
    if (!customerId || !poNumber || additionalAmount == null || !(Number(additionalAmount) > 0)) {
      return new Response(
        JSON.stringify({ error: "Customer, PO Number and a valid Additional PO Amount are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: customer, error: custError } = await adminClient
      .from("customers")
      .select("name, email")
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
        JSON.stringify({ error: "Customer email address is not configured. Please update Customer Master before sending the PO request." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: settings } = await adminClient
      .from("company_settings")
      .select("company_name")
      .limit(1)
      .maybeSingle();
    const companyName = settings?.company_name ?? "PADMAVATHI EARTH MOVERS AND CRANE SERVICES";

    const customerName = customer.name ?? "Customer";
    const balanceStr = formatCurrency(Number(currentBalance) || 0);
    const requiredInvoiceStr = formatCurrency(Number(requiredInvoiceAmount) || 0);
    const additionalStr = formatCurrency(Number(additionalAmount) || 0);

    const subject = `REQUEST FOR ADDITIONAL PO – ${customerName.toUpperCase()}`;

    const textBody = `Dear ${customerName},

The current PO balance available for our account is ${balanceStr}.

We require an additional PO to process an upcoming invoice of ${requiredInvoiceStr}.

Please issue a new PO for the required amount.

Current PO Number: ${poNumber}

Current PO Balance: ${balanceStr}

Required Invoice Amount: ${requiredInvoiceStr}

Additional PO Amount Required: ${additionalStr}

Regards,
${companyName}`;

    const emailWrapper = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #333; max-width: 600px; margin: 0 auto;">
<p>Dear ${customerName},</p>
<p>The current PO balance available for our account is <strong>${balanceStr}</strong>.</p>
<p>We require an additional PO to process an upcoming invoice of <strong>${requiredInvoiceStr}</strong>.</p>
<p>Please issue a new PO for the required amount.</p>
<table style="margin: 16px 0; border-collapse: collapse; width: 100%;">
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Current PO Number:</td><td style="padding: 4px 8px; border: 1px solid #ddd;">${poNumber}</td></tr>
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Current PO Balance:</td><td style="padding: 4px 8px; border: 1px solid #ddd;">${balanceStr}</td></tr>
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Required Invoice Amount:</td><td style="padding: 4px 8px; border: 1px solid #ddd;">${requiredInvoiceStr}</td></tr>
<tr><td style="padding: 4px 8px; border: 1px solid #ddd; font-weight: 600;">Additional PO Amount Required:</td><td style="padding: 4px 8px; border: 1px solid #ddd;">${additionalStr}</td></tr>
</table>
<p style="margin-top: 24px;">Regards,<br/><strong>${companyName}</strong></p>
</div>`;

    const senderEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "invoices@coreone-demo.in";
    const senderName = Deno.env.get("RESEND_FROM_NAME") ?? "Padmavathi Crane";

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${senderName} <${senderEmail}>`,
        to: customer.email,
        subject,
        text: textBody,
        html: emailWrapper,
        // Default CC + Reply-To for every outgoing PO request email
        cc: "Padmavathicranes@gmail.com",
        reply_to: "Padmavathicranes@gmail.com",
      }),
    });

    const resendResult = await resendResponse.json().catch(() => ({})) as { id?: string; message?: string; error?: string };

    if (!resendResponse.ok || !resendResult.id) {
      const rawMsg = resendResult.message ?? resendResult.error ?? `Resend API returned status ${resendResponse.status}`;
      const normalized = rawMsg.toLowerCase();
      const errMsg = normalized.includes("testing emails") || normalized.includes("verify a domain") || normalized.includes("testing mode")
        ? "Email delivery is still in testing mode. A sending domain must be verified before PO requests can be sent to customers."
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
