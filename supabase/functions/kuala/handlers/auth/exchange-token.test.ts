import { assertEquals } from "jsr:@std/assert";
import { stub } from "jsr:@std/testing/mock";
import { Context } from "jsr:@hono/hono";
import { handleExchangeToken } from "./exchange-token.ts";

// Type definitions for test responses
interface JsonResponse {
	data: Record<string, unknown>;
	status: number;
}

// Mock fetch response
class MockResponse {
	constructor(
		private body: unknown,
		private statusCode: number,
		private isOk: boolean = true,
	) {}

	get ok() {
		return this.isOk;
	}

	get status() {
		return this.statusCode;
	}

	json() {
		return Promise.resolve(this.body);
	}
}

// Helper function to create mock context
function createMockContext(
	requestBody: Record<string, unknown> = {},
	url = "https://kuala-api.example.com/auth/exchange-token",
) {
	return {
		req: {
			json: () => Promise.resolve(requestBody),
			url,
		},
		json: (
			data: Record<string, unknown>,
			status?: number,
		) => ({ data, status } as JsonResponse),
	} as unknown as Context;
}

Deno.test("handleExchangeToken - should return 400 when auth_code is missing", async () => {
	const mockContext = createMockContext({
		code_verifier: "test_verifier",
	});

	const response = await handleExchangeToken(
		mockContext,
	) as unknown as JsonResponse;

	assertEquals(response.status, 400);
	assertEquals(response.data.code, "MISSING_AUTH_CODE");
	assertEquals(response.data.message, "auth_code is required");
});

Deno.test("handleExchangeToken - should return 400 when code_verifier is missing", async () => {
	const mockContext = createMockContext({
		auth_code: "test_auth_code",
	});

	const response = await handleExchangeToken(
		mockContext,
	) as unknown as JsonResponse;

	assertEquals(response.status, 400);
	assertEquals(response.data.code, "MISSING_CODE_VERIFIER");
	assertEquals(response.data.message, "code_verifier is required");
});

Deno.test("handleExchangeToken - should return 500 when AUTH_SUPABASE_ANON_KEY is missing", async () => {
	// Stub environment variable to return undefined
	const envStub = stub(Deno.env, "get", () => undefined);

	try {
		const mockContext = createMockContext({
			auth_code: "test_auth_code",
			code_verifier: "test_verifier",
		});

		const response = await handleExchangeToken(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "MISSING_API_KEY");
		assertEquals(response.data.message, "Supabase API key not configured");
	} finally {
		envStub.restore();
	}
});

Deno.test("handleExchangeToken - should forward successful response from Supabase", async () => {
	// Mock successful Supabase response
	const mockSupabaseResponse = {
		access_token: "test_access_token",
		refresh_token: "test_refresh_token",
		token_type: "bearer",
		expires_in: 3600,
	};

	// Stub environment variables with proper values
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_api_key";
		return undefined;
	});

	// Stub fetch to return successful response
	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(
					mockSupabaseResponse,
					200,
					true,
				) as unknown as Response,
			),
	);

	try {
		const mockContext = createMockContext({
			auth_code: "test_auth_code",
			code_verifier: "test_verifier",
		});

		const response = await handleExchangeToken(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		assertEquals(response.data, mockSupabaseResponse);

		// Verify fetch was called with correct parameters
		assertEquals(fetchStub.calls.length, 1);
		const [url, options] = fetchStub.calls[0].args;
		assertEquals(new URL(url as string).pathname, "/auth/v1/token");
		assertEquals(
			new URL(url as string).searchParams.get("grant_type"),
			"pkce",
		);
		assertEquals((options as RequestInit).method, "POST");
		assertEquals((options as RequestInit).headers, {
			"Content-Type": "application/json",
			"apikey": "test_api_key",
		});
		assertEquals(
			(options as RequestInit).body,
			JSON.stringify({
				auth_code: "test_auth_code",
				code_verifier: "test_verifier",
			}),
		);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleExchangeToken - should forward 400 error from Supabase", async () => {
	// Mock error response from Supabase
	const mockErrorResponse = {
		code: 400,
		error: "invalid_grant",
		msg: "Invalid grant provided",
		error_description: "Invalid authorization code",
	};

	// Stub environment variables with proper values
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_api_key";
		return undefined;
	});

	// Stub fetch to return error response
	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(
					mockErrorResponse,
					400,
					false,
				) as unknown as Response,
			),
	);

	try {
		const mockContext = createMockContext({
			auth_code: "invalid_auth_code",
			code_verifier: "test_verifier",
		});

		const response = await handleExchangeToken(
			mockContext,
		) as unknown as JsonResponse;

		const expectedResponse = {
			code: "SUPABASE_ERROR",
			message: "Invalid authorization code",
		};

		assertEquals(response.status, 400);
		assertEquals(response.data, expectedResponse);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleExchangeToken - should return 500 for non-400 error from Supabase", async () => {
	// Mock server error response from Supabase
	const mockErrorResponse = {
		error: "server_error",
		error_description: "Internal server error",
	};

	// Stub environment variables with proper values
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_api_key";
		return undefined;
	});

	// Stub fetch to return server error
	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(
					mockErrorResponse,
					500,
					false,
				) as unknown as Response,
			),
	);

	try {
		const mockContext = createMockContext({
			auth_code: "test_auth_code",
			code_verifier: "test_verifier",
		});

		const response = await handleExchangeToken(
			mockContext,
		) as unknown as JsonResponse;

		const expectedResponse = {
			code: "SUPABASE_ERROR",
			message: "Internal server error",
		};

		assertEquals(response.status, 500);
		assertEquals(response.data, expectedResponse);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleExchangeToken - should handle fetch error", async () => {
	// Stub environment variables with proper values
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_api_key";
		return undefined;
	});

	// Stub fetch to throw error
	const fetchStub = stub(
		globalThis,
		"fetch",
		() => Promise.reject(new Error("Network error")),
	);

	// Stub console.error to avoid noise in test output
	const consoleStub = stub(console, "error");

	try {
		const mockContext = createMockContext({
			auth_code: "test_auth_code",
			code_verifier: "test_verifier",
		});

		const response = await handleExchangeToken(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "INTERNAL_ERROR");
		assertEquals(response.data.message, "Internal server error");
	} finally {
		envStub.restore();
		fetchStub.restore();
		consoleStub.restore();
	}
});

