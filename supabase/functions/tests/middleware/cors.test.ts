// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { Context } from "@hono/hono";
import { corsMiddleware } from "../../kuala/middleware/cors.ts";

// Helper to create mock context
function createMockContext(
	method: string,
	headers: Record<string, string> = {},
) {
	const responseHeaders = new Headers();
	const requestHeaders = new Headers();

	Object.entries(headers).forEach(([key, value]) => {
		requestHeaders.set(key, value);
	});

	return {
		req: {
			method,
			header: (name: string) => requestHeaders.get(name) || undefined,
		},
		res: {
			headers: responseHeaders,
		},
		body: (data: unknown, status?: number) =>
			new Response(data as BodyInit, {
				status: status || 200,
			}),
	} as unknown as Context;
}

Deno.test("corsMiddleware - should skip CORS when CORS_ENABLED=false", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "CORS_ENABLED") return "false";
		return undefined;
	});

	const context = createMockContext("GET", {
		Origin: "http://localhost:4200",
	});
	let nextCalled = false;

	await corsMiddleware(context, async () => {
		nextCalled = true;
	});

	// Should call next
	assertEquals(nextCalled, true);

	// Should NOT set CORS headers
	assertEquals(context.res.headers.has("Access-Control-Allow-Origin"), false);

	envStub.restore();
});

Deno.test("corsMiddleware - should handle OPTIONS with wildcard origin", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "CORS_ENABLED") return "true";
		if (key === "CORS_ORIGIN") return "*";
		return undefined;
	});

	const context = createMockContext("OPTIONS", {
		Origin: "http://localhost:4200",
	});

	const response = await corsMiddleware(context, async () => {});

	// Should return 204
	assertEquals(response?.status, 204);

	// Should set wildcard CORS headers
	assertEquals(context.res.headers.get("Access-Control-Allow-Origin"), "*");
	assertEquals(
		context.res.headers.get("Access-Control-Allow-Headers"),
		"authorization, x-client-info, apikey, content-type",
	);
	assertEquals(
		context.res.headers.get("Access-Control-Allow-Methods"),
		"GET,POST,PUT,DELETE",
	);
	assertEquals(context.res.headers.get("Access-Control-Max-Age"), "86400");

	envStub.restore();
});

Deno.test("corsMiddleware - should handle OPTIONS with specific origin (allowed)", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "CORS_ENABLED") return "true";
		if (key === "CORS_ORIGIN") return "http://localhost:4200";
		return undefined;
	});

	const context = createMockContext("OPTIONS", {
		Origin: "http://localhost:4200",
	});

	const response = await corsMiddleware(context, async () => {});

	// Should return 204
	assertEquals(response?.status, 204);

	// Should set matching origin
	assertEquals(
		context.res.headers.get("Access-Control-Allow-Origin"),
		"http://localhost:4200",
	);

	envStub.restore();
});

Deno.test("corsMiddleware - should handle OPTIONS with specific origin (not allowed)", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "CORS_ENABLED") return "true";
		if (key === "CORS_ORIGIN") return "http://localhost:4200";
		return undefined;
	});

	const context = createMockContext("OPTIONS", { Origin: "http://evil.com" });

	const response = await corsMiddleware(context, async () => {});

	// Should return 204 but without CORS headers
	assertEquals(response?.status, 204);
	assertEquals(context.res.headers.has("Access-Control-Allow-Origin"), false);

	envStub.restore();
});

Deno.test("corsMiddleware - should handle OPTIONS with multiple origins (allowed)", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "CORS_ENABLED") return "true";
		if (key === "CORS_ORIGIN") {
			return "http://localhost:4200,https://kuala-staging.seribasa.digital,https://kuala.seribasa.digital";
		}
		return undefined;
	});

	const context = createMockContext("OPTIONS", {
		Origin: "https://kuala-staging.seribasa.digital",
	});

	const response = await corsMiddleware(context, async () => {});

	// Should return 204
	assertEquals(response?.status, 204);

	// Should set matching origin
	assertEquals(
		context.res.headers.get("Access-Control-Allow-Origin"),
		"https://kuala-staging.seribasa.digital",
	);

	envStub.restore();
});

