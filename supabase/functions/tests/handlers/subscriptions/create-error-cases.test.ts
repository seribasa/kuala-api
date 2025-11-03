import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { Context } from "@hono/hono";
import { handleCreateSubscription } from "../../../kuala/handlers/subscriptions/create.ts";

// Type definitions for test responses
interface JsonResponse {
	data: Record<string, unknown>;
	status: number;
}

// Mock fetch response
class MockResponse {
	private _headers: Headers;

	constructor(
		private body: unknown,
		private statusCode: number,
		private isOk: boolean = true,
		headers: Record<string, string> = {},
	) {
		this._headers = new Headers(headers);
	}

	get ok() {
		return this.isOk;
	}

	get status() {
		return this.statusCode;
	}

	get headers() {
		return this._headers;
	}

	json() {
		return Promise.resolve(this.body);
	}

	text() {
		return Promise.resolve(JSON.stringify(this.body));
	}
}

// Helper function to create mock context
function createMockContext(
	authHeader?: string,
	body: unknown = {},
	url = "https://kuala-api.example.com/subscriptions",
	user?: { id: string; email: string },
) {
	const contextData = new Map();
	if (user) {
		contextData.set("user", user);
	}

	return {
		req: {
			header: (name: string) =>
				name === "Authorization" ? authHeader : undefined,
			json: () => Promise.resolve(body),
			url,
		},
		json: (
			data: Record<string, unknown>,
			status?: number,
		) => ({ data, status } as JsonResponse),
		get: (key: string) => contextData.get(key),
		set: (key: string, value: unknown) => contextData.set(key, value),
		res: {
			headers: new Headers(),
		},
	} as unknown as Context;
}

