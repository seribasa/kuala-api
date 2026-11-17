import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { Context } from "@hono/hono";
import { handleLogout } from "../../../kuala/handlers/auth/logout.ts";

// Type definitions for test responses
interface JsonResponse {
	data: Record<string, unknown>;
	status: number;
}

interface BodyResponse {
	body: null;
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
	url = "https://kuala-api.example.com/auth/logout",
	bodyData?: unknown,
) {
	return {
		req: {
			header: (name: string) =>
				name === "Authorization" ? authHeader : undefined,
			url,
			json: () => Promise.resolve(bodyData || {}),
		},
		json: (
			data: Record<string, unknown>,
			status?: number,
		) => ({ data, status } as JsonResponse),
		body: (
			body: null,
			status?: number,
		) => ({ body, status } as BodyResponse),
	} as unknown as Context;
}

Deno.test("handleLogout - should return 401 when Authorization header is missing", async () => {
	const mockContext = createMockContext();

	const response = await handleLogout(mockContext) as unknown as JsonResponse;

	assertEquals(response.status, 401);
	assertEquals(response.data.code, "MISSING_AUTHORIZATION");
	assertEquals(response.data.message, "Authorization header is required");
});

Deno.test("handleLogout - should return 500 when AUTH_SUPABASE_ANON_KEY is missing", async () => {
	// Stub environment variable to return undefined
	const envStub = stub(Deno.env, "get", () => undefined);

	try {
		const mockContext = createMockContext("Bearer test_token");

		const response = await handleLogout(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "MISSING_API_KEY");
		assertEquals(response.data.message, "Supabase API key not configured");
	} finally {
		envStub.restore();
	}
});

