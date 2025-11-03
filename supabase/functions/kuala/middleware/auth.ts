import { Context, Next } from "@hono/hono";
import { ErrorResponse } from "../../_shared/types/response.ts";
import type { AuthenticatedUser } from "../../_shared/types/index.ts";
import { logger } from "./logger.ts";

/**
 * Get user from Authorization header by calling Supabase /auth/v1/user
 */
async function getAuthenticatedUser(
	authorization: string,
	c: Context,
): Promise<AuthenticatedUser | null> {
	const handlerName = "authMiddleware";
	const supabaseBaseUrl = Deno.env.get("AUTH_BASE_URL") || c.req.url;
	const supabaseUserUrl = new URL("/auth/v1/user", supabaseBaseUrl);
	const apikey = Deno.env.get("AUTH_SUPABASE_ANON_KEY");

	if (!apikey) {
		logger.error(handlerName, "Missing API key");
		return null;
	}

	logger.info(handlerName, "Fetching authenticated user", {
		url: supabaseUserUrl.toString(),
	});

	try {
		const response = await fetch(supabaseUserUrl.toString(), {
			method: "GET",
			headers: {
				"Authorization": authorization,
				"apikey": apikey,
			},
		});

		if (!response.ok) {
			logger.error(handlerName, "Failed to get user from Supabase", {
				status: response.status,
			});
			return null;
		}

		const user = await response.json();
		logger.info(handlerName, "User retrieved successfully", {
			userId: user.id,
			email: user.email,
		});

		return user as AuthenticatedUser;
	} catch (error) {
		logger.error(handlerName, "Error fetching authenticated user", {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/**
 * Middleware to authenticate user and attach to context
 * Usage: app.use("/protected-route", authMiddleware)
 */
export async function authMiddleware(c: Context, next: Next) {
	const handlerName = "authMiddleware";

	// 1. Check authorization header
	const authorization = c.req.header("Authorization");
	if (!authorization) {
		logger.error(handlerName, "Missing authorization header");
		const errorResponse: ErrorResponse = {
			code: "MISSING_AUTHORIZATION",
			message: "Authorization header is required",
		};
		return c.json(errorResponse, 401);
	}

	// 2. Get authenticated user
	const user = await getAuthenticatedUser(authorization, c);
	if (!user || !user.id || !user.email) {
		logger.error(handlerName, "Failed to get authenticated user");
		const errorResponse: ErrorResponse = {
			code: "UNAUTHORIZED",
			message: "Invalid or expired token",
		};
		return c.json(errorResponse, 401);
	}

	// 3. Attach user to context
	c.set("user", user);

	logger.info(handlerName, "User authenticated successfully", {
		userId: user.id,
		email: user.email,
	});

	await next();
}

/**
 * Helper function to get authenticated user from context
 * Usage: const user = getUser(c)
 */
export function getUser(c: Context): AuthenticatedUser {
	const user = c.get("user");
	if (!user) {
		throw new Error(
			"User not found in context. Did you apply authMiddleware?",
		);
	}
	return user as AuthenticatedUser;
}
