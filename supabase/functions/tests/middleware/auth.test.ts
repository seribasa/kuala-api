// deno-lint-ignore-file require-await no-explicit-any
import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { Context, Next } from "@hono/hono";
import { authMiddleware, getUser } from "../../kuala/middleware/auth.ts";

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

	text() {
		return Promise.resolve(JSON.stringify(this.body));
	}
}

// Helper to create mock context
function createMockContext(
	authHeader?: string,
	url = "https://api.example.com/test",
) {
	const contextData = new Map();
	const responseData: { status?: number; body?: unknown } = {};

	return {
		req: {
			header: (name: string) =>
				name === "Authorization" ? authHeader : undefined,
			url,
		},
		json: (data: unknown, status?: number) => {
			responseData.body = data;
			responseData.status = status;
			return { data, status };
		},
		get: (key: string) => contextData.get(key),
		set: (key: string, value: unknown) => contextData.set(key, value),
		getResponse: () => responseData,
	} as unknown as Context;
}

Deno.test("authMiddleware - should return 401 when Authorization header is missing", async () => {
	const mockContext = createMockContext();
	let nextCalled = false;
	const next: Next = async () => {
		nextCalled = true;
	};

	const response = await authMiddleware(mockContext, next);

	assertEquals(nextCalled, false);
	assertEquals((response as any).status, 401);
	assertEquals((response as any).data.code, "MISSING_AUTHORIZATION");
});

Deno.test("authMiddleware - should return 401 when AUTH_SUPABASE_ANON_KEY is missing", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		return undefined; // No API key
	});

	const mockContext = createMockContext("Bearer token");
	let nextCalled = false;
	const next: Next = async () => {
		nextCalled = true;
	};

	try {
		const response = await authMiddleware(mockContext, next);

		assertEquals(nextCalled, false);
		assertEquals((response as any).status, 401);
		assertEquals((response as any).data.code, "UNAUTHORIZED");
	} finally {
		envStub.restore();
	}
});

Deno.test("authMiddleware - should return 401 when Supabase returns error", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_key";
		return undefined;
	});

	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(
					{ error: "Unauthorized" },
					401,
					false,
				) as unknown as Response,
			),
	);

	const mockContext = createMockContext("Bearer invalid_token");
	let nextCalled = false;
	const next: Next = async () => {
		nextCalled = true;
	};

	try {
		const response = await authMiddleware(mockContext, next);

		assertEquals(nextCalled, false);
		assertEquals((response as any).status, 401);
		assertEquals((response as any).data.code, "UNAUTHORIZED");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("authMiddleware - should return 401 when user has no id", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_key";
		return undefined;
	});

	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(
					{ email: "test@example.com" },
					200,
				) as unknown as Response,
			),
	);

	const mockContext = createMockContext("Bearer valid_token");
	let nextCalled = false;
	const next: Next = async () => {
		nextCalled = true;
	};

	try {
		const response = await authMiddleware(mockContext, next);

		assertEquals(nextCalled, false);
		assertEquals((response as any).status, 401);
		assertEquals((response as any).data.code, "UNAUTHORIZED");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("authMiddleware - should return 401 when user has no email", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_key";
		return undefined;
	});

	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse({ id: "user123" }, 200) as unknown as Response,
			),
	);

	const mockContext = createMockContext("Bearer valid_token");
	let nextCalled = false;
	const next: Next = async () => {
		nextCalled = true;
	};

	try {
		const response = await authMiddleware(mockContext, next);

		assertEquals(nextCalled, false);
		assertEquals((response as any).status, 401);
		assertEquals((response as any).data.code, "UNAUTHORIZED");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("authMiddleware - should handle fetch error gracefully", async () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_key";
		return undefined;
	});

	const fetchStub = stub(
		globalThis,
		"fetch",
		() => Promise.reject(new Error("Network error")),
	);

	const mockContext = createMockContext("Bearer valid_token");
	let nextCalled = false;
	const next: Next = async () => {
		nextCalled = true;
	};

	try {
		const response = await authMiddleware(mockContext, next);

		assertEquals(nextCalled, false);
		assertEquals((response as any).status, 401);
		assertEquals((response as any).data.code, "UNAUTHORIZED");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("authMiddleware - should authenticate successfully and call next", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
		aud: "authenticated",
		role: "authenticated",
	};

	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
		if (key === "AUTH_SUPABASE_ANON_KEY") return "test_key";
		return undefined;
	});

	const fetchStub = stub(
		globalThis,
		"fetch",
		() =>
			Promise.resolve(
				new MockResponse(mockUser, 200) as unknown as Response,
			),
	);

	const mockContext = createMockContext("Bearer valid_token");
	let nextCalled = false;
	const next: Next = async () => {
		nextCalled = true;
	};

	try {
		await authMiddleware(mockContext, next);

		assertEquals(nextCalled, true);
		const user = mockContext.get("user");
		assertEquals(user.id, "user123");
		assertEquals(user.email, "test@example.com");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("getUser - should throw error when user not in context", () => {
	const mockContext = createMockContext();

	let errorThrown = false;
	try {
		getUser(mockContext);
	} catch (error) {
		errorThrown = true;
		assertEquals(error instanceof Error, true);
		assertEquals(
			(error as Error).message,
			"User not found in context. Did you apply authMiddleware?",
		);
	}

	assertEquals(errorThrown, true);
});

Deno.test("getUser - should return user from context", () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const contextData = new Map();
	contextData.set("user", mockUser);

	const mockContext = {
		get: (key: string) => contextData.get(key),
	} as unknown as Context;

	const user = getUser(mockContext);
	assertEquals(user.id, "user123");
	assertEquals(user.email, "test@example.com");
});