Deno.test("corsMiddleware - should handle GET request with wildcard origin", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "CORS_ENABLED") return "true";
		if (key === "CORS_ORIGIN") return "*";
		return undefined;
	});

	const context = createMockContext("GET", {
		Origin: "http://localhost:4200",
	});
	let nextCalled = false;

	await corsMiddleware(context, async () => {
		nextCalled = true;
	});

	// Should call next
	assertEquals(nextCalled, true);

	// Should set wildcard CORS headers
	assertEquals(context.res.headers.get("Access-Control-Allow-Origin"), "*");
	assertEquals(
		context.res.headers.get("Access-Control-Allow-Headers"),
		"authorization, x-client-info, apikey, content-type",
	);
	assertEquals(
		context.res.headers.get("Access-Control-Allow-Methods"),
		"GET,POST,PUT,DELETE",
	);

	envStub.restore();
});

Deno.test("corsMiddleware - should handle GET request with specific origin (allowed)", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "CORS_ENABLED") return "true";
		if (key === "CORS_ORIGIN") return "http://localhost:4200";
		return undefined;
	});

	const context = createMockContext("GET", {
		Origin: "http://localhost:4200",
	});
	let nextCalled = false;

	await corsMiddleware(context, async () => {
		nextCalled = true;
	});

	// Should call next
	assertEquals(nextCalled, true);

	// Should set matching origin
	assertEquals(
		context.res.headers.get("Access-Control-Allow-Origin"),
		"http://localhost:4200",
	);

	envStub.restore();
});

Deno.test("corsMiddleware - should handle GET request with specific origin (not allowed)", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "CORS_ENABLED") return "true";
		if (key === "CORS_ORIGIN") return "http://localhost:4200";
		return undefined;
	});

	const context = createMockContext("GET", { Origin: "http://evil.com" });
	let nextCalled = false;

	await corsMiddleware(context, async () => {
		nextCalled = true;
	});

	// Should call next
	assertEquals(nextCalled, true);

	// Should NOT set CORS headers for disallowed origin
	assertEquals(context.res.headers.has("Access-Control-Allow-Origin"), false);

	envStub.restore();
});

Deno.test("corsMiddleware - should handle request without Origin header", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "CORS_ENABLED") return "true";
		if (key === "CORS_ORIGIN") return "http://localhost:4200";
		return undefined;
	});

	const context = createMockContext("GET");
	let nextCalled = false;

	await corsMiddleware(context, async () => {
		nextCalled = true;
	});

	// Should call next
	assertEquals(nextCalled, true);

	// Should NOT set CORS headers when no Origin
	assertEquals(context.res.headers.has("Access-Control-Allow-Origin"), false);

	envStub.restore();
});

Deno.test("corsMiddleware - should use default values when env vars not set", async () => {
	const envStub = stub(Deno.env, "get", (_key: string) => {
		return undefined; // No env vars set
	});

	const context = createMockContext("GET", {
		Origin: "http://localhost:4200",
	});
	let nextCalled = false;

	await corsMiddleware(context, async () => {
		nextCalled = true;
	});

	// Should call next (default enabled=true)
	assertEquals(nextCalled, true);

	// Should set wildcard origin (default CORS_ORIGIN=*)
	assertEquals(context.res.headers.get("Access-Control-Allow-Origin"), "*");

	envStub.restore();
});

Deno.test("corsMiddleware - should handle POST request with multiple origins", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "CORS_ENABLED") return "true";
		if (key === "CORS_ORIGIN") {
			return "http://localhost:4200,https://kuala.seribasa.digital";
		}
		return undefined;
	});

	const context = createMockContext("POST", {
		Origin: "https://kuala.seribasa.digital",
	});
	let nextCalled = false;

	await corsMiddleware(context, async () => {
		nextCalled = true;
	});

	// Should call next
	assertEquals(nextCalled, true);

	// Should set matching origin
	assertEquals(
		context.res.headers.get("Access-Control-Allow-Origin"),
		"https://kuala.seribasa.digital",
	);

	envStub.restore();
});
