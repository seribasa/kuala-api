import { assertEquals } from "jsr:@std/assert";
import { stub } from "jsr:@std/testing/mock";
import { Context } from "jsr:@hono/hono";
import { handleMe } from "./me.ts";

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
	authHeader?: string,
	url = "https://kuala-api.example.com/auth/me",
) {
	return {
		req: {
			header: (name: string) =>
				name === "Authorization" ? authHeader : undefined,
			url,
		},
		json: (
			data: Record<string, unknown>,
			status?: number,
		) => ({ data, status } as JsonResponse),
	} as unknown as Context;
}

Deno.test("handleMe - should return 401 when Authorization header is missing", async () => {
	const mockContext = createMockContext();

	const response = await handleMe(mockContext) as unknown as JsonResponse;

	assertEquals(response.status, 401);
	assertEquals(response.data.code, "MISSING_AUTHORIZATION");
	assertEquals(response.data.message, "Authorization header is required");
});

Deno.test("handleMe - should return 500 when AUTH_SUPABASE_ANON_KEY is missing", async () => {
	// Stub environment variable to return undefined
	const envStub = stub(Deno.env, "get", () => undefined);

	try {
		const mockContext = createMockContext("Bearer test_token");

		const response = await handleMe(mockContext) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "MISSING_API_KEY");
		assertEquals(response.data.message, "Supabase API key not configured");
	} finally {
		envStub.restore();
	}
});

Deno.test("handleMe - should return user data for successful request", async () => {
	// Mock successful Supabase response
	const mockUserResponse = {
		id: "user123",
		email: "test@example.com",
		created_at: "2023-01-01T00:00:00Z",
		user_metadata: {
			name: "Test User",
		},
		app_metadata: {
			provider: "keycloak",
		},
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
					mockUserResponse,
					200,
					true,
				) as unknown as Response,
			),
	);

	try {
		const mockContext = createMockContext("Bearer test_token");

		const response = await handleMe(mockContext) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		assertEquals(response.data, mockUserResponse);

		// Verify fetch was called with correct parameters
		assertEquals(fetchStub.calls.length, 1);
		const [url, options] = fetchStub.calls[0].args;
		assertEquals(new URL(url as string).pathname, "/auth/v1/user");
		assertEquals((options as RequestInit).method, "GET");
		assertEquals((options as RequestInit).headers, {
			"Authorization": "Bearer test_token",
			"apikey": "test_api_key",
		});
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleMe - should forward 401 error from Supabase", async () => {
	// Mock 401 error response from Supabase
	const mockErrorResponse = {
		error: "invalid_token",
		error_description: "Invalid or expired token",
	};

	// Stub environment variables with proper values
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_api_key";
		return undefined;
	});

	// Stub fetch to return 401 error
	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(
					mockErrorResponse,
					401,
					false,
				) as unknown as Response,
			),
	);

	try {
		const mockContext = createMockContext("Bearer invalid_token");

		const response = await handleMe(mockContext) as unknown as JsonResponse;

		const expectedResponse = {
			code: "SUPABASE_ERROR",
			message: "Invalid or expired token",
		};

		assertEquals(response.status, 401);
		assertEquals(response.data, expectedResponse);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleMe - should return 500 for other error status from Supabase", async () => {
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
		const mockContext = createMockContext("Bearer test_token");

		const response = await handleMe(mockContext) as unknown as JsonResponse;

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

Deno.test("handleMe - should handle fetch error", async () => {
	// Stub environment variable
	const envStub = stub(Deno.env, "get", () => "test_api_key");

	// Stub fetch to throw error
	const fetchStub = stub(
		globalThis,
		"fetch",
		() => Promise.reject(new Error("Network error")),
	);

	// Stub console.error to avoid noise in test output
	const consoleStub = stub(console, "error");

	try {
		const mockContext = createMockContext("Bearer test_token");

		const response = await handleMe(mockContext) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "INTERNAL_ERROR");
		assertEquals(response.data.message, "Internal server error");
	} finally {
		envStub.restore();
		fetchStub.restore();
		consoleStub.restore();
	}
});

Deno.test("handleMe - should handle different Authorization header formats", async () => {
	// Mock successful user response
	const mockUserResponse = {
		id: "user123",
		email: "test@example.com",
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
					mockUserResponse,
					200,
					true,
				) as unknown as Response,
			),
	);

	try {
		// Test with different auth header format
		const mockContext = createMockContext("token_without_bearer_prefix");

		const response = await handleMe(mockContext) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		assertEquals(response.data, mockUserResponse);

		// Verify the authorization header was passed through correctly
		const [, options] = fetchStub.calls[0].args;
		assertEquals((options as RequestInit).headers, {
			"Authorization": "token_without_bearer_prefix",
			"apikey": "test_api_key",
		});
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleMe - should handle empty Authorization header", async () => {
	const mockContext = createMockContext("");

	const response = await handleMe(mockContext) as unknown as JsonResponse;

	assertEquals(response.status, 401);
	assertEquals(response.data.code, "MISSING_AUTHORIZATION");
	assertEquals(response.data.message, "Authorization header is required");
});

Deno.test("handleMe - should handle malformed JSON response from Supabase", async () => {
	// Stub environment variable
	const envStub = stub(Deno.env, "get", () => "test_api_key");

	// Create a response that will fail JSON parsing
	const mockResponse = {
		ok: true,
		status: 200,
		json: () => Promise.reject(new Error("Invalid JSON")),
	};

	// Stub fetch to return malformed response
	const fetchStub = stub(
		globalThis,
		"fetch",
		() => Promise.resolve(mockResponse as unknown as Response),
	);

	// Stub console.error to avoid noise in test output
	const consoleStub = stub(console, "error");

	try {
		const mockContext = createMockContext("Bearer test_token");

		const response = await handleMe(mockContext) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "INTERNAL_ERROR");
		assertEquals(response.data.message, "Internal server error");
	} finally {
		envStub.restore();
		fetchStub.restore();
		consoleStub.restore();
	}
});

Deno.test("handleMe - should use fallback URL when AUTH_BASE_URL is not set", async () => {
	// Mock user response
	const mockUserResponse = {
		id: "user123",
		email: "test@example.com",
	};

	// Stub environment variables to return undefined for AUTH_BASE_URL but valid API key
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_api_key";
		return undefined; // AUTH_BASE_URL not set
	});

	// Stub fetch to return successful response
	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(
					mockUserResponse,
					200,
					true,
				) as unknown as Response,
			),
	);

	try {
		const mockContext = createMockContext(
			"Bearer test_token",
			"https://kuala-api.example.com/auth/me",
		);

		const response = await handleMe(mockContext) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		assertEquals(response.data, mockUserResponse);

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

Deno.test("handleMe - should handle Supabase error without error_description", async () => {
	// Mock error response from Supabase without error_description
	const mockErrorResponse = {
		error: "invalid_token",
		msg: "Token is invalid",
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
					401,
					false,
				) as unknown as Response,
			),
	);

	try {
		const mockContext = createMockContext("Bearer invalid_token");

		const response = await handleMe(mockContext) as unknown as JsonResponse;

		const expectedResponse = {
			code: "SUPABASE_ERROR",
			message: "Token is invalid",
		};

		assertEquals(response.status, 401);
		assertEquals(response.data, expectedResponse);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleMe - should handle Supabase error with no message fields", async () => {
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
		const mockContext = createMockContext("Bearer test_token");

		const response = await handleMe(mockContext) as unknown as JsonResponse;

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
