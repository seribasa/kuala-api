import { assertEquals } from "@std/assert";
import { Hono } from "@hono/hono";
import { corsMiddleware } from "../../kuala/middleware/cors.ts";

/**
 * Integration tests for CORS middleware
 * Tests actual HTTP requests and responses with CORS headers
 */

// Helper to create test app
function createTestApp(corsEnabled: string = "true", corsOrigin: string = "*") {
	// Set environment variables
	Deno.env.set("CORS_ENABLED", corsEnabled);
	Deno.env.set("CORS_ORIGIN", corsOrigin);

	const app = new Hono();

	// Apply CORS middleware
	app.use("*", corsMiddleware);

	// Test endpoints
	app.get("/api/test", (c) => {
		return c.json({ message: "success" });
	});

	app.post("/api/test", (c) => {
		return c.json({ message: "created" });
	});

	return app;
}

// Helper to make test request
async function makeRequest(
	app: Hono,
	method: string,
	path: string,
	headers: Record<string, string> = {},
) {
	const req = new Request(`http://localhost${path}`, {
		method,
		headers,
	});

	return await app.fetch(req);
}

Deno.test("Integration - CORS disabled should not add headers", async () => {
	const app = createTestApp("false", "*");

	const response = await makeRequest(app, "GET", "/api/test", {
		Origin: "http://localhost:4200",
	});

	assertEquals(response.status, 200);
	assertEquals(response.headers.has("Access-Control-Allow-Origin"), false);

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - OPTIONS preflight with wildcard origin", async () => {
	const app = createTestApp("true", "*");

	const response = await makeRequest(app, "OPTIONS", "/api/test", {
		Origin: "http://localhost:4200",
		"Access-Control-Request-Method": "POST",
	});

	assertEquals(response.status, 204);
	assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
	assertEquals(
		response.headers.get("Access-Control-Allow-Headers"),
		"authorization, x-client-info, apikey, content-type",
	);
	assertEquals(
		response.headers.get("Access-Control-Allow-Methods"),
		"GET,POST,PUT,DELETE",
	);
	assertEquals(response.headers.get("Access-Control-Max-Age"), "86400");

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - GET request with wildcard origin", async () => {
	const app = createTestApp("true", "*");

	const response = await makeRequest(app, "GET", "/api/test", {
		Origin: "http://localhost:4200",
	});

	assertEquals(response.status, 200);

	const data = await response.json();
	assertEquals(data.message, "success");

	assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
	assertEquals(
		response.headers.get("Access-Control-Allow-Headers"),
		"authorization, x-client-info, apikey, content-type",
	);
	assertEquals(
		response.headers.get("Access-Control-Allow-Methods"),
		"GET,POST,PUT,DELETE",
	);

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - POST request with wildcard origin", async () => {
	const app = createTestApp("true", "*");

	const response = await makeRequest(app, "POST", "/api/test", {
		Origin: "http://localhost:4200",
		"Content-Type": "application/json",
	});

	assertEquals(response.status, 200);

	const data = await response.json();
	assertEquals(data.message, "created");

	assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - Specific origin allowed", async () => {
	const app = createTestApp("true", "http://localhost:4200");

	const response = await makeRequest(app, "GET", "/api/test", {
		Origin: "http://localhost:4200",
	});

	assertEquals(response.status, 200);
	assertEquals(
		response.headers.get("Access-Control-Allow-Origin"),
		"http://localhost:4200",
	);

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - Specific origin not allowed", async () => {
	const app = createTestApp("true", "http://localhost:4200");

	const response = await makeRequest(app, "GET", "/api/test", {
		Origin: "http://evil.com",
	});

	assertEquals(response.status, 200);
	// Should NOT have CORS headers for disallowed origin
	assertEquals(response.headers.has("Access-Control-Allow-Origin"), false);

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - Multiple origins (first origin)", async () => {
	const app = createTestApp(
		"true",
		"http://localhost:4200,https://kuala-staging.seribasa.digital,https://kuala.seribasa.digital",
	);

	const response = await makeRequest(app, "GET", "/api/test", {
		Origin: "http://localhost:4200",
	});

	assertEquals(response.status, 200);
	assertEquals(
		response.headers.get("Access-Control-Allow-Origin"),
		"http://localhost:4200",
	);

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - Multiple origins (middle origin)", async () => {
	const app = createTestApp(
		"true",
		"http://localhost:4200,https://kuala-staging.seribasa.digital,https://kuala.seribasa.digital",
	);

	const response = await makeRequest(app, "GET", "/api/test", {
		Origin: "https://kuala-staging.seribasa.digital",
	});

	assertEquals(response.status, 200);
	assertEquals(
		response.headers.get("Access-Control-Allow-Origin"),
		"https://kuala-staging.seribasa.digital",
	);

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - Multiple origins (last origin)", async () => {
	const app = createTestApp(
		"true",
		"http://localhost:4200,https://kuala-staging.seribasa.digital,https://kuala.seribasa.digital",
	);

	const response = await makeRequest(app, "GET", "/api/test", {
		Origin: "https://kuala.seribasa.digital",
	});

	assertEquals(response.status, 200);
	assertEquals(
		response.headers.get("Access-Control-Allow-Origin"),
		"https://kuala.seribasa.digital",
	);

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - Multiple origins (not in list)", async () => {
	const app = createTestApp(
		"true",
		"http://localhost:4200,https://kuala-staging.seribasa.digital,https://kuala.seribasa.digital",
	);

	const response = await makeRequest(app, "GET", "/api/test", {
		Origin: "https://evil.com",
	});

	assertEquals(response.status, 200);
	assertEquals(response.headers.has("Access-Control-Allow-Origin"), false);

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - Request without Origin header", async () => {
	const app = createTestApp("true", "http://localhost:4200");

	const response = await makeRequest(app, "GET", "/api/test");

	assertEquals(response.status, 200);
	// Should not add CORS headers when no Origin header
	assertEquals(response.headers.has("Access-Control-Allow-Origin"), false);

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - OPTIONS without Origin header (wildcard)", async () => {
	const app = createTestApp("true", "*");

	const response = await makeRequest(app, "OPTIONS", "/api/test");

	assertEquals(response.status, 204);
	// Wildcard should still be set even without Origin
	assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - OPTIONS without Origin header (specific origin)", async () => {
	const app = createTestApp("true", "http://localhost:4200");

	const response = await makeRequest(app, "OPTIONS", "/api/test");

	assertEquals(response.status, 204);
	// Should NOT set CORS headers when no Origin and not wildcard
	assertEquals(response.headers.has("Access-Control-Allow-Origin"), false);

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - Default values (no env vars set)", async () => {
	// Ensure env vars are not set
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");

	const app = new Hono();
	app.use("*", corsMiddleware);
	app.get("/api/test", (c) => c.json({ message: "success" }));

	const response = await makeRequest(app, "GET", "/api/test", {
		Origin: "http://localhost:4200",
	});

	assertEquals(response.status, 200);
	// Default should be enabled with wildcard
	assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("Integration - Full CORS flow (preflight + actual request)", async () => {
	const app = createTestApp("true", "http://localhost:4200");

	// Step 1: Preflight OPTIONS request
	const preflightResponse = await makeRequest(app, "OPTIONS", "/api/test", {
		Origin: "http://localhost:4200",
		"Access-Control-Request-Method": "POST",
		"Access-Control-Request-Headers": "content-type,authorization",
	});

	assertEquals(preflightResponse.status, 204);
	assertEquals(
		preflightResponse.headers.get("Access-Control-Allow-Origin"),
		"http://localhost:4200",
	);
	assertEquals(
		preflightResponse.headers.get("Access-Control-Allow-Methods"),
		"GET,POST,PUT,DELETE",
	);

	// Step 2: Actual POST request
	const actualResponse = await makeRequest(app, "POST", "/api/test", {
		Origin: "http://localhost:4200",
		"Content-Type": "application/json",
	});

	assertEquals(actualResponse.status, 200);
	assertEquals(
		actualResponse.headers.get("Access-Control-Allow-Origin"),
		"http://localhost:4200",
	);

	const data = await actualResponse.json();
	assertEquals(data.message, "created");

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - CORS with different HTTP methods", async () => {
	const app = createTestApp("true", "*");

	// Test various methods
	const methods = ["GET", "POST", "PUT", "DELETE"];

	for (const method of methods) {
		const response = await makeRequest(app, method, "/api/test", {
			Origin: "http://localhost:4200",
		});

		// All should have CORS headers
		assertEquals(
			response.headers.get("Access-Control-Allow-Origin"),
			"*",
			`Method ${method} should have CORS headers`,
		);
	}

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - Production scenario with multiple domains", async () => {
	// Simulate production with multiple allowed domains
	const app = createTestApp(
		"true",
		"https://kuala.seribasa.digital,https://app.seribasa.digital,https://admin.seribasa.digital",
	);

	// Test main domain
	const mainResponse = await makeRequest(app, "GET", "/api/test", {
		Origin: "https://kuala.seribasa.digital",
	});
	assertEquals(mainResponse.status, 200);
	assertEquals(
		mainResponse.headers.get("Access-Control-Allow-Origin"),
		"https://kuala.seribasa.digital",
	);

	// Test app subdomain
	const appResponse = await makeRequest(app, "GET", "/api/test", {
		Origin: "https://app.seribasa.digital",
	});
	assertEquals(appResponse.status, 200);
	assertEquals(
		appResponse.headers.get("Access-Control-Allow-Origin"),
		"https://app.seribasa.digital",
	);

	// Test admin subdomain
	const adminResponse = await makeRequest(app, "GET", "/api/test", {
		Origin: "https://admin.seribasa.digital",
	});
	assertEquals(adminResponse.status, 200);
	assertEquals(
		adminResponse.headers.get("Access-Control-Allow-Origin"),
		"https://admin.seribasa.digital",
	);

	// Test unauthorized domain
	const evilResponse = await makeRequest(app, "GET", "/api/test", {
		Origin: "https://evil.com",
	});
	assertEquals(evilResponse.status, 200);
	assertEquals(
		evilResponse.headers.has("Access-Control-Allow-Origin"),
		false,
	);

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - Staging scenario with single domain", async () => {
	const app = createTestApp("true", "https://kuala-staging.seribasa.digital");

	// Test allowed staging domain
	const stagingResponse = await makeRequest(app, "GET", "/api/test", {
		Origin: "https://kuala-staging.seribasa.digital",
	});
	assertEquals(stagingResponse.status, 200);
	assertEquals(
		stagingResponse.headers.get("Access-Control-Allow-Origin"),
		"https://kuala-staging.seribasa.digital",
	);

	// Test production domain (should be blocked)
	const prodResponse = await makeRequest(app, "GET", "/api/test", {
		Origin: "https://kuala.seribasa.digital",
	});
	assertEquals(prodResponse.status, 200);
	assertEquals(
		prodResponse.headers.has("Access-Control-Allow-Origin"),
		false,
	);

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});

Deno.test("Integration - Proxy mode (CORS disabled)", async () => {
	const app = createTestApp("false", "*");

	// When CORS is disabled, OPTIONS requests are passed through to handlers
	// Since our test app doesn't have OPTIONS handler, it returns 404
	// In real scenario, proxy/load balancer handles CORS before reaching the app
	const preflightResponse = await makeRequest(app, "OPTIONS", "/api/test", {
		Origin: "http://localhost:4200",
	});
	assertEquals(preflightResponse.status, 404); // No OPTIONS handler in test app
	assertEquals(
		preflightResponse.headers.has("Access-Control-Allow-Origin"),
		false,
	);

	// GET request - should work but no CORS headers
	const getResponse = await makeRequest(app, "GET", "/api/test", {
		Origin: "http://localhost:4200",
	});
	assertEquals(getResponse.status, 200);
	assertEquals(getResponse.headers.has("Access-Control-Allow-Origin"), false);

	// POST request - should work but no CORS headers
	const postResponse = await makeRequest(app, "POST", "/api/test", {
		Origin: "http://localhost:4200",
	});
	assertEquals(postResponse.status, 200);
	assertEquals(
		postResponse.headers.has("Access-Control-Allow-Origin"),
		false,
	);

	// Cleanup
	Deno.env.delete("CORS_ENABLED");
	Deno.env.delete("CORS_ORIGIN");
});
