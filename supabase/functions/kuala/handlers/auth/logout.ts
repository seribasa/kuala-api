import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/baseResponse.ts";
import { authLogger } from "../../middleware/logger.ts";

/**
 * Kuala logout endpoint handler
 * Wrapper for user logout that revokes refresh token
 */
export const handleLogout = async (c: Context) => {
	const handlerName = "logout";
	authLogger.start(handlerName);

	try {
		// Get Authorization header
		const authorization = c.req.header("Authorization");

		authLogger.validation(handlerName, "Authorization header check", {
			hasAuthorization: !!authorization,
			authorizationType: authorization?.substring(0, 10) + "...",
			authorizationLength: authorization?.length || 0,
		});

		if (!authorization) {
			authLogger.error(handlerName, "Missing authorization header");
			const errorResponse: ErrorResponse = {
				code: "MISSING_AUTHORIZATION",
				message: "Authorization header is required",
			};
			return c.json(errorResponse, 401);
		}

		// Build the Supabase logout URL
		const supabaseBaseUrl = Deno.env.get("AUTH_BASE_URL") || c.req.url;
		const supabaseLogoutUrl = new URL("/auth/v1/logout", supabaseBaseUrl);

		authLogger.apiCall(handlerName, "URL construction", {
			supabaseBaseUrl,
			requestUrl: c.req.url,
			finalLogoutUrl: supabaseLogoutUrl.toString(),
		});

		// Get apikey from environment
		const apikey = Deno.env.get("AUTH_SUPABASE_ANON_KEY");

		authLogger.validation(handlerName, "API key validation", {
			hasApikey: !!apikey,
			apikeyLength: apikey?.length || 0,
		});

		if (!apikey) {
			authLogger.error(handlerName, "Missing API key");
			const errorResponse: ErrorResponse = {
				code: "MISSING_API_KEY",
				message: "Supabase API key not configured",
			};
			return c.json(errorResponse, 500);
		}

		// Forward request to Supabase
		authLogger.apiCall(handlerName, "Making request to Supabase", {
			url: supabaseLogoutUrl.toString(),
			method: "POST",
			hasAuthHeader: !!authorization,
			hasApikey: !!apikey,
		});

		const response = await fetch(supabaseLogoutUrl.toString(), {
			method: "POST",
			headers: {
				"Authorization": authorization,
				"apikey": apikey,
			},
		});

		authLogger.apiCall(handlerName, "Supabase response received", {
			status: response.status,
			statusText: response.statusText,
			isOk: response.ok,
			hasHeaders: !!response.headers,
		});

		// Handle Supabase response
		if (!response.ok) {
			const data = await response.json();

			authLogger.error(handlerName, "Supabase error response", {
				status: response.status,
				error_code: data.error_code,
				error_description: data.error_description,
				msg: data.msg,
			});
			const status = data.code || response.status || 500;
			const errorResponse: ErrorResponse = {
				code: data.error_code || "SUPABASE_ERROR",
				message: data.error_description || data.msg ||
					"Error from Supabase",
			};
			return c.json(errorResponse, status);
		}

		authLogger.success(handlerName, "User logout successful", {
			status: response.status,
			statusText: response.statusText,
		});

		// Return 204 No Content for successful logout
		return c.body(null, 204);
	} catch (error) {
		authLogger.exception(handlerName, error as Error);

		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Internal server error",
		};
		return c.json(errorResponse, 500);
	}
};
