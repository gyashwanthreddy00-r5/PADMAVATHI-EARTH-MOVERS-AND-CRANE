import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface LoginRequest {
  username: string;
  password: string;
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
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const url = new URL(req.url);
    const action = url.pathname.split("/").pop();

    if (req.method === "POST" && action === "login") {
      const { username, password }: LoginRequest = await req.json();

      if (!username || !password) {
        return new Response(
          JSON.stringify({ error: "Username and password are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const cleanUsername = username.toLowerCase().trim();

      const { data: profile, error: profileError } = await adminClient
        .from("user_profiles")
        .select("auth_user_id, username, display_name, role, active, password")
        .eq("username", cleanUsername)
        .maybeSingle();

      if (profileError || !profile) {
        return new Response(
          JSON.stringify({ error: "Invalid username or password" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (!profile.active) {
        return new Response(
          JSON.stringify({ error: "This account has been deactivated. Contact your administrator." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Verify password against stored password in user_profiles
      if (!profile.password || profile.password !== password) {
        return new Response(
          JSON.stringify({ error: "Invalid username or password" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Get the auth user's email for Supabase Auth session
      const { data: authUser, error: userError } = await adminClient.auth.admin.getUserById(
        profile.auth_user_id,
      );

      if (userError || !authUser.user) {
        return new Response(
          JSON.stringify({ error: "Invalid username or password" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ email: authUser.user.email }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (req.method === "POST" && action === "setup") {
      const adminEmail = "admin@craneerp.local";
      const adminPassword = "Admin@12345";
      const adminUsername = "admin";

      const { data: existing } = await adminClient
        .from("user_profiles")
        .select("id")
        .eq("username", adminUsername)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ message: "Admin user already exists", username: adminUsername }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: authData, error: createError } = await adminClient.auth.admin.createUser({
        email: adminEmail,
        password: adminPassword,
        email_confirm: true,
        user_metadata: { full_name: "Administrator" },
      });

      if (createError || !authData.user) {
        const { data: existingUsers } = await adminClient.auth.admin.listUsers();
        const found = existingUsers.users.find((u) => u.email === adminEmail);

        if (!found) {
          return new Response(
            JSON.stringify({ error: createError?.message ?? "Failed to create admin user" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const { error: profileError } = await adminClient.from("user_profiles").insert({
          auth_user_id: found.id,
          username: adminUsername,
          display_name: "Administrator",
          role: "admin",
          password: adminPassword,
          active: true,
        });

        if (profileError) {
          return new Response(
            JSON.stringify({ error: profileError.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({ message: "Admin user linked successfully", username: adminUsername }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { error: profileError } = await adminClient.from("user_profiles").insert({
        auth_user_id: authData.user.id,
        username: adminUsername,
        display_name: "Administrator",
        role: "admin",
        password: adminPassword,
        active: true,
      });

      if (profileError) {
        return new Response(
          JSON.stringify({ error: profileError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ message: "Admin user created successfully", username: adminUsername }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (req.method === "POST" && action === "create-user") {
      const authHeader = req.headers.get("Authorization") ?? "";
      const token = authHeader.replace("Bearer ", "").trim();

      const { data: callerUser, error: callerError } = await adminClient.auth.getUser(token);
      if (callerError || !callerUser.user) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: callerProfile } = await adminClient
        .from("user_profiles")
        .select("role, active")
        .eq("auth_user_id", callerUser.user.id)
        .maybeSingle();

      if (!callerProfile || !callerProfile.active || callerProfile.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "Only administrators can create new users" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const body = await req.json();
      const { username, password, display_name, role } = body as {
        username: string;
        password: string;
        display_name?: string;
        role?: string;
      };

      if (!username || !password) {
        return new Response(
          JSON.stringify({ error: "Username and password are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (password.length < 6) {
        return new Response(
          JSON.stringify({ error: "Password must be at least 6 characters" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const cleanUsername = username.toLowerCase().trim();
      const validRoles = ["admin", "manager", "operator"];
      const userRole = validRoles.includes(role ?? "") ? role! : "admin";

      const { data: existing } = await adminClient
        .from("user_profiles")
        .select("id")
        .eq("username", cleanUsername)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ error: "Username already exists" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const internalEmail = `${cleanUsername}@craneerp.local`;

      const { data: authData, error: createError } = await adminClient.auth.admin.createUser({
        email: internalEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: display_name ?? cleanUsername },
      });

      if (createError || !authData.user) {
        const { data: existingUsers } = await adminClient.auth.admin.listUsers();
        const found = existingUsers.users.find((u) => u.email === internalEmail);

        if (!found) {
          return new Response(
            JSON.stringify({ error: createError?.message ?? "Failed to create user" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const { error: profileError } = await adminClient.from("user_profiles").insert({
          auth_user_id: found.id,
          username: cleanUsername,
          display_name: display_name ?? cleanUsername,
          role: userRole,
          password,
          active: true,
        });

        if (profileError) {
          return new Response(
            JSON.stringify({ error: profileError.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({ message: "User created successfully", username: cleanUsername }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { error: profileError } = await adminClient.from("user_profiles").insert({
        auth_user_id: authData.user.id,
        username: cleanUsername,
        display_name: display_name ?? cleanUsername,
        role: userRole,
        password,
        active: true,
      });

      if (profileError) {
        return new Response(
          JSON.stringify({ error: profileError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ message: "User created successfully", username: cleanUsername }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: "Not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
