import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/baseResponse.ts";
import { authLogger } from "../../middleware/logger.ts";

/**
 * Kuala me endpoint handler
 * Wrapper for retrieving current authenticated user information
 */
export const handleMe = async (c: Context) => {
	const handlerName = "me";
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

		// Build the Supabase user URL
		const supabaseBaseUrl = Deno.env.get("AUTH_BASE_URL") || c.req.url;
		const supabaseUserUrl = new URL("/auth/v1/user", supabaseBaseUrl);

		authLogger.apiCall(handlerName, "URL construction", {
			supabaseBaseUrl,
			requestUrl: c.req.url,
			finalUserUrl: supabaseUserUrl.toString(),
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
			url: supabaseUserUrl.toString(),
			method: "GET",
			hasAuthHeader: !!authorization,
			hasApikey: !!apikey,
		});

		const response = await fetch(supabaseUserUrl.toString(), {
			method: "GET",
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

		// Forward response from Supabase
		const data = await response.json();

		authLogger.validation(handlerName, "Response data parsed", {
			hasData: !!data,
			dataKeysCount: data ? Object.keys(data).length : 0,
			hasError:
				!!(data.error || data.error_code || data.error_description),
			hasUser: !!(data.id || data.email),
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

		authLogger.success(handlerName, "User data retrieval successful", {
			userId: data.id,
			userEmail: data.email,
			hasUserMetadata: !!(data.user_metadata),
			hasAppMetadata: !!(data.app_metadata),
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
