import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { Context } from "@hono/hono";
import { handleGetSubscriptionStatus } from "../../../kuala/handlers/subscriptions/status.ts";
import { subscriptionStateManager } from "../../../_shared/services/subscription-state-management.ts";

// Type definitions for test responses
interface JsonResponse {
	data: Record<string, unknown>;
	status: number;
}

// Helper function to create mock context for status handler
function createMockContext(
	correlationId: string,
	user?: { id: string; email: string },
) {
	const contextData = new Map();
	if (user) {
		contextData.set("user", user);
	}

	return {
		req: {
			param: (name: string) =>
				name === "correlationId" ? correlationId : undefined,
			header: () => "Bearer valid_token",
			url: "https://kuala-api.example.com/subscriptions/status/corr-123",
		},
		json: (
			data: Record<string, unknown>,
			status?: number,
		) => ({ data, status } as JsonResponse),
		get: (key: string) => contextData.get(key),
		set: (key: string, value: unknown) => contextData.set(key, value),
	} as unknown as Context;
}

// ─────────────────────────── Validation Tests ───────────────────────────

Deno.test("handleGetSubscriptionStatus - should return 500 when user is not authenticated", async () => {
	const mockContext = createMockContext("corr-123");

	const response = await handleGetSubscriptionStatus(
		mockContext,
	) as unknown as JsonResponse;

	assertEquals(response.status, 500);
	assertEquals(response.data.code, "INTERNAL_ERROR");
});

// ─────────────────────────── Not Found Tests ───────────────────────────

Deno.test("handleGetSubscriptionStatus - should return 404 when correlation ID not found", async () => {
	const mockUser = { id: "user123", email: "test@example.com" };

	const currentStateStub = stub(
		subscriptionStateManager,
		"getCurrentState",
		() => Promise.resolve(null),
	);

	try {
		const mockContext = createMockContext("nonexistent-id", mockUser);

		const response = await handleGetSubscriptionStatus(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 404);
		assertEquals(response.data.code, "SUBSCRIPTION_NOT_FOUND");
	} finally {
		currentStateStub.restore();
	}
});

