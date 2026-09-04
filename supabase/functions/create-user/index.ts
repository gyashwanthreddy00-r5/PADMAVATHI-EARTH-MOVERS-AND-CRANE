import { createClient } from "npm:@supabase/supabase-js@2.57.4";

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

    const body = await req.json().catch(() => ({}));
    const action = (body as { action?: string }).action;

    // =============================================================
    // CREATE: create a new user (auth account + profile + password)
    // =============================================================
    if (req.method === "POST" && action === "create") {
      const { username, password, display_name, active } = body as {
        username: string;
        password: string;
        display_name?: string;
        active?: boolean;
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
      const internalEmail = `${cleanUsername}@craneerp.local`;
      const isActive = active !== undefined ? active : true;

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
          role: "admin",
          password,
          active: isActive,
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
        role: "admin",
        password,
        active: isActive,
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

    // =============================================================
    // UPDATE: update an existing user's profile (name, password, active)
    // =============================================================
    if (req.method === "POST" && action === "update") {
      const { profile_id, username, display_name, password, active } = body as {
        profile_id: string;
        username?: string;
        display_name?: string;
        password?: string;
        active?: boolean;
      };

      if (!profile_id) {
        return new Response(
          JSON.stringify({ error: "Profile ID is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (password && password.length < 6) {
        return new Response(
          JSON.stringify({ error: "Password must be at least 6 characters" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: profile } = await adminClient
        .from("user_profiles")
        .select("auth_user_id")
        .eq("id", profile_id)
        .maybeSingle();

      if (!profile) {
        return new Response(
          JSON.stringify({ error: "User not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (password) {
        const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(
          profile.auth_user_id,
          { password },
        );
        if (authUpdateError) {
          return new Response(
            JSON.stringify({ error: "Unable to update the login password. Please choose a stronger password and try again." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (username) updatePayload.username = username.toLowerCase().trim();
      if (display_name !== undefined) updatePayload.display_name = display_name || null;
      if (password) updatePayload.password = password;
      if (active !== undefined) updatePayload.active = active;

      const { error: updateError } = await adminClient
        .from("user_profiles")
        .update(updatePayload)
        .eq("id", profile_id);

      if (updateError) {
        const message = updateError.code === "23505" ? "Username already exists" : "Unable to save the user. Please try again.";
        return new Response(
          JSON.stringify({ error: message }),
          { status: updateError.code === "23505" ? 409 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ message: "User updated successfully" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // =============================================================
    // TOGGLE-STATUS: quickly activate/deactivate a user
    // =============================================================
    if (req.method === "POST" && action === "toggle-status") {
      const { profile_id, active } = body as { profile_id: string; active: boolean };

      if (!profile_id) {
        return new Response(
          JSON.stringify({ error: "Profile ID is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { error } = await adminClient
        .from("user_profiles")
        .update({ active, updated_at: new Date().toISOString() })
        .eq("id", profile_id);

      if (error) {
        return new Response(
          JSON.stringify({ error: "Unable to update user status. Please try again." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ message: "Status updated successfully" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // =============================================================
    // DELETE: delete a user (profile + auth account)
    // =============================================================
    if (req.method === "POST" && action === "delete") {
      const { profile_id } = body as { profile_id: string };

      if (!profile_id) {
        return new Response(
          JSON.stringify({ error: "Profile ID is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: profile } = await adminClient
        .from("user_profiles")
        .select("auth_user_id")
        .eq("id", profile_id)
        .maybeSingle();

      if (!profile) {
        return new Response(
          JSON.stringify({ error: "User not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { error: deleteError } = await adminClient.auth.admin.deleteUser(profile.auth_user_id);

      if (deleteError) {
        const { error: profileDeleteError } = await adminClient
          .from("user_profiles")
          .delete()
          .eq("id", profile_id);

        if (profileDeleteError) {
          return new Response(
            JSON.stringify({ error: "Unable to delete the user. Please try again." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      return new Response(
        JSON.stringify({ message: "User deleted successfully" }),
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