Deno.test("handleExchangeToken - should handle JSON parsing error", async () => {
	// Mock context that will cause an error when parsing JSON
	const mockContext = {
		req: {
			json: () => {
				throw new Error("Invalid JSON");
			},
			url: "https://kuala-api.example.com/auth/exchange-token",
		},
		json: (
			data: Record<string, unknown>,
			status?: number,
		) => ({ data, status } as JsonResponse),
	} as unknown as Context;

	const response = await handleExchangeToken(
		mockContext,
	) as unknown as JsonResponse;

	assertEquals(response.status, 500);
	assertEquals(response.data.code, "INTERNAL_ERROR");
	assertEquals(response.data.message, "Internal server error");
});

Deno.test("handleExchangeToken - should use fallback URL when AUTH_BASE_URL is not set", async () => {
	// Stub environment variables to return undefined for AUTH_BASE_URL but valid API key
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_api_key";
		return undefined; // AUTH_BASE_URL not set
	});

	// Mock successful Supabase response
	const mockSupabaseResponse = {
		access_token: "test_access_token",
		refresh_token: "test_refresh_token",
		token_type: "bearer",
		expires_in: 3600,
	};

	// Stub fetch to return successful response
	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(
					mockSupabaseResponse,
					200,
					true,
				) as unknown as Response,
			),
	);

	try {
		const mockContext = createMockContext({
			auth_code: "test_auth_code",
			code_verifier: "test_verifier",
		}, "https://kuala-api.example.com/auth/exchange-token");

		const response = await handleExchangeToken(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		assertEquals(response.data, mockSupabaseResponse);

		// Verify fetch was called with fallback URL
		assertEquals(fetchStub.calls.length, 1);
		const [url] = fetchStub.calls[0].args;
		const requestUrl = new URL(url as string);
		assertEquals(requestUrl.origin, "https://kuala-api.example.com");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleExchangeToken - should handle Supabase error without error_description", async () => {
	// Mock error response from Supabase without error_description
	const mockErrorResponse = {
		error: "invalid_grant",
		msg: "Grant is invalid",
	};

	// Stub environment variables with proper values
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_api_key";
		return undefined;
	});

	// Stub fetch to return error response
	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(
					mockErrorResponse,
					400,
					false,
				) as unknown as Response,
			),
	);

	try {
		const mockContext = createMockContext({
			auth_code: "invalid_auth_code",
			code_verifier: "test_verifier",
		});

		const response = await handleExchangeToken(
			mockContext,
		) as unknown as JsonResponse;

		const expectedResponse = {
			code: "SUPABASE_ERROR",
			message: "Grant is invalid",
		};

		assertEquals(response.status, 400);
		assertEquals(response.data, expectedResponse);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleExchangeToken - should handle Supabase error with no message fields", async () => {
	// Mock error response from Supabase with no message
	const mockErrorResponse = {
		error: "unknown_error",
	};

	// Stub environment variables with proper values
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_api_key";
		return undefined;
	});

	// Stub fetch to return error response
	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(
					mockErrorResponse,
					422,
					false,
				) as unknown as Response,
			),
	);

	try {
		const mockContext = createMockContext({
			auth_code: "invalid_auth_code",
			code_verifier: "test_verifier",
		});

		const response = await handleExchangeToken(
			mockContext,
		) as unknown as JsonResponse;

		const expectedResponse = {
			code: "SUPABASE_ERROR",
			message: "Error from Supabase",
		};

		assertEquals(response.status, 422);
		assertEquals(response.data, expectedResponse);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleExchangeToken - should handle response with missing status fallback", async () => {
	// Mock error response without status or code fields
	const mockErrorResponse = {
		error: "unknown_error",
	};

	// Create a response that doesn't have a proper status property
	const mockResponse = {
		ok: false,
		// Deliberately omit status property to test fallback
		json: () => Promise.resolve(mockErrorResponse),
	};

	// Stub environment variables with proper values
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_api_key";
		return undefined;
	});

	// Stub fetch to return malformed response
	const fetchStub = stub(
		globalThis,
		"fetch",
		() => Promise.resolve(mockResponse as unknown as Response),
	);

	try {
		const mockContext = createMockContext({
			auth_code: "test_auth_code",
			code_verifier: "code_verifier",
		});

		const response = await handleExchangeToken(
			mockContext,
		) as unknown as JsonResponse;

		const expectedResponse = {
			code: "SUPABASE_ERROR",
			message: "Error from Supabase",
		};

		// Should fall back to 500 status
		assertEquals(response.status, 500);
		assertEquals(response.data, expectedResponse);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});
