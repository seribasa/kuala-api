import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { Context } from "@hono/hono";
import { handleGetSubscription } from "../../../kuala/handlers/subscriptions/get.ts";
import { subscriptionStateManager } from "../../../_shared/services/subscription-state-management.ts";

// Stub state manager globally to prevent Supabase queries from hitting mocked fetch
stub(
	subscriptionStateManager,
	"hasPendingSubscriptionRequest",
	() => Promise.resolve(false),
);

// Type definitions for test responses
interface JsonResponse {
	data: Record<string, unknown>;
	status: number;
}

// Mock fetch response
class MockResponse {
	headers = new Headers();
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

	clone() {
		return new MockResponse(this.body, this.statusCode, this.isOk);
	}
}

// Helper function to create mock context
function createMockContext(
	user?: { id: string; email: string },
	url = "https://kuala-api.example.com/subscriptions",
) {
	const contextData = new Map();
	if (user) {
		contextData.set("user", user);
	}

	return {
		req: {
			url,
		},
		json: (
			data: Record<string, unknown>,
			status?: number,
		) => ({ data, status } as JsonResponse),
		get: (key: string) => contextData.get(key),
		set: (key: string, value: unknown) => contextData.set(key, value),
	} as unknown as Context;
}

Deno.test("handleGetSubscription - should return 500 when user is not authenticated", async () => {
	const mockContext = createMockContext();

	const response = await handleGetSubscription(
		mockContext,
	) as unknown as JsonResponse;

	assertEquals(response.status, 500);
	assertEquals(response.data.code, "INTERNAL_ERROR");
});

