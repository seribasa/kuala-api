import { config } from "../../../_shared/config/env.ts";
import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { authLogger } from "../../middleware/logger.ts";
import { keycloakService } from "../../../_shared/services/keycloak.ts";

/**
 * Kuala logout endpoint handler
 * Wrapper for user logout that invalidates both Supabase and Keycloak sessions
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
			authLogger.error(handlerName, "Missing Authorization header");
			const errorResponse: ErrorResponse = {
				code: "MISSING_AUTHORIZATION",
				message: "Authorization header is required",
			};
			return c.json(errorResponse, 401);
		}

		// Get apikey from environment
		const apikey = config.AUTH_SUPABASE_ANON_KEY;

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

		// Build the Supabase logout URL
		const supabaseBaseUrl = config.AUTH_BASE_URL;
		if (!supabaseBaseUrl) {
			authLogger.error(handlerName, "Missing AUTH_BASE_URL");
			const errorResponse: ErrorResponse = {
				code: "MISSING_AUTH_BASE_URL",
				message: "Supabase Auth base URL not configured",
			};
			return c.json(errorResponse, 500);
		}

		const supabaseLogoutUrl = new URL("/auth/v1/logout", supabaseBaseUrl);

		authLogger.apiCall(handlerName, "URL construction", {
			supabaseBaseUrl,
			requestUrl: c.req.url,
			finalLogoutUrl: supabaseLogoutUrl.toString(),
		});

		// Optional: parse body for refresh token (if client passed one)
		let keycloakRefreshToken: string | undefined;
		try {
			const body = await c.req.json().catch(() => null);
			if (body && typeof body.refresh_token === "string") {
				keycloakRefreshToken = body.refresh_token;
			}
		} catch {
			// Body is optional for logout
		}

		// Perform Server-to-Server Keycloak session invalidation if Keycloak is configured
		if (keycloakService.isConfigured()) {
			if (keycloakRefreshToken) {
				authLogger.apiCall(
					handlerName,
					"Attempting Keycloak OIDC logout with refresh token",
				);
				await keycloakService.logoutWithRefreshToken(
					keycloakRefreshToken,
				);
			}

			// Retrieve user profile to find Keycloak user id (sub)
			try {
				const supabaseUserUrl = new URL(
					"/auth/v1/user",
					supabaseBaseUrl,
				);
				const userResponse = await fetch(supabaseUserUrl.toString(), {
					method: "GET",
					headers: {
						"Authorization": authorization,
						"apikey": apikey,
					},
				});

				if (userResponse.ok) {
					const userData = await userResponse.json();
					const identities = userData?.identities as
						| Array<{
							provider?: string;
							identity_data?: { sub?: string };
						}>
						| undefined;
					const keycloakIdentity = identities?.find(
						(i) => i.provider === "keycloak",
					);
					const keycloakUserId = keycloakIdentity?.identity_data?.sub;

					if (keycloakUserId) {
						authLogger.apiCall(
							handlerName,
							"Attempting Keycloak Admin logout for user",
							{ keycloakUserId },
						);
						const kcSuccess = await keycloakService.logoutUser(
							keycloakUserId,
						);
						authLogger.apiCall(
							handlerName,
							"Keycloak Admin logout result",
							{ success: kcSuccess, keycloakUserId },
						);
					}
				}
			} catch (kcErr) {
				authLogger.error(
					handlerName,
					"Keycloak session invalidation failed",
					{ error: String(kcErr) },
				);
			}
		}

		// Forward request to Supabase to revoke Supabase session
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
