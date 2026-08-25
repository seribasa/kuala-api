import { config } from "../../../_shared/config/env.ts";
import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { authLogger } from "../../middleware/logger.ts";

/**
 * Kuala authorize endpoint handler
 * Wrapper for OAuth authorization that redirects to Supabase OAuth endpoint
 */
export const handleAuthorize = async (c: Context) => {
	const handlerName = "authorize";
	authLogger.start(handlerName);

	try {
		// Extract required query parameters
		const redirectTo = c.req.query("redirect_to");
		const codeChallenge = c.req.query("code_challenge");

		authLogger.validation(handlerName, "query parameters", {
			hasRedirectTo: !!redirectTo,
			hasCodeChallenge: !!codeChallenge,
			redirectTo: redirectTo || "none",
			codeChallengeLength: codeChallenge?.length || 0,
		});

		// Build the Supabase OAuth authorization URL
		const supabaseBaseUrl = config.AUTH_BASE_URL || c.req.url;
		const supabaseAuthUrl = new URL("/auth/v1/authorize", supabaseBaseUrl);
		supabaseAuthUrl.searchParams.set("provider", "keycloak");
		supabaseAuthUrl.searchParams.set("scopes", "openid");
		supabaseAuthUrl.searchParams.set("redirect_to", redirectTo as string);
		supabaseAuthUrl.searchParams.set("flow_type", "pkce");
		supabaseAuthUrl.searchParams.set(
			"code_challenge",
			codeChallenge as string,
		);
		supabaseAuthUrl.searchParams.set("code_challenge_method", "s256");

		authLogger.apiCall(handlerName, "URL construction", {
			supabaseBaseUrl,
			requestUrl: c.req.url,
			finalAuthUrl: supabaseAuthUrl.toString(),
		});

		// Attempt to fetch Supabase OAuth endpoint to get redirect URL
		authLogger.apiCall(handlerName, "Making request to Supabase OAuth", {
			url: supabaseAuthUrl.toString(),
			method: "GET",
		});

		const response = await fetch(supabaseAuthUrl.toString(), {
			method: "GET",
			redirect: "manual",
		});

		authLogger.apiCall(handlerName, "Supabase OAuth response", {
			status: response.status,
			statusText: response.statusText,
			isOk: response.ok,
			hasLocationHeader: !!response.headers.get("location"),
		});

		if (!response.ok && response.status !== 302) {
			authLogger.error(handlerName, "Supabase OAuth error", {
				status: response.status,
				statusText: response.statusText,
			});
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
			authLogger.error(
				handlerName,
				"No redirect location found in response",
			);
			const errorResponse: ErrorResponse = {
				code: "NO_REDIRECT_LOCATION",
				message: "No redirect location found",
			};
			return c.json(errorResponse, 500);
		}

		authLogger.success(handlerName, "OAuth redirect successful", {
			redirectLocation: locationHeader,
		});

		return c.redirect(locationHeader, 302);
	} catch (error) {
		authLogger.exception(handlerName, error as Error);
		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Internal server error",
		};
		return c.json(errorResponse, 500);
	}
};
