import { Context } from "jsr:@hono/hono";
import { ErrorResponse } from "../../../_shared/types/baseResponse.ts";

/**
 * Kuala exchange-token endpoint handler
 * Wrapper for exchanging OAuth authorization code for access tokens
 */
export const handleExchangeToken = async (c: Context) => {
	try {
		// Parse request body
		const body = await c.req.json();
		const { auth_code, code_verifier } = body;

		// Validate required parameters
		if (!auth_code) {
			const errorResponse: ErrorResponse = {
				code: "MISSING_AUTH_CODE",
				message: "auth_code is required",
			};
			return c.json(errorResponse, 400);
		}

		if (!code_verifier) {
			const errorResponse: ErrorResponse = {
				code: "MISSING_CODE_VERIFIER",
				message: "code_verifier is required",
			};
			return c.json(errorResponse, 400);
		}

		// Build the Supabase token exchange URL
		const supabaseBaseUrl = Deno.env.get("SUPABASE_URL") || c.req.url;
		const supabaseTokenUrl = new URL("/auth/v1/token", supabaseBaseUrl);
		supabaseTokenUrl.searchParams.set("grant_type", "pkce");

		// Prepare request body for Supabase
		const supabaseRequestBody = {
			auth_code,
			code_verifier,
		};

		// Get apikey from environment or request
		const apikey = Deno.env.get("SUPABASE_ANON_KEY");
		if (!apikey) {
			const errorResponse: ErrorResponse = {
				code: "MISSING_API_KEY",
				message: "Supabase API key not configured",
			};
			return c.json(errorResponse, 500);
		}

		// Forward request to Supabase
		const response = await fetch(supabaseTokenUrl.toString(), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"apikey": apikey,
			},
			body: JSON.stringify(supabaseRequestBody),
		});

		// Forward response from Supabase
		const data = await response.json();
		if (!response.ok) {
			const status = data.code || 500;
			const remappedError: ErrorResponse = {
				code: data.error_code || "SUPABASE_ERROR",
				message: data.msg || "Error from Supabase",
			};
			return c.json(remappedError, status);
		}

		return c.json(data, 200);
	} catch (error) {
		console.error("Error in handleExchangeToken:", error);
		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Internal server error",
		};
		return c.json(errorResponse, 500);
	}
};
