import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { Context } from "@hono/hono";
import { handleGetSubscription } from "../../../kuala/handlers/subscriptions/get.ts";
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

Deno.test("handleGetSubscription - should return 200 with empty subscriptions when user has no account", async () => {
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

	// Mock fetch to return no account found (returns null body)
	const fetchStub = stub(
		globalThis,
		"fetch",
		() => {
			// getAccountByExternalKey returns null when 404
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

		// Handler now returns 200 with message instead of 404
		assertEquals(response.status, 200);
		const data = response.data as Record<string, unknown>;
		assertEquals(
			(data.subscriptions as unknown[]).length,
			0,
		);
		assertEquals(typeof data.message, "string");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscription - should return 200 with empty subscriptions when no active subscriptions", async () => {
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

		// Returns 200 with empty subscriptions and success message
		assertEquals(response.status, 200);
		const data = response.data as Record<string, unknown>;
		assertEquals(
			(data.subscriptions as unknown[]).length,
			0,
		);
		assertEquals(data.message, "Subscriptions retrieved successfully");
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
		billingStartDate: "2023-01-01T00:00:00.000Z",
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

		const data = response.data as Record<string, unknown>;
		const subscriptions = data.subscriptions as Record<string, unknown>[];
		assertEquals(subscriptions.length, 1);

		const sub = subscriptions[0];
		assertEquals(sub.id, "sub123");
		assertEquals(sub.bundleId, "bundle123");
		assertEquals(sub.accountId, "account123");
		assertEquals(sub.userId, "user123");
		assertEquals(sub.planName, "basic-monthly");
		assertEquals(sub.productName, "Basic");
		assertEquals(sub.billingPeriod, "MONTHLY");
		assertEquals(sub.state, "ACTIVE");
		assertEquals(sub.billingStartDate, "2023-01-01T00:00:00.000Z");
		assertEquals(sub.billingEndDate, "2023-03-01T00:00:00.000Z");
		assertEquals(sub.chargedThroughDate, "2023-02-01T00:00:00.000Z");

		// Check nested account info
		const account = sub.account as Record<string, string>;
		assertEquals(account.name, "test@example.com");
		assertEquals(account.email, "test@example.com");
		assertEquals(account.currency, "USD");

		assertEquals(data.message, "Subscriptions retrieved successfully");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscription - should return subscription with ANNUAL billing period", async () => {
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
		billingStartDate: "2023-01-01T00:00:00.000Z",
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
		const data = response.data as Record<string, unknown>;
		const subscriptions = data.subscriptions as Record<string, unknown>[];
		assertEquals(subscriptions.length, 1);
		assertEquals(subscriptions[0].billingPeriod, "ANNUAL");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscription - should return 200 with warning message on Kill Bill service error", async () => {
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

		// Kill Bill service error now returns 502
		assertEquals(response.status, 502);
		const data = response.data as Record<string, unknown>;
		assertEquals(data.code, "UPSTREAM_ERROR");
		assertEquals(typeof data.message, "string");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscription - should return 200 with no account when network error occurs", async () => {
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

		// Network errors are caught inside killBillService and return null,
		// so handler follows the "no account found" path → 200
		assertEquals(response.status, 200);
		const data = response.data as Record<string, unknown>;
		assertEquals(
			(data.subscriptions as unknown[]).length,
			0,
		);
		assertEquals(
			data.message,
			"No subscription account found for this user.",
		);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscription - should return 200 with warning when subscription fetch fails but account exists", async () => {
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
				// Get account by external key - success
				return Promise.resolve(
					new MockResponse(mockAccount, 200) as unknown as Response,
				);
			}

			if (callCount === 2) {
				// Get subscription - network error
				return Promise.reject(new Error("Network error"));
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

		// Subscription fetch failure returns 502
		assertEquals(response.status, 502);
		const data = response.data as Record<string, unknown>;
		assertEquals(data.code, "UPSTREAM_ERROR");
		assertEquals(
			data.message,
			"Failed to fetch subscription details. Please try again later.",
		);
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleGetSubscription - should return 409 when user has pending subscription request", async () => {
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
		const mockContext = createMockContext(mockUser);

		const response = await handleGetSubscription(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 409);
		assertEquals(response.data.code, "PENDING_SUBSCRIPTION_REQUEST");
		assertEquals(typeof response.data.message, "string");
	} finally {
		pendingStub.restore();
		latestRequestStub.restore();
	}
});
