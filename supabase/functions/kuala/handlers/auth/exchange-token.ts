import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/baseResponse.ts";
import { authLogger } from "../../middleware/logger.ts";

/**
 * Kuala exchange-token endpoint handler
 * Wrapper for exchanging authorization code for access token
 */
export const handleExchangeToken = async (c: Context) => {
	const handlerName = "exchange-token";
	authLogger.start(handlerName);

	try {
		// Parse request body
		const body = await c.req.json();
		const { auth_code, code_verifier } = body;

		// Validate required parameters
		if (!auth_code) {
			authLogger.error(handlerName, "Missing authorization code");
			const errorResponse: ErrorResponse = {
				code: "MISSING_AUTH_CODE",
				message: "auth_code is required",
			};
			return c.json(errorResponse, 400);
		}

		if (!code_verifier) {
			authLogger.error(handlerName, "Missing code verifier");
			const errorResponse: ErrorResponse = {
				code: "MISSING_CODE_VERIFIER",
				message: "code_verifier is required",
			};
			return c.json(errorResponse, 400);
		}

		// Build the Supabase token exchange URL
		const supabaseBaseUrl = Deno.env.get("AUTH_BASE_URL") || c.req.url;
		const supabaseTokenUrl = new URL("/auth/v1/token", supabaseBaseUrl);
		supabaseTokenUrl.searchParams.set("grant_type", "pkce");

		authLogger.apiCall(handlerName, "URL construction", {
			baseUrl: supabaseBaseUrl,
			tokenUrl: supabaseTokenUrl.toString(),
		});

		// Prepare request body for Supabase
		const supabaseRequestBody = {
			auth_code,
			code_verifier,
		};

		authLogger.validation(handlerName, "Supabase request body", {
			hasAuthCode: !!supabaseRequestBody.auth_code,
			hasCodeVerifier: !!supabaseRequestBody.code_verifier,
			authCodeLength: supabaseRequestBody.auth_code?.length || 0,
			codeVerifierLength: supabaseRequestBody.code_verifier?.length || 0,
		});

		// Get apikey from environment or request
		const apikey = Deno.env.get("AUTH_SUPABASE_ANON_KEY");
		if (!apikey) {
			authLogger.error(handlerName, "Missing AUTH_SUPABASE_ANON_KEY");
			const errorResponse: ErrorResponse = {
				code: "MISSING_API_KEY",
				message: "Supabase API key not configured",
			};
			return c.json(errorResponse, 500);
		}

		authLogger.apiCall(handlerName, "Making request to Supabase", {
			url: supabaseTokenUrl.toString(),
			method: "POST",
			hasApiKey: !!apikey,
			apiKey: apikey || "none",
		});

		// Forward request to Supabase
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
			ok: response.ok,
		});

		// Forward response from Supabase
		const data = await response.json();
		authLogger.validation(handlerName, "Supabase response data", {
			hasAccessToken: !!data.access_token,
			hasRefreshToken: !!data.refresh_token,
			hasError: !!data.error,
			errorCode: data.error_code,
			errorDescription: data.error_description,
		});

		if (!response.ok) {
			authLogger.error(handlerName, "Supabase returned error", {
				status: response.status,
				errorCode: data.error_code,
				errorDescription: data.error_description,
			});
			const status = data.code || response.status || 500;
			const errorResponse: ErrorResponse = {
				code: data.error_code || "SUPABASE_ERROR",
				message: data.error_description || data.msg ||
					"Error from Supabase",
			};
			return c.json(errorResponse, status);
		}

		authLogger.success(handlerName, "Token exchange successful", {
			hasAccessToken: !!data.access_token,
			hasRefreshToken: !!data.refresh_token,
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
