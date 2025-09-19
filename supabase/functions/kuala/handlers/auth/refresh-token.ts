import { Context } from "jsr:@hono/hono";
import { ErrorResponse } from "../../../_shared/types/baseResponse.ts";

/**
 * Kuala refresh-token endpoint handler
 * Wrapper for refreshing access tokens using refresh token
 */
export const handleRefreshToken = async (c: Context) => {
	try {
		// Parse request body
		const body = await c.req.json();
		const { refresh_token } = body;

		// Validate required parameters
		if (!refresh_token) {
			const errorResponse: ErrorResponse = {
				code: "MISSING_REFRESH_TOKEN",
				message: "refresh_token is required",
			};
			return c.json(errorResponse, 400);
		}

		// Build the Supabase token refresh URL
		const supabaseBaseUrl = Deno.env.get("SUPABASE_URL") || c.req.url;
		const supabaseTokenUrl = new URL("/auth/v1/token", supabaseBaseUrl);
		supabaseTokenUrl.searchParams.set("grant_type", "refresh_token");

		// Prepare request body for Supabase
		const supabaseRequestBody = {
			refresh_token,
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
		console.error("Error in handleRefreshToken:", error);
		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Internal server error",
		};
		return c.json(errorResponse, 500);
	}
};
