import { Context } from "jsr:@hono/hono";
import { ErrorResponse } from "../../../_shared/types/baseResponse.ts";

/**
 * Kuala logout endpoint handler
 * Wrapper for user logout that revokes refresh token
 */
export const handleLogout = async (c: Context) => {
	try {
		// Get Authorization header
		const authorization = c.req.header("Authorization");
		if (!authorization) {
			const errorResponse: ErrorResponse = {
				code: "MISSING_AUTHORIZATION",
				message: "Authorization header is required",
			};
			return c.json(errorResponse, 401);
		}

		// Build the Supabase logout URL
		const supabaseBaseUrl = Deno.env.get("AUTH_BASE_URL") || c.req.url;
		const supabaseLogoutUrl = new URL("/auth/v1/logout", supabaseBaseUrl);

		// Get apikey from environment
		const apikey = Deno.env.get("SUPABASE_ANON_KEY");
		if (!apikey) {
			const errorResponse: ErrorResponse = {
				code: "MISSING_API_KEY",
				message: "Supabase API key not configured",
			};
			return c.json(errorResponse, 500);
		}

		// Forward request to Supabase
		const response = await fetch(supabaseLogoutUrl.toString(), {
			method: "POST",
			headers: {
				"Authorization": authorization,
				"apikey": apikey,
			},
		});

		// Handle Supabase response
		if (!response.ok) {
			const data = await response.json();
			const status = data.code || 500;
			const remappedError: ErrorResponse = {
				code: data.error_code || "SUPABASE_ERROR",
				message: data.msg || "Error from Supabase",
			};
			return c.json(remappedError, status);
		}

		// Return 204 No Content for successful logout
		return c.body(null, 204);
	} catch (error) {
		console.error("Error in handleLogout:", error);
		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Internal server error",
		};
		return c.json(errorResponse, 500);
	}
};