Deno.test("handleCreateSubscription - should handle account creation failure", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "KILLBILL_BASE_URL") return "http://localhost:8080";
		if (key === "KILLBILL_API_KEY") return "test_key";
		if (key === "KILLBILL_API_SECRET") return "test_secret";
		if (key === "KILLBILL_USERNAME") return "admin";
		if (key === "KILLBILL_PASSWORD") return "password";
		if (key === "KILLBILL_DEFAULT_CURRENCY") return "USD";
		return undefined;
	});

	let callCount = 0;
	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			callCount++;
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;

			// First call: check for existing account - not found
			if (
				callCount === 1 && urlString.includes("/1.0/kb/accounts") &&
				urlString.includes("externalKey")
			) {
				return Promise.resolve(
					new MockResponse(
						{ error: "Not found" },
						404,
						false,
					) as unknown as Response,
				);
			}

			// Second call: create account fails
			if (callCount === 2 && urlString.includes("/1.0/kb/accounts")) {
				return Promise.resolve(
					new MockResponse(
						{ error: "Failed to create account" },
						500,
						false,
					) as unknown as Response,
				);
			}

			return Promise.resolve(
				new MockResponse(
					{ error: "Unexpected call" },
					500,
					false,
				) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext(
			"Bearer valid_token",
			{ planId: "basic-monthly" },
			undefined,
			mockUser,
		);

		const response = await handleCreateSubscription(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "INTERNAL_ERROR");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleCreateSubscription - should handle missing Location header on account creation", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "KILLBILL_BASE_URL") return "http://localhost:8080";
		if (key === "KILLBILL_API_KEY") return "test_key";
		if (key === "KILLBILL_API_SECRET") return "test_secret";
		if (key === "KILLBILL_USERNAME") return "admin";
		if (key === "KILLBILL_PASSWORD") return "password";
		if (key === "KILLBILL_DEFAULT_CURRENCY") return "USD";
		return undefined;
	});

	let callCount = 0;
	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			callCount++;
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;

			// First call: check for existing account - not found
			if (
				callCount === 1 && urlString.includes("/1.0/kb/accounts") &&
				urlString.includes("externalKey")
			) {
				return Promise.resolve(
					new MockResponse(
						{ error: "Not found" },
						404,
						false,
					) as unknown as Response,
				);
			}

			// Second call: create account but no Location header
			if (callCount === 2 && urlString.includes("/1.0/kb/accounts")) {
				return Promise.resolve(
					new MockResponse(
						{},
						201,
						true,
						{}, // No Location header
					) as unknown as Response,
				);
			}

			return Promise.resolve(
				new MockResponse(
					{ error: "Unexpected call" },
					500,
					false,
				) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext(
			"Bearer valid_token",
			{ planId: "basic-monthly" },
			undefined,
			mockUser,
		);

		const response = await handleCreateSubscription(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "INTERNAL_ERROR");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleCreateSubscription - should handle account details fetch failure", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "KILLBILL_BASE_URL") return "http://localhost:8080";
		if (key === "KILLBILL_API_KEY") return "test_key";
		if (key === "KILLBILL_API_SECRET") return "test_secret";
		if (key === "KILLBILL_USERNAME") return "admin";
		if (key === "KILLBILL_PASSWORD") return "password";
		if (key === "KILLBILL_DEFAULT_CURRENCY") return "USD";
		return undefined;
	});

	let callCount = 0;
	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			callCount++;
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;

			// First call: check for existing account - not found
			if (
				callCount === 1 && urlString.includes("/1.0/kb/accounts") &&
				urlString.includes("externalKey")
			) {
				return Promise.resolve(
					new MockResponse(
						{ error: "Not found" },
						404,
						false,
					) as unknown as Response,
				);
			}

			// Second call: create account successfully
			if (callCount === 2 && urlString.includes("/1.0/kb/accounts")) {
				return Promise.resolve(
					new MockResponse(
						{},
						201,
						true,
						{
							"Location":
								"http://localhost:8080/1.0/kb/accounts/account123",
						},
					) as unknown as Response,
				);
			}

			// Third call: fetch account details fails
			if (
				callCount === 3 &&
				urlString.includes("/1.0/kb/accounts/account123")
			) {
				return Promise.resolve(
					new MockResponse(
						{ error: "Not found" },
						404,
						false,
					) as unknown as Response,
				);
			}

			return Promise.resolve(
				new MockResponse(
					{ error: "Unexpected call" },
					500,
					false,
				) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext(
			"Bearer valid_token",
			{ planId: "basic-monthly" },
			undefined,
			mockUser,
		);

		const response = await handleCreateSubscription(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "INTERNAL_ERROR");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleCreateSubscription - should handle bundles fetch failure", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const mockAccount = {
		accountId: "account123",
		name: "test@example.com",
		email: "test@example.com",
		externalKey: "user123",
		currency: "USD",
	};

	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "KILLBILL_BASE_URL") return "http://localhost:8080";
		if (key === "KILLBILL_API_KEY") return "test_key";
		if (key === "KILLBILL_API_SECRET") return "test_secret";
		if (key === "KILLBILL_USERNAME") return "admin";
		if (key === "KILLBILL_PASSWORD") return "password";
		if (key === "KILLBILL_DEFAULT_CURRENCY") return "USD";
		return undefined;
	});

	let callCount = 0;
	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			callCount++;
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;

			// First call: get existing account
			if (
				callCount === 1 && urlString.includes("/1.0/kb/accounts") &&
				urlString.includes("externalKey")
			) {
				return Promise.resolve(
					new MockResponse(mockAccount, 200) as unknown as Response,
				);
			}

			// Second call: bundles fetch fails
			if (callCount === 2 && urlString.includes("/bundles")) {
				return Promise.resolve(
					new MockResponse(
						{ error: "Failed to fetch bundles" },
						500,
						false,
					) as unknown as Response,
				);
			}

			// Third call: create subscription
			if (
				callCount === 3 && urlString.includes("/1.0/kb/subscriptions")
			) {
				return Promise.resolve(
					new MockResponse(
						{},
						201,
						true,
						{
							"Location":
								"http://localhost:8080/1.0/kb/subscriptions/sub123",
						},
					) as unknown as Response,
				);
			}

			return Promise.resolve(
				new MockResponse(
					{ error: "Unexpected call" },
					500,
					false,
				) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext(
			"Bearer valid_token",
			{ planId: "basic-monthly" },
			undefined,
			mockUser,
		);

		const response = await handleCreateSubscription(
			mockContext,
		) as unknown as JsonResponse;

		// Should continue to create subscription even if bundles check fails
		assertEquals(response.status, 201);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleCreateSubscription - should handle bundles fetch exception", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const mockAccount = {
		accountId: "account123",
		name: "test@example.com",
		email: "test@example.com",
		externalKey: "user123",
		currency: "USD",
	};

	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "KILLBILL_BASE_URL") return "http://localhost:8080";
		if (key === "KILLBILL_API_KEY") return "test_key";
		if (key === "KILLBILL_API_SECRET") return "test_secret";
		if (key === "KILLBILL_USERNAME") return "admin";
		if (key === "KILLBILL_PASSWORD") return "password";
		if (key === "KILLBILL_DEFAULT_CURRENCY") return "USD";
		return undefined;
	});

	let callCount = 0;
	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			callCount++;
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;

			// First call: get existing account
			if (
				callCount === 1 && urlString.includes("/1.0/kb/accounts") &&
				urlString.includes("externalKey")
			) {
				return Promise.resolve(
					new MockResponse(mockAccount, 200) as unknown as Response,
				);
			}

			// Second call: bundles fetch throws error
			if (callCount === 2 && urlString.includes("/bundles")) {
				return Promise.reject(new Error("Network error"));
			}

			// Third call: create subscription
			if (
				callCount === 3 && urlString.includes("/1.0/kb/subscriptions")
			) {
				return Promise.resolve(
					new MockResponse(
						{},
						201,
						true,
						{
							"Location":
								"http://localhost:8080/1.0/kb/subscriptions/sub123",
						},
					) as unknown as Response,
				);
			}

			return Promise.resolve(
				new MockResponse(
					{ error: "Unexpected call" },
					500,
					false,
				) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext(
			"Bearer valid_token",
			{ planId: "basic-monthly" },
			undefined,
			mockUser,
		);

		const response = await handleCreateSubscription(
			mockContext,
		) as unknown as JsonResponse;

		// Should continue to create subscription even if bundles check throws
		assertEquals(response.status, 201);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleCreateSubscription - should handle subscription creation failure", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const mockAccount = {
		accountId: "account123",
		name: "test@example.com",
		email: "test@example.com",
		externalKey: "user123",
		currency: "USD",
	};

	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "KILLBILL_BASE_URL") return "http://localhost:8080";
		if (key === "KILLBILL_API_KEY") return "test_key";
		if (key === "KILLBILL_API_SECRET") return "test_secret";
		if (key === "KILLBILL_USERNAME") return "admin";
		if (key === "KILLBILL_PASSWORD") return "password";
		if (key === "KILLBILL_DEFAULT_CURRENCY") return "USD";
		return undefined;
	});

	let callCount = 0;
	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			callCount++;
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;

			// First call: get existing account
			if (
				callCount === 1 && urlString.includes("/1.0/kb/accounts") &&
				urlString.includes("externalKey")
			) {
				return Promise.resolve(
					new MockResponse(mockAccount, 200) as unknown as Response,
				);
			}

			// Second call: check bundles - empty
			if (callCount === 2 && urlString.includes("/bundles")) {
				return Promise.resolve(
					new MockResponse([], 200) as unknown as Response,
				);
			}

			// Third call: create subscription fails
			if (
				callCount === 3 && urlString.includes("/1.0/kb/subscriptions")
			) {
				return Promise.resolve(
					new MockResponse(
						{ error: "Subscription creation failed" },
						400,
						false,
					) as unknown as Response,
				);
			}

			return Promise.resolve(
				new MockResponse(
					{ error: "Unexpected call" },
					500,
					false,
				) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext(
			"Bearer valid_token",
			{ planId: "basic-monthly" },
			undefined,
			mockUser,
		);

		const response = await handleCreateSubscription(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "SUBSCRIPTION_CREATION_FAILED");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleCreateSubscription - should handle no Location header on subscription creation", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const mockAccount = {
		accountId: "account123",
		name: "test@example.com",
		email: "test@example.com",
		externalKey: "user123",
		currency: "USD",
	};

	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "KILLBILL_BASE_URL") return "http://localhost:8080";
		if (key === "KILLBILL_API_KEY") return "test_key";
		if (key === "KILLBILL_API_SECRET") return "test_secret";
		if (key === "KILLBILL_USERNAME") return "admin";
		if (key === "KILLBILL_PASSWORD") return "password";
		if (key === "KILLBILL_DEFAULT_CURRENCY") return "USD";
		return undefined;
	});

	let callCount = 0;
	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			callCount++;
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;

			// First call: get existing account
			if (
				callCount === 1 && urlString.includes("/1.0/kb/accounts") &&
				urlString.includes("externalKey")
			) {
				return Promise.resolve(
					new MockResponse(mockAccount, 200) as unknown as Response,
				);
			}

			// Second call: check bundles - empty
			if (callCount === 2 && urlString.includes("/bundles")) {
				return Promise.resolve(
					new MockResponse([], 200) as unknown as Response,
				);
			}

			// Third call: create subscription but no Location header
			if (
				callCount === 3 && urlString.includes("/1.0/kb/subscriptions")
			) {
				return Promise.resolve(
					new MockResponse(
						{},
						201,
						true,
						{}, // No Location header
					) as unknown as Response,
				);
			}

			return Promise.resolve(
				new MockResponse(
					{ error: "Unexpected call" },
					500,
					false,
				) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext(
			"Bearer valid_token",
			{ planId: "basic-monthly" },
			undefined,
			mockUser,
		);

		const response = await handleCreateSubscription(
			mockContext,
		) as unknown as JsonResponse;

		// Should still return 201 even without Location header (subscriptionId will be "unknown")
		assertEquals(response.status, 201);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleCreateSubscription - should handle account fetch error gracefully", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "KILLBILL_BASE_URL") return "http://localhost:8080";
		if (key === "KILLBILL_API_KEY") return "test_key";
		if (key === "KILLBILL_API_SECRET") return "test_secret";
		if (key === "KILLBILL_USERNAME") return "admin";
		if (key === "KILLBILL_PASSWORD") return "password";
		if (key === "KILLBILL_DEFAULT_CURRENCY") return "USD";
		return undefined;
	});

	let callCount = 0;
	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			callCount++;
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;

			// First call: check for existing account - throws error
			if (
				callCount === 1 && urlString.includes("/1.0/kb/accounts") &&
				urlString.includes("externalKey")
			) {
				return Promise.reject(new Error("Network error"));
			}

			// Second call: create account
			if (callCount === 2 && urlString.includes("/1.0/kb/accounts")) {
				return Promise.resolve(
					new MockResponse(
						{},
						201,
						true,
						{
							"Location":
								"http://localhost:8080/1.0/kb/accounts/account123",
						},
					) as unknown as Response,
				);
			}

			// Third call: fetch account details
			if (
				callCount === 3 &&
				urlString.includes("/1.0/kb/accounts/account123")
			) {
				return Promise.resolve(
					new MockResponse({
						accountId: "account123",
						name: "test@example.com",
						email: "test@example.com",
						externalKey: "user123",
						currency: "USD",
					}, 200) as unknown as Response,
				);
			}

			// Fourth call: check bundles
			if (callCount === 4 && urlString.includes("/bundles")) {
				return Promise.resolve(
					new MockResponse([], 200) as unknown as Response,
				);
			}

			// Fifth call: create subscription
			if (
				callCount === 5 && urlString.includes("/1.0/kb/subscriptions")
			) {
				return Promise.resolve(
					new MockResponse(
						{},
						201,
						true,
						{
							"Location":
								"http://localhost:8080/1.0/kb/subscriptions/sub123",
						},
					) as unknown as Response,
				);
			}

			return Promise.resolve(
				new MockResponse(
					{ error: "Unexpected call" },
					500,
					false,
				) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext(
			"Bearer valid_token",
			{ planId: "basic-monthly" },
			undefined,
			mockUser,
		);

		const response = await handleCreateSubscription(
			mockContext,
		) as unknown as JsonResponse;

		// Should create account and subscription successfully despite initial error
		assertEquals(response.status, 201);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});
