import { Context } from "jsr:@hono/hono";

/**
 * Kuala authorize endpoint handler
 * Wrapper for OAuth authorization that redirects to Supabase OAuth endpoint
 */
export const handleAuthorize = (c: Context) => {
  try {
    // Extract required query parameters
    const redirectTo = c.req.query("redirect_to");
    const codeChallenge = c.req.query("code_challenge");

    // Validate required parameters
    if (!redirectTo) {
      return c.json(
        {
          code: "MISSING_REDIRECT_TO",
          message: "redirect_to parameter is required",
        },
        400,
      );
    }

    if (!codeChallenge) {
      return c.json(
        {
          code: "MISSING_CODE_CHALLENGE",
          message: "code_challenge parameter is required",
        },
        400,
      );
    }

    // Validate redirect_to is a valid URL
    try {
      new URL(redirectTo);
    } catch {
      return c.json(
        {
          code: "INVALID_REDIRECT_TO",
          message: "redirect_to must be a valid URL",
        },
        400,
      );
    }

    // Build the Supabase OAuth authorization URL
    const supabaseAuthUrl = new URL("/auth/v1/authorize", c.req.url);
    supabaseAuthUrl.searchParams.set("provider", "keycloak");
    supabaseAuthUrl.searchParams.set("scopes", "openid");
    supabaseAuthUrl.searchParams.set("redirect_to", redirectTo);
    supabaseAuthUrl.searchParams.set("flow_type", "pkce");
    supabaseAuthUrl.searchParams.set("code_challenge", codeChallenge);
    supabaseAuthUrl.searchParams.set("code_challenge_method", "s256");

    // Redirect to Supabase OAuth endpoint
    return c.redirect(supabaseAuthUrl.toString(), 302);
  } catch (error) {
    console.error("Error in handleAuthorize:", error);
    return c.json(
      {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
      500,
    );
  }
};
