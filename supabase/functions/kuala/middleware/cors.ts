import type { Context, Next } from "@hono/hono";
import { getAllowedOrigin, getCorsConfig } from "../../_shared/cors-headers.ts";


/**
 * CORS Middleware
 *
 * Handles CORS headers based on environment configuration.
 * If CORS_ENABLED=false, middleware is bypassed and CORS should be handled
 * at proxy/load balancer level.
 */
export async function corsMiddleware(c: Context, next: Next) {
	const config = getCorsConfig();

	// If CORS is disabled, skip middleware - CORS should be handled by proxy/load balancer
	if (!config.enabled) {
		await next();
		return;
	}

	// Handle preflight OPTIONS request
	if (c.req.method === "OPTIONS") {
		// Check if origin is allowed
		const requestOrigin = c.req.header("Origin");
		const allowedOrigin = getAllowedOrigin(requestOrigin, config.origin);

		if (allowedOrigin) {
			c.res.headers.set("Access-Control-Allow-Origin", allowedOrigin);
			c.res.headers.set(
				"Access-Control-Allow-Headers",
				"authorization, x-client-info, apikey, content-type",
			);
			c.res.headers.set(
				"Access-Control-Allow-Methods",
				"GET,POST,PUT,DELETE",
			);
			c.res.headers.set("Access-Control-Max-Age", "86400"); // 24 hours
		}

		return c.body(null, 204);
	}

	await next();

	// Set CORS headers for actual requests
	const requestOrigin = c.req.header("Origin");
	const allowedOrigin = getAllowedOrigin(requestOrigin, config.origin);

	if (allowedOrigin) {
		c.res.headers.set("Access-Control-Allow-Origin", allowedOrigin);
		c.res.headers.set(
			"Access-Control-Allow-Headers",
			"authorization, x-client-info, apikey, content-type",
		);
		c.res.headers.set(
			"Access-Control-Allow-Methods",
			"GET,POST,PUT,DELETE",
		);
	}
}