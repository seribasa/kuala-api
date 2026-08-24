import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { Context } from "@hono/hono";
import { handleGetSubscriptionById } from "../../../kuala/handlers/subscriptions/get-by-id.ts";
import { subscriptionStateManager } from "../../../_shared/services/subscription-state-management.ts";

// Stub state manager globally to prevent Supabase queries from hitting mocked fetch
const globalPendingStub = stub(
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
	subscriptionId: string,
	user?: { id: string; email: string },
	url = "https://kuala-api.example.com/subscriptions",
) {
	const contextData = new Map();
	if (user) {
		contextData.set("user", user);
	}

	return {
		req: {
			param: (name: string) =>
				name === "subscriptionId" ? subscriptionId : undefined,
			header: () => "Bearer valid_token",
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

Deno.test("handleGetSubscriptionById - should return 500 when user is not authenticated", async () => {
	const mockContext = createMockContext("sub123");

	const response = await handleGetSubscriptionById(
		mockContext,
	) as unknown as JsonResponse;

	assertEquals(response.status, 500);
	assertEquals(response.data.code, "INTERNAL_ERROR");
});

Deno.test("handleGetSubscriptionById - should return 404 when user does not own subscription", async () => {
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

	const mockSubscription = {
		subscriptionId: "sub123",
		bundleId: "bundle123",
		accountId: "different-account",
		planName: "basic-monthly",
		productName: "Basic",
		productCategory: "subscription",
		billingPeriod: "MONTHLY",
		state: "ACTIVE",
		startDate: "2023-01-01T00:00:00.000Z",
	};

	const mockUserAccount = {
		accountId: "user-account",
		name: "test@example.com",
		email: "test@example.com",
		externalKey: "user123",
		currency: "USD",
	};

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

			if (
				callCount === 1 &&
				urlString.includes("/1.0/kb/subscriptions/sub123")
			) {
				// Get subscription
				return Promise.resolve(
					new MockResponse(
						mockSubscription,
						200,
					) as unknown as Response,
				);
			}

			if (callCount === 2 && urlString.includes("externalKey=user123")) {
				// Get user's account
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
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
		const mockContext = createMockContext("sub123", mockUser);

		const response = await handleGetSubscriptionById(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 404);
		assertEquals(response.data.code, "SUBSCRIPTION_NOT_FOUND");
		assertEquals(response.data.message, "Subscription not found");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscriptionById - should return 404 when subscription does not exist", async () => {
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

	const fetchStub = stub(
		globalThis,
		"fetch",
		() => {
			// Mock subscription not found
			return Promise.resolve(
				new MockResponse(
					{ error: "Not found" },
					404,
					false,
				) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext("nonexistent", mockUser);

		const response = await handleGetSubscriptionById(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 404);
		assertEquals(response.data.code, "SUBSCRIPTION_NOT_FOUND");
		assertEquals(response.data.message, "Subscription not found");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscriptionById - should return subscription successfully", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
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

	const mockUserAccount = {
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
		(url: string | URL | Request) => {
			callCount++;
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;

			if (urlString.includes("/1.0/kb/subscriptions/sub123")) {
				// Get subscription calls for ownership verification and actual data
				return Promise.resolve(
					new MockResponse(
						mockSubscription,
						200,
					) as unknown as Response,
				);
			}

			if (urlString.includes("externalKey=user123")) {
				// Get user's account for ownership verification
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
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
		const mockContext = createMockContext("sub123", mockUser);

		const response = await handleGetSubscriptionById(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		assertEquals(response.data.id, "sub123");
		assertEquals(response.data.userId, "user123");
		assertEquals(response.data.planId, "basic-monthly");
		assertEquals(response.data.interval, "month");
		assertEquals(response.data.status, "active");
		assertEquals(response.data.startDate, "2023-01-01T00:00:00.000Z");
		assertEquals(
			response.data.currentPeriodStart,
			"2023-02-01T00:00:00.000Z",
		);
		assertEquals(
			response.data.currentPeriodEnd,
			"2023-03-01T00:00:00.000Z",
		);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscriptionById - should map different subscription statuses correctly", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const mockSubscription = {
		subscriptionId: "sub123",
		bundleId: "bundle123",
		accountId: "account123",
		planName: "basic-monthly",
		productName: "Basic",
		productCategory: "subscription",
		billingPeriod: "MONTHLY",
		state: "TRIAL",
		startDate: "2023-01-01T00:00:00.000Z",
	};

	const mockUserAccount = {
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

	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;

			if (urlString.includes("/1.0/kb/subscriptions/sub123")) {
				// Get subscription calls
				return Promise.resolve(
					new MockResponse(
						mockSubscription,
						200,
					) as unknown as Response,
				);
			}

			if (urlString.includes("externalKey=user123")) {
				// Get user's account
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
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
		const mockContext = createMockContext("sub123", mockUser);

		const response = await handleGetSubscriptionById(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		assertEquals(response.data.status, "trialing"); // TRIAL -> trialing
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscriptionById - should handle annual billing period", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
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
	};

	const mockUserAccount = {
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

	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;

			if (urlString.includes("/1.0/kb/subscriptions/sub123")) {
				// Get subscription calls
				return Promise.resolve(
					new MockResponse(
						mockSubscription,
						200,
					) as unknown as Response,
				);
			}

			if (urlString.includes("externalKey=user123")) {
				// Get user's account
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
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
		const mockContext = createMockContext("sub123", mockUser);

		const response = await handleGetSubscriptionById(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		assertEquals(response.data.interval, "year"); // ANNUAL -> year
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscriptionById - should handle Kill Bill service errors", async () => {
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

	const fetchStub = stub(
		globalThis,
		"fetch",
		() => {
			// Mock Kill Bill error - this will cause verifySubscriptionOwnership to return false
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
		const mockContext = createMockContext("sub123", mockUser);

		const response = await handleGetSubscriptionById(
			mockContext,
		) as unknown as JsonResponse;

		// When Kill Bill service fails, verifySubscriptionOwnership returns false, resulting in 404
		assertEquals(response.status, 404);
		assertEquals(response.data.code, "SUBSCRIPTION_NOT_FOUND");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscriptionById - should return 409 when user has pending subscription request", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	// Restore global stub so we can re-stub with different behavior
	globalPendingStub.restore();

	const pendingStub = stub(
		subscriptionStateManager,
		"hasPendingSubscriptionRequest",
		() => Promise.resolve(true),
	);

	const latestRequestStub = stub(
		subscriptionStateManager,
		"getLatestSubscriptionRequest",
		() =>
			Promise.resolve({
				entity_id: "corr-123",
				entity_type: "subscription_request",
				current_state: "creating_subscription",
				state_updated_at: "2023-01-01T00:00:00.000Z",
				last_updated_by: "system",
				last_metadata: {},
			}),
	);

	try {
		const mockContext = createMockContext("sub123", mockUser);

		const response = await handleGetSubscriptionById(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 409);
		assertEquals(response.data.code, "PENDING_SUBSCRIPTION_REQUEST");
	} finally {
		pendingStub.restore();
		latestRequestStub.restore();
	}
});

Deno.test("handleGetSubscriptionById - should return 404 when Kill Bill throws SUBSCRIPTION_NOT_FOUND", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	// Re-stub pending request to return false for this test
	const pendingStub = stub(
		subscriptionStateManager,
		"hasPendingSubscriptionRequest",
		() => Promise.resolve(false),
	);

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

			// Call 1: verifySubscriptionOwnership -> getSubscriptionById (success)
			if (callCount === 1) {
				return Promise.resolve(
					new MockResponse(
						{ subscriptionId: "sub123", accountId: "acc123" },
						200,
					) as unknown as Response,
				);
			}

			// Call 2: verifySubscriptionOwnership -> getAccountByExternalKey (returns matching)
			if (callCount === 2) {
				return Promise.resolve(
					new MockResponse(
						{ accountId: "acc123", externalKey: "user123" },
						200,
					) as unknown as Response,
				);
			}

			// Call 3: handler's getSubscriptionById - returns 404
			if (callCount === 3) {
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
		const mockContext = createMockContext("sub123", mockUser);

		const response = await handleGetSubscriptionById(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 404);
		assertEquals(response.data.code, "SUBSCRIPTION_NOT_FOUND");
	} finally {
		pendingStub.restore();
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscriptionById - should return 500 when Kill Bill throws Failed to get error", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const pendingStub = stub(
		subscriptionStateManager,
		"hasPendingSubscriptionRequest",
		() => Promise.resolve(false),
	);

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

			// Call 1: verifySubscriptionOwnership -> getSubscriptionById (success)
			if (callCount === 1) {
				return Promise.resolve(
					new MockResponse(
						{ subscriptionId: "sub123", accountId: "acc123" },
						200,
					) as unknown as Response,
				);
			}

			// Call 2: verifySubscriptionOwnership -> getAccountByExternalKey (returns matching account)
			if (callCount === 2) {
				return Promise.resolve(
					new MockResponse(
						{ accountId: "acc123", externalKey: "user123" },
						200,
					) as unknown as Response,
				);
			}

			// Call 3: handler's getSubscriptionById - Kill Bill service error
			if (callCount === 3) {
				return Promise.resolve(
					new MockResponse(
						{ error: "Service unavailable" },
						503,
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
		const mockContext = createMockContext("sub123", mockUser);

		const response = await handleGetSubscriptionById(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "KILLBILL_ERROR");
	} finally {
		pendingStub.restore();
		envStub.restore();
		fetchStub.restore();
	}
});