Deno.test("handleLogout - should return 204 for successful logout", async () => {
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
				new MockResponse(null, 204, true) as unknown as Response,
			),
	);

	try {
		const mockContext = createMockContext("Bearer test_token");

		const response = await handleLogout(
			mockContext,
		) as unknown as BodyResponse;

		assertEquals(response.status, 204);
		assertEquals(response.body, null);

		// Verify fetch was called with correct parameters
		assertEquals(fetchStub.calls.length, 1);
		const [url, options] = fetchStub.calls[0].args;
		assertEquals(new URL(url as string).pathname, "/auth/v1/logout");
		assertEquals((options as RequestInit).method, "POST");
		assertEquals((options as RequestInit).headers, {
			"Authorization": "Bearer test_token",
			"apikey": "test_api_key",
		});
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleLogout - should forward 401 error from Supabase", async () => {
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

		const response = await handleLogout(
			mockContext,
		) as unknown as JsonResponse;

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

Deno.test("handleLogout - should return 500 for other error status from Supabase", async () => {
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

		const response = await handleLogout(
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

Deno.test("handleLogout - should handle fetch error", async () => {
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

		const response = await handleLogout(
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

Deno.test("handleLogout - should handle different Authorization header formats", async () => {
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
				new MockResponse(null, 204, true) as unknown as Response,
			),
	);

	try {
		// Test with different auth header format
		const mockContext = createMockContext("token_without_bearer_prefix");

		const response = await handleLogout(
			mockContext,
		) as unknown as BodyResponse;

		assertEquals(response.status, 204);
		assertEquals(response.body, null);

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

Deno.test("handleLogout - should handle empty Authorization header", async () => {
	const mockContext = createMockContext("");

	const response = await handleLogout(mockContext) as unknown as JsonResponse;

	assertEquals(response.status, 401);
	assertEquals(response.data.code, "MISSING_AUTHORIZATION");
	assertEquals(response.data.message, "Authorization header is required");
});

Deno.test("handleLogout - should use fallback URL when AUTH_BASE_URL is not set", async () => {
	// Stub environment variables to return undefined for AUTH_BASE_URL but valid API key
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_api_key";
		return undefined; // AUTH_BASE_URL not set
	});

	// Stub fetch to return successful logout response
	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(null, 204, true) as unknown as Response,
			),
	);

	try {
		const mockContext = createMockContext(
			"Bearer test_token",
			"https://kuala-api.example.com/auth/logout",
		);

		const response = await handleLogout(
			mockContext,
		) as unknown as BodyResponse;

		assertEquals(response.status, 204);

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

Deno.test("handleLogout - should handle Supabase error without error_description", async () => {
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

		const response = await handleLogout(
			mockContext,
		) as unknown as JsonResponse;

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

Deno.test("handleLogout - should handle Supabase error with no message fields", async () => {
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

		const response = await handleLogout(
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

Deno.test("handleLogout - should trigger Keycloak admin logout when user has keycloak identity and Keycloak is configured", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_api_key";
		if (key === "KEYCLOAK_URL") return "https://identity.example.com/realms/kuala";
		if (key === "KEYCLOAK_CLIENT_ID") return "kuala";
		if (key === "KEYCLOAK_CLIENT_SECRET") return "kuala_secret";
		return undefined;
	});

	const calledUrls: string[] = [];
	const fetchStub = stub(
		globalThis,
		"fetch",
		(input: string | URL | Request) => {
			const urlStr = input.toString();
			calledUrls.push(urlStr);

			// User info endpoint
			if (urlStr.includes("/auth/v1/user")) {
				return Promise.resolve(
					new MockResponse(
						{
							id: "sb_user_1",
							identities: [
								{
									provider: "keycloak",
									identity_data: { sub: "kc_user_123" },
								},
							],
						},
						200,
						true,
					) as unknown as Response,
				);
			}

			// Keycloak token endpoint
			if (urlStr.includes("/protocol/openid-connect/token")) {
				return Promise.resolve(
					new MockResponse(
						{ access_token: "mock_kc_admin_token" },
						200,
						true,
					) as unknown as Response,
				);
			}

			// Keycloak admin logout endpoint
			if (urlStr.includes("/admin/realms/kuala/users/kc_user_123/logout")) {
				return Promise.resolve(
					new MockResponse(null, 204, true) as unknown as Response,
				);
			}

			// Supabase logout endpoint
			if (urlStr.includes("/auth/v1/logout")) {
				return Promise.resolve(
					new MockResponse(null, 204, true) as unknown as Response,
				);
			}

			return Promise.resolve(
				new MockResponse(null, 404, false) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext("Bearer test_token");
		const response = await handleLogout(mockContext) as unknown as BodyResponse;

		assertEquals(response.status, 204);
		assertEquals(response.body, null);

		const hasUserCall = calledUrls.some((u) => u.includes("/auth/v1/user"));
		const hasTokenCall = calledUrls.some((u) => u.includes("/protocol/openid-connect/token"));
		const hasAdminLogoutCall = calledUrls.some((u) => u.includes("/admin/realms/kuala/users/kc_user_123/logout"));
		const hasSupabaseLogoutCall = calledUrls.some((u) => u.includes("/auth/v1/logout"));

		assertEquals(hasUserCall, true);
		assertEquals(hasTokenCall, true);
		assertEquals(hasAdminLogoutCall, true);
		assertEquals(hasSupabaseLogoutCall, true);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleLogout - should trigger Keycloak OIDC logout when refresh_token is provided in body", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_api_key";
		if (key === "KEYCLOAK_URL") return "https://identity.example.com/realms/kuala";
		if (key === "KEYCLOAK_CLIENT_ID") return "kuala";
		if (key === "KEYCLOAK_CLIENT_SECRET") return "kuala_secret";
		return undefined;
	});

	const calledUrls: string[] = [];
	const fetchStub = stub(
		globalThis,
		"fetch",
		(input: string | URL | Request) => {
			const urlStr = input.toString();
			calledUrls.push(urlStr);

			if (urlStr.includes("/protocol/openid-connect/logout")) {
				return Promise.resolve(
					new MockResponse(null, 204, true) as unknown as Response,
				);
			}

			if (urlStr.includes("/auth/v1/user")) {
				return Promise.resolve(
					new MockResponse({ id: "sb_user_1", identities: [] }, 200, true) as unknown as Response,
				);
			}

			if (urlStr.includes("/auth/v1/logout")) {
				return Promise.resolve(
					new MockResponse(null, 204, true) as unknown as Response,
				);
			}

			return Promise.resolve(
				new MockResponse(null, 204, true) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext(
			"Bearer test_token",
			"https://kuala-api.example.com/auth/logout",
			{ refresh_token: "my_keycloak_refresh_token" },
		);
		const response = await handleLogout(mockContext) as unknown as BodyResponse;

		assertEquals(response.status, 204);
		const hasOidcLogoutCall = calledUrls.some((u) => u.includes("/protocol/openid-connect/logout"));
		assertEquals(hasOidcLogoutCall, true);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleLogout - should complete successfully even if Keycloak logout fails", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_api_key";
		if (key === "KEYCLOAK_URL") return "https://identity.example.com/realms/kuala";
		if (key === "KEYCLOAK_CLIENT_ID") return "kuala";
		if (key === "KEYCLOAK_CLIENT_SECRET") return "kuala_secret";
		return undefined;
	});

	const fetchStub = stub(
		globalThis,
		"fetch",
		(input: string | URL | Request) => {
			const urlStr = input.toString();

			if (urlStr.includes("/auth/v1/user")) {
				return Promise.reject(new Error("Network failure reaching user endpoint"));
			}

			if (urlStr.includes("/auth/v1/logout")) {
				return Promise.resolve(
					new MockResponse(null, 204, true) as unknown as Response,
				);
			}

			return Promise.resolve(
				new MockResponse(null, 500, false) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext("Bearer test_token");
		const response = await handleLogout(mockContext) as unknown as BodyResponse;

		assertEquals(response.status, 204);
		assertEquals(response.body, null);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});