Deno.test("handleGetSubscription - should return 404 when user has no account", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	// Mock environment variables
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "KILLBILL_BASE_URL") return "http://localhost:8080";
		if (key === "KILLBILL_API_KEY") return "test_key";
		if (key === "KILLBILL_API_SECRET") return "test_secret";
		if (key === "KILLBILL_USERNAME") return "admin";
		if (key === "KILLBILL_PASSWORD") return "password";
		if (key === "KILLBILL_DEFAULT_CURRENCY") return "USD";
		return undefined;
	});

	// Mock fetch to return no account found
	const fetchStub = stub(
		globalThis,
		"fetch",
		() => {
			return Promise.resolve(
				new MockResponse(null, 404, false) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext(mockUser);

		const response = await handleGetSubscription(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 404);
		assertEquals(response.data.code, "SUBSCRIPTION_NOT_FOUND");
		assertEquals(
			response.data.message,
			"No subscription found for this user",
		);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscription - should return 404 when user has no active subscriptions", async () => {
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

	// Mock environment variables
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
		() => {
			callCount++;

			if (callCount === 1) {
				// Get account by external key
				return Promise.resolve(
					new MockResponse(mockAccount, 200) as unknown as Response,
				);
			}

			if (callCount === 2) {
				// Get subscriptions - not found
				return Promise.resolve(
					new MockResponse(null, 404, false) as unknown as Response,
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
		const mockContext = createMockContext(mockUser);

		const response = await handleGetSubscription(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 404);
		assertEquals(response.data.code, "SUBSCRIPTION_NOT_FOUND");
		assertEquals(
			response.data.message,
			"No active subscription found for this user",
		);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscription - should return subscription successfully", async () => {
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

	const mockSubscription = {
		subscriptionId: "sub123",
		bundleId: "bundle123",
		accountId: "account123",
		planName: "basic-monthly",
		productName: "Basic",
		productCategory: "subscription",
		billingPeriod: "MONTHLY",
		state: "ACTIVE",
		startDate: "2023-01-01T00:00:00.000Z",
		chargedThroughDate: "2023-02-01T00:00:00.000Z",
		billingEndDate: "2023-03-01T00:00:00.000Z",
	};

	// Mock environment variables
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
		() => {
			callCount++;

			if (callCount === 1) {
				// Get account by external key
				return Promise.resolve(
					new MockResponse(mockAccount, 200) as unknown as Response,
				);
			}

			if (callCount === 2) {
				// Get subscriptions
				return Promise.resolve(
					new MockResponse(
						mockSubscription,
						200,
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
		const mockContext = createMockContext(mockUser);
		const response = await handleGetSubscription(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		assertEquals(response.data.id, "sub123");
		assertEquals(response.data.userId, "user123");
		assertEquals(response.data.planId, "basic-monthly");
		assertEquals(response.data.interval, "month");
		assertEquals(response.data.status, "active");
		assertEquals(response.data.startDate, "2023-01-01T00:00:00.000Z");

		// Check billing information exists and has correct structure
		assertEquals(typeof response.data.billing, "object");
		assertEquals(
			(response.data.billing as Record<string, string>).accountId,
			"account123",
		);
		assertEquals(
			(response.data.billing as Record<string, string>).subscriptionId,
			"sub123",
		);
		assertEquals(
			(response.data.billing as Record<string, string>).bundleId,
			"bundle123",
		);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscription - should return subscription with annual interval", async () => {
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

	const mockSubscription = {
		subscriptionId: "sub123",
		bundleId: "bundle123",
		accountId: "account123",
		planName: "premium-annual",
		productName: "Premium",
		productCategory: "subscription",
		billingPeriod: "ANNUAL",
		state: "ACTIVE",
		startDate: "2023-01-01T00:00:00.000Z",
		chargedThroughDate: "2024-01-01T00:00:00.000Z",
	};

	// Mock environment variables
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
		() => {
			callCount++;

			if (callCount === 1) {
				// Get account by external key
				return Promise.resolve(
					new MockResponse(mockAccount, 200) as unknown as Response,
				);
			}

			if (callCount === 2) {
				// Get subscriptions
				return Promise.resolve(
					new MockResponse(
						mockSubscription,
						200,
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
		const mockContext = createMockContext(mockUser);

		const response = await handleGetSubscription(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		assertEquals(response.data.interval, "year");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscription - should handle Kill Bill service error", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	// Mock environment variables
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "KILLBILL_BASE_URL") return "http://localhost:8080";
		if (key === "KILLBILL_API_KEY") return "test_key";
		if (key === "KILLBILL_API_SECRET") return "test_secret";
		if (key === "KILLBILL_USERNAME") return "admin";
		if (key === "KILLBILL_PASSWORD") return "password";
		if (key === "KILLBILL_DEFAULT_CURRENCY") return "USD";
		return undefined;
	});

	// Mock fetch to return error
	const fetchStub = stub(
		globalThis,
		"fetch",
		() => {
			return Promise.resolve(
				new MockResponse(
					{ error: "Internal server error" },
					500,
					false,
				) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext(mockUser);

		const response = await handleGetSubscription(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "KILLBILL_ERROR");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test({
	name:
		"handleGetSubscription - should return most recent active subscription when multiple exist",
	ignore: true,
	fn: async () => {
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

		const olderSubscription = {
			subscriptionId: "sub123",
			bundleId: "bundle123",
			accountId: "account123",
			planName: "basic-monthly",
			productName: "Basic",
			productCategory: "subscription",
			billingPeriod: "MONTHLY",
			state: "ACTIVE",
			startDate: "2023-01-01T00:00:00.000Z",
			chargedThroughDate: "2023-02-01T00:00:00.000Z",
		};

		const newerSubscription = {
			subscriptionId: "sub456",
			bundleId: "bundle456",
			accountId: "account123",
			planName: "premium-monthly",
			productName: "Premium",
			productCategory: "subscription",
			billingPeriod: "MONTHLY",
			state: "ACTIVE",
			startDate: "2023-06-01T00:00:00.000Z",
			chargedThroughDate: "2023-07-01T00:00:00.000Z",
		};

		// Mock environment variables
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
			() => {
				callCount++;

				if (callCount === 1) {
					// Get account by external key
					return Promise.resolve(
						new MockResponse(
							mockAccount,
							200,
						) as unknown as Response,
					);
				}

				if (callCount === 2) {
					// Get subscriptions - return both, older first
					return Promise.resolve(
						new MockResponse(
							[olderSubscription, newerSubscription],
							200,
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
			const mockContext = createMockContext(mockUser);

			const response = await handleGetSubscription(
				mockContext,
			) as unknown as JsonResponse;

			assertEquals(response.status, 200);
			// Should return the newer subscription
			assertEquals(response.data.id, "sub456");
			assertEquals(response.data.planId, "premium-monthly");
		} finally {
			envStub.restore();
			fetchStub.restore();
		}
	},
});

Deno.test("handleGetSubscription - should handle network errors gracefully", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	// Mock environment variables
	const envStub = stub(Deno.env, "get", (key: string) => {
		if (key === "KILLBILL_BASE_URL") return "http://localhost:8080";
		if (key === "KILLBILL_API_KEY") return "test_key";
		if (key === "KILLBILL_API_SECRET") return "test_secret";
		if (key === "KILLBILL_USERNAME") return "admin";
		if (key === "KILLBILL_PASSWORD") return "password";
		if (key === "KILLBILL_DEFAULT_CURRENCY") return "USD";
		return undefined;
	});

	// Mock fetch to throw network error
	const fetchStub = stub(
		globalThis,
		"fetch",
		() => {
			return Promise.reject(new Error("Network error"));
		},
	);

	try {
		const mockContext = createMockContext(mockUser);

		const response = await handleGetSubscription(
			mockContext,
		) as unknown as JsonResponse;

		// Network error causes account lookup to fail, resulting in "no account found" (404)
		assertEquals(response.status, 404);
		assertEquals(response.data.code, "SUBSCRIPTION_NOT_FOUND");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});
