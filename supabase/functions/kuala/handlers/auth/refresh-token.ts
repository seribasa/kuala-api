import { Context } from "jsr:@hono/hono";
import { ErrorResponse } from "../../../_shared/types/baseResponse.ts";
import { authLogger } from "../../middleware/logger.ts";

/**
 * Kuala refresh-token endpoint handler
 * Wrapper for refreshing access tokens using refresh token
 */
export const handleRefreshToken = async (c: Context) => {
	const handlerName = "refresh-token";
	authLogger.start(handlerName);

	try {
		// Parse request body
		const body = await c.req.json();
		const { refresh_token } = body;

		authLogger.validation(handlerName, "request body", {
			hasRefreshToken: !!refresh_token,
			refreshTokenLength: refresh_token?.length || 0,
		});

		// Validate required parameters
		if (!refresh_token) {
			authLogger.error(handlerName, "Missing refresh_token");
			const errorResponse: ErrorResponse = {
				code: "MISSING_REFRESH_TOKEN",
				message: "refresh_token is required",
			};
			return c.json(errorResponse, 400);
		}

		// Build the Supabase token refresh URL
		const supabaseBaseUrl = Deno.env.get("AUTH_BASE_URL") || c.req.url;
		const supabaseTokenUrl = new URL("/auth/v1/token", supabaseBaseUrl);
		supabaseTokenUrl.searchParams.set("grant_type", "refresh_token");

		authLogger.apiCall(handlerName, "URL construction", {
			supabaseBaseUrl,
			requestUrl: c.req.url,
			finalTokenUrl: supabaseTokenUrl.toString(),
		});

		// Prepare request body for Supabase
		const supabaseRequestBody = {
			refresh_token,
		};

		authLogger.validation(handlerName, "Supabase request body", {
			hasRefreshToken: !!supabaseRequestBody.refresh_token,
			refreshTokenLength: supabaseRequestBody.refresh_token?.length || 0,
		});

		// Get apikey from environment or request
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
			url: supabaseTokenUrl.toString(),
			method: "POST",
			hasHeaders: true,
			hasBody: true,
		});

		const response = await fetch(supabaseTokenUrl.toString(), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"apikey": apikey,
			},
			body: JSON.stringify(supabaseRequestBody),
		});

		authLogger.apiCall(handlerName, "Supabase response received", {
			status: response.status,
			statusText: response.statusText,
			isOk: response.ok,
			hasHeaders: !!response.headers,
		});

		// Forward response from Supabase
		const data = await response.json();

		authLogger.validation(handlerName, "Response data parsed", {
			hasData: !!data,
			dataKeysCount: data ? Object.keys(data).length : 0,
			hasError:
				!!(data.error || data.error_code || data.error_description),
		});

		if (!response.ok) {
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

		authLogger.success(handlerName, "Token refresh successful", {
			hasAccessToken: !!(data.access_token),
			hasRefreshToken: !!(data.refresh_token),
			tokenType: data.token_type,
			expiresIn: data.expires_in,
		});

		return c.json(data, 200);
	} catch (error) {
		authLogger.exception(handlerName, error as Error);

		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Internal server error",
		};
		return c.json(errorResponse, 500);
	}
};
