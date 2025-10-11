import type { Context, Next } from "@hono/hono";
import { corsHeaders } from "../../_shared/cors-headers.ts";

export async function corsMiddleware(c: Context, next: Next) {
	for (const [key, value] of Object.entries(corsHeaders)) {
		c.header(key, value);
	}
	c.header(
		"Access-Control-Allow-Methods",
		"GET,POST,PUT,DELETE",
	);

	if (c.req.method === "OPTIONS") {
		return c.body(null, 204);
	}

	await next();

	for (const [key, value] of Object.entries(corsHeaders)) {
		c.res.headers.set(key, value);
	}
	c.res.headers.set(
		"Access-Control-Allow-Methods",
		"GET,POST,PUT,DELETE",
	);
}
