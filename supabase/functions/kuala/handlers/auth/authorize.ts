import { Context } from "jsr:@hono/hono";
import { ErrorResponse } from "../../../_shared/types/baseResponse.ts";

/**
 * Kuala authorize endpoint handler
 * Wrapper for OAuth authorization that redirects to Supabase OAuth endpoint
 */
export const handleAuthorize = async (c: Context) => {
	try {
		// Extract required query parameters
		const redirectTo = c.req.query("redirect_to");
		const codeChallenge = c.req.query("code_challenge");

		// Validate required parameters
		if (!redirectTo) {
			const errorResponse: ErrorResponse = {
				code: "MISSING_REDIRECT_TO",
				message: "redirect_to parameter is required",
			};
			return c.json(errorResponse, 400);
		}

		if (!codeChallenge) {
			const errorResponse: ErrorResponse = {
				code: "MISSING_CODE_CHALLENGE",
				message: "code_challenge parameter is required",
			};
			return c.json(errorResponse, 400);
		}

		// Validate redirect_to is a valid URL
		try {
			new URL(redirectTo);
		} catch {
			const errorResponse: ErrorResponse = {
				code: "INVALID_REDIRECT_TO",
				message: "redirect_to must be a valid URL",
			};
			return c.json(errorResponse, 400);
		}

		// Build the Supabase OAuth authorization URL
		const supabaseBaseUrl = Deno.env.get("AUTH_BASE_URL") || c.req.url;
		const supabaseAuthUrl = new URL("/auth/v1/authorize", supabaseBaseUrl);
		supabaseAuthUrl.searchParams.set("provider", "keycloak");
		supabaseAuthUrl.searchParams.set("scopes", "openid");
		supabaseAuthUrl.searchParams.set("redirect_to", redirectTo);
		supabaseAuthUrl.searchParams.set("flow_type", "pkce");
		supabaseAuthUrl.searchParams.set("code_challenge", codeChallenge);
		supabaseAuthUrl.searchParams.set("code_challenge_method", "s256");

		// Attempt to fetch Supabase OAuth endpoint to get redirect URL
		const response = await fetch(supabaseAuthUrl.toString(), {
			method: "GET",
			redirect: "manual",
		});
		if (!response.ok && response.status !== 302) {
			console.error("Supabase OAuth error:", response);
			const errorResponse: ErrorResponse = {
				code: "SUPABASE_OAUTH_ERROR",
				message:
					"Sorry, we encountered an error with the OAuth provider",
			};
			return c.json(
				errorResponse,
				response.status as 400 | 401 | 403 | 404 | 500,
			);
		}
		const locationHeader = response.headers.get("location");
		if (!locationHeader) {
			const errorResponse: ErrorResponse = {
				code: "NO_REDIRECT_LOCATION",
				message: "No redirect location found",
			};
			return c.json(errorResponse, 500);
		}

		return c.redirect(locationHeader, 302);
	} catch (error) {
		console.error("Error in handleAuthorize:", error);
		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Internal server error",
		};
		return c.json(errorResponse, 500);
	}
};