Deno.test("handleGetSubscriptionStatus - should return 404 when user tries to access another user's saga", async () => {
	const mockUser = { id: "user123", email: "test@example.com" };

	const currentStateStub = stub(
		subscriptionStateManager,
		"getCurrentState",
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

	const historyStub = stub(
		subscriptionStateManager,
		"getHistory",
		() =>
			Promise.resolve([
				{
					id: "trans-1",
					entity_type: "subscription_request",
					entity_id: "corr-123",
					from_state: null,
					to_state: "requested",
					event_type: "SubscriptionRequested",
					triggered_by: "system",
					transition_reason: undefined,
					metadata: { userId: "other-user-456" }, // Different user
					error_details: undefined,
					created_at: "2023-01-01T00:00:00.000Z",
				},
			]),
	);

	try {
		const mockContext = createMockContext("corr-123", mockUser);

		const response = await handleGetSubscriptionStatus(
			mockContext,
		) as unknown as JsonResponse;

		// Returns 404 to not leak existence
		assertEquals(response.status, 404);
		assertEquals(response.data.code, "SUBSCRIPTION_NOT_FOUND");
	} finally {
		currentStateStub.restore();
		historyStub.restore();
	}
});

// ─────────────────────────── Success Tests ───────────────────────────

Deno.test("handleGetSubscriptionStatus - should return 200 with processing status for in-progress saga", async () => {
	const mockUser = { id: "user123", email: "test@example.com" };

	const currentStateStub = stub(
		subscriptionStateManager,
		"getCurrentState",
		() =>
			Promise.resolve({
				entity_id: "corr-123",
				entity_type: "subscription_request",
				current_state: "account_ready",
				state_updated_at: "2023-01-01T00:01:00.000Z",
				last_updated_by: "system",
				last_metadata: {},
			}),
	);

	const historyStub = stub(
		subscriptionStateManager,
		"getHistory",
		() =>
			Promise.resolve([
				{
					id: "trans-1",
					entity_type: "subscription_request",
					entity_id: "corr-123",
					from_state: null,
					to_state: "requested",
					event_type: "SubscriptionRequested",
					triggered_by: "system",
					transition_reason: undefined,
					metadata: { userId: "user123" },
					error_details: undefined,
					created_at: "2023-01-01T00:00:00.000Z",
				},
				{
					id: "trans-2",
					entity_type: "subscription_request",
					entity_id: "corr-123",
					from_state: "requested",
					to_state: "account_ready",
					event_type: "AccountReady",
					triggered_by: "system",
					transition_reason: undefined,
					metadata: { userId: "user123", accountId: "acc-123" },
					error_details: undefined,
					created_at: "2023-01-01T00:01:00.000Z",
				},
			]),
	);

	try {
		const mockContext = createMockContext("corr-123", mockUser);

		const response = await handleGetSubscriptionStatus(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		assertEquals(response.data.successful, true);

		const statusData = response.data
			.data as Record<string, unknown>;
		assertEquals(statusData.correlation_id, "corr-123");
		assertEquals(statusData.status, "processing");
		assertEquals(statusData.current_state, "account_ready");
		assertEquals(
			statusData.message,
			"Account is ready. Creating your subscription...",
		);

		// Check progress
		const progress = statusData.progress as Record<string, number>;
		assertEquals(progress.totalSteps, 4);
		assertEquals(progress.completedSteps, 1);
		assertEquals(progress.percentage, 25);

		// Check events
		const events = statusData.events as Record<string, unknown>[];
		assertEquals(events.length, 2);

		// Check extracted data
		const data = statusData.data as Record<string, string>;
		assertEquals(data.accountId, "acc-123");
	} finally {
		currentStateStub.restore();
		historyStub.restore();
	}
});

Deno.test("handleGetSubscriptionStatus - should return 200 with completed status", async () => {
	const mockUser = { id: "user123", email: "test@example.com" };

	const currentStateStub = stub(
		subscriptionStateManager,
		"getCurrentState",
		() =>
			Promise.resolve({
				entity_id: "corr-123",
				entity_type: "subscription_request",
				current_state: "completed",
				state_updated_at: "2023-01-01T00:05:00.000Z",
				last_updated_by: "system",
				last_metadata: {},
			}),
	);

	const historyStub = stub(
		subscriptionStateManager,
		"getHistory",
		() =>
			Promise.resolve([
				{
					id: "trans-1",
					entity_type: "subscription_request",
					entity_id: "corr-123",
					from_state: null,
					to_state: "requested",
					event_type: "SubscriptionRequested",
					triggered_by: "system",
					transition_reason: undefined,
					metadata: { userId: "user123" },
					error_details: undefined,
					created_at: "2023-01-01T00:00:00.000Z",
				},
				{
					id: "trans-5",
					entity_type: "subscription_request",
					entity_id: "corr-123",
					from_state: "generating_invoice",
					to_state: "completed",
					event_type: "InvoiceGenerated",
					triggered_by: "system",
					transition_reason: undefined,
					metadata: {
						userId: "user123",
						accountId: "acc-123",
						subscriptionId: "sub-123",
						invoiceId: "inv-123",
					},
					error_details: undefined,
					created_at: "2023-01-01T00:05:00.000Z",
				},
			]),
	);

	try {
		const mockContext = createMockContext("corr-123", mockUser);

		const response = await handleGetSubscriptionStatus(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		assertEquals(response.data.successful, true);

		const statusData = response.data
			.data as Record<string, unknown>;
		assertEquals(statusData.status, "completed");
		assertEquals(statusData.current_state, "completed");
		assertEquals(
			statusData.message,
			"Subscription setup completed successfully!",
		);

		const progress = statusData.progress as Record<string, number>;
		assertEquals(progress.completedSteps, 4);
		assertEquals(progress.percentage, 100);

		const data = statusData.data as Record<string, string>;
		assertEquals(data.accountId, "acc-123");
		assertEquals(data.subscriptionId, "sub-123");
		assertEquals(data.invoiceId, "inv-123");
	} finally {
		currentStateStub.restore();
		historyStub.restore();
	}
});

Deno.test("handleGetSubscriptionStatus - should return 200 with failed status", async () => {
	const mockUser = { id: "user123", email: "test@example.com" };

	const currentStateStub = stub(
		subscriptionStateManager,
		"getCurrentState",
		() =>
			Promise.resolve({
				entity_id: "corr-123",
				entity_type: "subscription_request",
				current_state: "failed",
				state_updated_at: "2023-01-01T00:02:00.000Z",
				last_updated_by: "system",
				last_metadata: {},
			}),
	);

	const historyStub = stub(
		subscriptionStateManager,
		"getHistory",
		() =>
			Promise.resolve([
				{
					id: "trans-1",
					entity_type: "subscription_request",
					entity_id: "corr-123",
					from_state: null,
					to_state: "requested",
					event_type: "SubscriptionRequested",
					triggered_by: "system",
					transition_reason: undefined,
					metadata: { userId: "user123" },
					error_details: undefined,
					created_at: "2023-01-01T00:00:00.000Z",
				},
				{
					id: "trans-2",
					entity_type: "subscription_request",
					entity_id: "corr-123",
					from_state: "requested",
					to_state: "failed",
					event_type: "SubscriptionFailed",
					triggered_by: "system",
					transition_reason: "Account creation failed",
					metadata: { userId: "user123" },
					error_details: undefined,
					created_at: "2023-01-01T00:02:00.000Z",
				},
			]),
	);

	try {
		const mockContext = createMockContext("corr-123", mockUser);

		const response = await handleGetSubscriptionStatus(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		assertEquals(response.data.successful, true);

		const statusData = response.data
			.data as Record<string, unknown>;
		assertEquals(statusData.status, "failed");
		assertEquals(statusData.current_state, "failed");
		assertEquals(
			statusData.message,
			"Subscription setup failed. Please contact support or try again.",
		);

		const progress = statusData.progress as Record<string, number>;
		assertEquals(progress.completedSteps, 0);
		assertEquals(progress.percentage, 0);
	} finally {
		currentStateStub.restore();
		historyStub.restore();
	}
});

// ─────────────────────────── Error Tests ───────────────────────────

Deno.test("handleGetSubscriptionStatus - should return 500 when state manager throws error", async () => {
	const mockUser = { id: "user123", email: "test@example.com" };

	const currentStateStub = stub(
		subscriptionStateManager,
		"getCurrentState",
		() => Promise.reject(new Error("Database connection failed")),
	);

	try {
		const mockContext = createMockContext("corr-123", mockUser);

		const response = await handleGetSubscriptionStatus(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "INTERNAL_ERROR");
		assertEquals(
			response.data.message,
			"Failed to retrieve subscription status",
		);
	} finally {
		currentStateStub.restore();
	}
});

// ─────── Additional State Coverage Tests (switch branches) ───────

Deno.test("handleGetSubscriptionStatus - should map 'requested' state correctly", async () => {
	const mockUser = { id: "user123", email: "test@example.com" };

	const currentStateStub = stub(
		subscriptionStateManager,
		"getCurrentState",
		() =>
			Promise.resolve({
				entity_id: "corr-123",
				entity_type: "subscription_request",
				current_state: "requested",
				state_updated_at: "2023-01-01T00:00:00.000Z",
				last_updated_by: "system",
				last_metadata: {},
			}),
	);

	const historyStub = stub(
		subscriptionStateManager,
		"getHistory",
		() =>
			Promise.resolve([
				{
					id: "trans-1",
					entity_type: "subscription_request",
					entity_id: "corr-123",
					from_state: null,
					to_state: "requested",
					event_type: "SubscriptionRequested",
					triggered_by: "system",
					transition_reason: undefined,
					metadata: { userId: "user123" },
					error_details: undefined,
					created_at: "2023-01-01T00:00:00.000Z",
				},
			]),
	);

	try {
		const mockContext = createMockContext("corr-123", mockUser);
		const response = await handleGetSubscriptionStatus(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		const statusData = response.data.data as Record<string, unknown>;
		assertEquals(statusData.status, "processing");
		assertEquals(statusData.current_state, "requested");
		assertEquals(
			statusData.message,
			"Subscription request received. Setting up your account...",
		);
		const progress = statusData.progress as Record<string, number>;
		assertEquals(progress.completedSteps, 0);
		assertEquals(progress.percentage, 0);
	} finally {
		currentStateStub.restore();
		historyStub.restore();
	}
});

Deno.test("handleGetSubscriptionStatus - should map 'creating_subscription' state correctly", async () => {
	const mockUser = { id: "user123", email: "test@example.com" };

	const currentStateStub = stub(
		subscriptionStateManager,
		"getCurrentState",
		() =>
			Promise.resolve({
				entity_id: "corr-123",
				entity_type: "subscription_request",
				current_state: "creating_subscription",
				state_updated_at: "2023-01-01T00:01:00.000Z",
				last_updated_by: "system",
				last_metadata: {},
			}),
	);

	const historyStub = stub(
		subscriptionStateManager,
		"getHistory",
		() =>
			Promise.resolve([{
				id: "trans-1",
				entity_type: "subscription_request",
				entity_id: "corr-123",
				from_state: null,
				to_state: "requested",
				event_type: "SubscriptionRequested",
				triggered_by: "system",
				transition_reason: undefined,
				metadata: { userId: "user123" },
				error_details: undefined,
				created_at: "2023-01-01T00:00:00.000Z",
			}]),
	);

	try {
		const mockContext = createMockContext("corr-123", mockUser);
		const response = await handleGetSubscriptionStatus(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		const statusData = response.data.data as Record<string, unknown>;
		assertEquals(statusData.current_state, "creating_subscription");
		assertEquals(
			statusData.message,
			"Creating your subscription in the billing system...",
		);
		const progress = statusData.progress as Record<string, number>;
		assertEquals(progress.completedSteps, 1);
		assertEquals(progress.percentage, 25);
	} finally {
		currentStateStub.restore();
		historyStub.restore();
	}
});

Deno.test("handleGetSubscriptionStatus - should map 'subscription_created' state correctly", async () => {
	const mockUser = { id: "user123", email: "test@example.com" };

	const currentStateStub = stub(
		subscriptionStateManager,
		"getCurrentState",
		() =>
			Promise.resolve({
				entity_id: "corr-123",
				entity_type: "subscription_request",
				current_state: "subscription_created",
				state_updated_at: "2023-01-01T00:02:00.000Z",
				last_updated_by: "system",
				last_metadata: {},
			}),
	);

	const historyStub = stub(
		subscriptionStateManager,
		"getHistory",
		() =>
			Promise.resolve([{
				id: "trans-1",
				entity_type: "subscription_request",
				entity_id: "corr-123",
				from_state: null,
				to_state: "requested",
				event_type: "SubscriptionRequested",
				triggered_by: "system",
				transition_reason: undefined,
				metadata: { userId: "user123", subscriptionId: "sub-456" },
				error_details: undefined,
				created_at: "2023-01-01T00:00:00.000Z",
			}]),
	);

	try {
		const mockContext = createMockContext("corr-123", mockUser);
		const response = await handleGetSubscriptionStatus(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		const statusData = response.data.data as Record<string, unknown>;
		assertEquals(statusData.current_state, "subscription_created");
		assertEquals(
			statusData.message,
			"Subscription created. Generating invoice...",
		);
		const progress = statusData.progress as Record<string, number>;
		assertEquals(progress.completedSteps, 2);
		assertEquals(progress.percentage, 50);
	} finally {
		currentStateStub.restore();
		historyStub.restore();
	}
});

Deno.test("handleGetSubscriptionStatus - should map 'generating_invoice' state correctly", async () => {
	const mockUser = { id: "user123", email: "test@example.com" };

	const currentStateStub = stub(
		subscriptionStateManager,
		"getCurrentState",
		() =>
			Promise.resolve({
				entity_id: "corr-123",
				entity_type: "subscription_request",
				current_state: "generating_invoice",
				state_updated_at: "2023-01-01T00:03:00.000Z",
				last_updated_by: "system",
				last_metadata: {},
			}),
	);

	const historyStub = stub(
		subscriptionStateManager,
		"getHistory",
		() =>
			Promise.resolve([{
				id: "trans-1",
				entity_type: "subscription_request",
				entity_id: "corr-123",
				from_state: null,
				to_state: "requested",
				event_type: "SubscriptionRequested",
				triggered_by: "system",
				transition_reason: undefined,
				metadata: { userId: "user123" },
				error_details: undefined,
				created_at: "2023-01-01T00:00:00.000Z",
			}]),
	);

	try {
		const mockContext = createMockContext("corr-123", mockUser);
		const response = await handleGetSubscriptionStatus(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		const statusData = response.data.data as Record<string, unknown>;
		assertEquals(statusData.current_state, "generating_invoice");
		assertEquals(
			statusData.message,
			"Generating your first invoice...",
		);
		const progress = statusData.progress as Record<string, number>;
		assertEquals(progress.completedSteps, 3);
		assertEquals(progress.percentage, 75);
	} finally {
		currentStateStub.restore();
		historyStub.restore();
	}
});

Deno.test("handleGetSubscriptionStatus - should handle unknown state with defaults", async () => {
	const mockUser = { id: "user123", email: "test@example.com" };

	const currentStateStub = stub(
		subscriptionStateManager,
		"getCurrentState",
		() =>
			Promise.resolve({
				entity_id: "corr-123",
				entity_type: "subscription_request",
				current_state: "some_unknown_state",
				state_updated_at: "2023-01-01T00:00:00.000Z",
				last_updated_by: "system",
				last_metadata: {},
			}),
	);

	const historyStub = stub(
		subscriptionStateManager,
		"getHistory",
		() =>
			Promise.resolve([{
				id: "trans-1",
				entity_type: "subscription_request",
				entity_id: "corr-123",
				from_state: null,
				to_state: "some_unknown_state",
				triggered_by: "system", // No event_type — tests fallback
				transition_reason: undefined,
				metadata: { userId: "user123" },
				error_details: undefined,
				created_at: "2023-01-01T00:00:00.000Z",
			}]),
	);

	try {
		const mockContext = createMockContext("corr-123", mockUser);
		const response = await handleGetSubscriptionStatus(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		const statusData = response.data.data as Record<string, unknown>;
		assertEquals(statusData.status, "processing");
		assertEquals(statusData.current_state, "some_unknown_state");
		// Default message for unknown state
		assertEquals(
			statusData.message,
			"Processing your subscription request...",
		);
		const progress = statusData.progress as Record<string, number>;
		assertEquals(progress.completedSteps, 0);

		// event_type fallback to to_state
		const events = statusData.events as Record<string, unknown>[];
		assertEquals(events[0].event_type, "some_unknown_state");
	} finally {
		currentStateStub.restore();
		historyStub.restore();
	}
});

Deno.test("handleGetSubscriptionStatus - should handle transitions with no metadata", async () => {
	const mockUser = { id: "user123", email: "test@example.com" };

	const currentStateStub = stub(
		subscriptionStateManager,
		"getCurrentState",
		() =>
			Promise.resolve({
				entity_id: "corr-123",
				entity_type: "subscription_request",
				current_state: "account_ready",
				state_updated_at: "2023-01-01T00:00:00.000Z",
				last_updated_by: "system",
				last_metadata: {},
			}),
	);

	const historyStub = stub(
		subscriptionStateManager,
		"getHistory",
		() =>
			Promise.resolve([
				{
					id: "trans-1",
					entity_type: "subscription_request",
					entity_id: "corr-123",
					from_state: null,
					to_state: "requested",
					event_type: "SubscriptionRequested",
					triggered_by: "system",
					transition_reason: undefined,
					// No metadata at all — exercises extractSagaData !meta path
					error_details: undefined,
					created_at: "2023-01-01T00:00:00.000Z",
				},
			]),
	);

	try {
		const mockContext = createMockContext("corr-123", mockUser);
		const response = await handleGetSubscriptionStatus(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 200);
		const statusData = response.data.data as Record<string, unknown>;
		// With no metadata, ownership check is skipped (no sagaUserId)
		assertEquals(statusData.status, "processing");
		// No extracted data
		const data = statusData.data as Record<string, string>;
		assertEquals(data.accountId, undefined);
	} finally {
		currentStateStub.restore();
		historyStub.restore();
	}
});
