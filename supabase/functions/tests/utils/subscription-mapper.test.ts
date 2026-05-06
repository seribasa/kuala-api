import { assertEquals } from "@std/assert";
import {
	mapKillBillStatus,
	mapKillBillSubscriptionToSubscription,
} from "../../kuala/utils/subscription-mapper.ts";
import type {
	KillBillSubscription,
	Subscription,
} from "../../_shared/types/index.ts";

// Tests for mapKillBillStatus function
Deno.test("mapKillBillStatus - should map ACTIVE to active", () => {
	const result = mapKillBillStatus("ACTIVE");
	assertEquals(result, "active");
});

Deno.test("mapKillBillStatus - should map active (lowercase) to active", () => {
	const result = mapKillBillStatus("active");
	assertEquals(result, "active");
});

Deno.test("mapKillBillStatus - should map TRIAL to trialing", () => {
	const result = mapKillBillStatus("TRIAL");
	assertEquals(result, "trialing");
});

Deno.test("mapKillBillStatus - should map trial (lowercase) to trialing", () => {
	const result = mapKillBillStatus("trial");
	assertEquals(result, "trialing");
});

Deno.test("mapKillBillStatus - should map PAUSED to paused", () => {
	const result = mapKillBillStatus("PAUSED");
	assertEquals(result, "paused");
});

Deno.test("mapKillBillStatus - should map paused (lowercase) to paused", () => {
	const result = mapKillBillStatus("paused");
	assertEquals(result, "paused");
});

Deno.test("mapKillBillStatus - should map CANCELLED to canceled", () => {
	const result = mapKillBillStatus("CANCELLED");
	assertEquals(result, "canceled");
});

Deno.test("mapKillBillStatus - should map cancelled (lowercase) to canceled", () => {
	const result = mapKillBillStatus("cancelled");
	assertEquals(result, "canceled");
});

Deno.test("mapKillBillStatus - should map PAST_DUE to past_due", () => {
	const result = mapKillBillStatus("PAST_DUE");
	assertEquals(result, "past_due");
});

Deno.test("mapKillBillStatus - should map past_due (lowercase) to past_due", () => {
	const result = mapKillBillStatus("past_due");
	assertEquals(result, "past_due");
});

Deno.test("mapKillBillStatus - should map mixed case statuses correctly", () => {
	assertEquals(mapKillBillStatus("Active"), "active");
	assertEquals(mapKillBillStatus("Trial"), "trialing");
	assertEquals(mapKillBillStatus("Paused"), "paused");
	assertEquals(mapKillBillStatus("Cancelled"), "canceled");
	assertEquals(mapKillBillStatus("Past_Due"), "past_due");
});

Deno.test("mapKillBillStatus - should return active as default for unknown status", () => {
	const result = mapKillBillStatus("UNKNOWN_STATUS");
	assertEquals(result, "active");
});

Deno.test("mapKillBillStatus - should return active as default for empty string", () => {
	const result = mapKillBillStatus("");
	assertEquals(result, "active");
});

Deno.test("mapKillBillStatus - should return active as default for null", () => {
	const result = mapKillBillStatus(null as unknown as string);
	assertEquals(result, "active");
});

Deno.test("mapKillBillStatus - should return active as default for undefined", () => {
	const result = mapKillBillStatus(undefined as unknown as string);
	assertEquals(result, "active");
});

Deno.test("mapKillBillStatus - should handle whitespace in status", () => {
	assertEquals(mapKillBillStatus(" ACTIVE "), "active");
	assertEquals(mapKillBillStatus("  TRIAL  "), "active"); // trimmed but not valid
});

// Tests for mapKillBillSubscriptionToSubscription function
Deno.test("mapKillBillSubscriptionToSubscription - should map complete subscription with ANNUAL billing", () => {
	const killBillSubscription: KillBillSubscription = {
		accountId: "kb-account-123",
		bundleId: "kb-bundle-456",
		subscriptionId: "kb-sub-789",
		externalKey: "ext-key-001",
		startDate: "2023-01-01T00:00:00Z",
		productName: "Premium Product",
		productCategory: "BASE",
		billingPeriod: "ANNUAL",
		priceList: "DEFAULT",
		planName: "premium-annual",
		state: "ACTIVE",
		sourceType: "USER_API",
		cancelledDate: null,
		chargedThroughDate: "2023-12-31T23:59:59Z",
		billingStartDate: "2023-01-01T00:00:00Z",
		billingEndDate: "2024-01-01T00:00:00Z",
		events: [],
		priceOverrides: [],
	};

	const userId = "user-123";
	const accountId = "account-456";

	const result = mapKillBillSubscriptionToSubscription(
		killBillSubscription,
		userId,
		accountId,
	);

	const expected: Subscription = {
		id: "kb-sub-789",
		userId: "user-123",
		planId: "premium-annual",
		interval: "year",
		status: "active",
		startDate: "2023-01-01T00:00:00Z",
		currentPeriodStart: "2023-12-31T23:59:59Z",
		currentPeriodEnd: "2024-01-01T00:00:00Z",
		billing: {
			accountId: "account-456",
			subscriptionId: "kb-sub-789",
			bundleId: "kb-bundle-456",
		},
	};

	assertEquals(result, expected);
});

Deno.test("mapKillBillSubscriptionToSubscription - should map subscription with MONTHLY billing", () => {
	const killBillSubscription: KillBillSubscription = {
		accountId: "kb-account-123",
		bundleId: "kb-bundle-456",
		subscriptionId: "kb-sub-789",
		externalKey: "ext-key-001",
		startDate: "2023-01-01T00:00:00Z",
		productName: "Basic Product",
		productCategory: "BASE",
		billingPeriod: "MONTHLY",
		priceList: "DEFAULT",
		planName: "basic-monthly",
		state: "TRIAL",
		sourceType: "USER_API",
		cancelledDate: null,
		chargedThroughDate: "2023-01-31T23:59:59Z",
		billingStartDate: "2023-01-01T00:00:00Z",
		billingEndDate: "2023-02-01T00:00:00Z",
		events: [],
		priceOverrides: [],
	};

	const userId = "user-456";

	const result = mapKillBillSubscriptionToSubscription(
		killBillSubscription,
		userId,
	);

	const expected: Subscription = {
		id: "kb-sub-789",
		userId: "user-456",
		planId: "basic-monthly",
		interval: "month",
		status: "trialing",
		startDate: "2023-01-01T00:00:00Z",
		currentPeriodStart: "2023-01-31T23:59:59Z",
		currentPeriodEnd: "2023-02-01T00:00:00Z",
		billing: {
			accountId: "kb-account-123", // Uses Kill Bill accountId when not provided
			subscriptionId: "kb-sub-789",
			bundleId: "kb-bundle-456",
		},
	};

	assertEquals(result, expected);
});

Deno.test("mapKillBillSubscriptionToSubscription - should handle missing planName", () => {
	const killBillSubscription: KillBillSubscription = {
		accountId: "kb-account-123",
		bundleId: "kb-bundle-456",
		subscriptionId: "kb-sub-789",
		externalKey: "ext-key-001",
		startDate: "2023-01-01T00:00:00Z",
		productName: "Unknown Product",
		productCategory: "BASE",
		billingPeriod: "MONTHLY",
		priceList: "DEFAULT",
		planName: "", // Empty plan name
		state: "ACTIVE",
		sourceType: "USER_API",
		cancelledDate: null,
		chargedThroughDate: "2023-01-31T23:59:59Z",
		billingStartDate: "2023-01-01T00:00:00Z",
		billingEndDate: "2023-02-01T00:00:00Z",
		events: [],
		priceOverrides: [],
	};

	const result = mapKillBillSubscriptionToSubscription(
		killBillSubscription,
		"user-123",
	);

	assertEquals(result.planId, "unknown");
});

Deno.test("mapKillBillSubscriptionToSubscription - should handle null planName", () => {
	const killBillSubscription: KillBillSubscription = {
		accountId: "kb-account-123",
		bundleId: "kb-bundle-456",
		subscriptionId: "kb-sub-789",
		externalKey: "ext-key-001",
		startDate: "2023-01-01T00:00:00Z",
		productName: "Unknown Product",
		productCategory: "BASE",
		billingPeriod: "MONTHLY",
		priceList: "DEFAULT",
		planName: null as unknown as string, // Null plan name
		state: "ACTIVE",
		sourceType: "USER_API",
		cancelledDate: null,
		chargedThroughDate: "2023-01-31T23:59:59Z",
		billingStartDate: "2023-01-01T00:00:00Z",
		billingEndDate: "2023-02-01T00:00:00Z",
		events: [],
		priceOverrides: [],
	};

	const result = mapKillBillSubscriptionToSubscription(
		killBillSubscription,
		"user-123",
	);

	assertEquals(result.planId, "unknown");
});

Deno.test("mapKillBillSubscriptionToSubscription - should handle missing chargedThroughDate", () => {
	const killBillSubscription: KillBillSubscription = {
		accountId: "kb-account-123",
		bundleId: "kb-bundle-456",
		subscriptionId: "kb-sub-789",
		externalKey: "ext-key-001",
		startDate: "2023-01-01T00:00:00Z",
		productName: "Product",
		productCategory: "BASE",
		billingPeriod: "MONTHLY",
		priceList: "DEFAULT",
		planName: "test-plan",
		state: "ACTIVE",
		sourceType: "USER_API",
		cancelledDate: null,
		chargedThroughDate: "", // Empty chargedThroughDate
		billingStartDate: "2023-01-01T00:00:00Z",
		billingEndDate: "2023-02-01T00:00:00Z",
		events: [],
		priceOverrides: [],
	};

	const result = mapKillBillSubscriptionToSubscription(
		killBillSubscription,
		"user-123",
	);

	assertEquals(result.currentPeriodStart, "2023-01-01T00:00:00Z"); // Falls back to startDate
});

Deno.test("mapKillBillSubscriptionToSubscription - should handle missing billingEndDate", () => {
	const killBillSubscription: KillBillSubscription = {
		accountId: "kb-account-123",
		bundleId: "kb-bundle-456",
		subscriptionId: "kb-sub-789",
		externalKey: "ext-key-001",
		startDate: "2023-01-01T00:00:00Z",
		productName: "Product",
		productCategory: "BASE",
		billingPeriod: "MONTHLY",
		priceList: "DEFAULT",
		planName: "test-plan",
		state: "ACTIVE",
		sourceType: "USER_API",
		cancelledDate: null,
		chargedThroughDate: "2023-01-31T23:59:59Z",
		billingStartDate: "2023-01-01T00:00:00Z",
		billingEndDate: "", // Empty billingEndDate
		events: [],
		priceOverrides: [],
	};

	const result = mapKillBillSubscriptionToSubscription(
		killBillSubscription,
		"user-123",
	);

	assertEquals(result.currentPeriodEnd, "2023-01-31T23:59:59Z"); // Falls back to chargedThroughDate
});

Deno.test("mapKillBillSubscriptionToSubscription - should handle all missing dates", () => {
	const killBillSubscription: KillBillSubscription = {
		accountId: "kb-account-123",
		bundleId: "kb-bundle-456",
		subscriptionId: "kb-sub-789",
		externalKey: "ext-key-001",
		startDate: "2023-01-01T00:00:00Z",
		productName: "Product",
		productCategory: "BASE",
		billingPeriod: "MONTHLY",
		priceList: "DEFAULT",
		planName: "test-plan",
		state: "ACTIVE",
		sourceType: "USER_API",
		cancelledDate: null,
		chargedThroughDate: "", // Empty
		billingStartDate: "2023-01-01T00:00:00Z",
		billingEndDate: "", // Empty
		events: [],
		priceOverrides: [],
	};

	const result = mapKillBillSubscriptionToSubscription(
		killBillSubscription,
		"user-123",
	);

	assertEquals(result.currentPeriodStart, "2023-01-01T00:00:00Z"); // Falls back to startDate
	assertEquals(result.currentPeriodEnd, "2023-01-01T00:00:00Z"); // Falls back to startDate
});

Deno.test("mapKillBillSubscriptionToSubscription - should handle all subscription statuses", () => {
	const baseSubscription: KillBillSubscription = {
		accountId: "kb-account-123",
		bundleId: "kb-bundle-456",
		subscriptionId: "kb-sub-789",
		externalKey: "ext-key-001",
		startDate: "2023-01-01T00:00:00Z",
		productName: "Product",
		productCategory: "BASE",
		billingPeriod: "MONTHLY",
		priceList: "DEFAULT",
		planName: "test-plan",
		state: "ACTIVE", // Will be overridden
		sourceType: "USER_API",
		cancelledDate: null,
		chargedThroughDate: "2023-01-31T23:59:59Z",
		billingStartDate: "2023-01-01T00:00:00Z",
		billingEndDate: "2023-02-01T00:00:00Z",
		events: [],
		priceOverrides: [],
	};

	const statuses = [
		{ killBillStatus: "ACTIVE", expectedStatus: "active" },
		{ killBillStatus: "TRIAL", expectedStatus: "trialing" },
		{ killBillStatus: "PAUSED", expectedStatus: "paused" },
		{ killBillStatus: "CANCELLED", expectedStatus: "canceled" },
		{ killBillStatus: "PAST_DUE", expectedStatus: "past_due" },
		{ killBillStatus: "UNKNOWN", expectedStatus: "active" },
	];

	statuses.forEach(({ killBillStatus, expectedStatus }) => {
		const testSubscription = { ...baseSubscription, state: killBillStatus };
		const result = mapKillBillSubscriptionToSubscription(
			testSubscription,
			"user-123",
		);
		assertEquals(result.status, expectedStatus);
	});
});

Deno.test("mapKillBillSubscriptionToSubscription - should handle non-ANNUAL billing periods as monthly", () => {
	const billingPeriods = [
		"MONTHLY",
		"WEEKLY",
		"DAILY",
		"QUARTERLY",
		"UNKNOWN",
	];

	const baseSubscription: KillBillSubscription = {
		accountId: "kb-account-123",
		bundleId: "kb-bundle-456",
		subscriptionId: "kb-sub-789",
		externalKey: "ext-key-001",
		startDate: "2023-01-01T00:00:00Z",
		productName: "Product",
		productCategory: "BASE",
		billingPeriod: "MONTHLY", // Will be overridden
		priceList: "DEFAULT",
		planName: "test-plan",
		state: "ACTIVE",
		sourceType: "USER_API",
		cancelledDate: null,
		chargedThroughDate: "2023-01-31T23:59:59Z",
		billingStartDate: "2023-01-01T00:00:00Z",
		billingEndDate: "2023-02-01T00:00:00Z",
		events: [],
		priceOverrides: [],
	};

	billingPeriods.forEach((billingPeriod) => {
		const testSubscription = { ...baseSubscription, billingPeriod };
		const result = mapKillBillSubscriptionToSubscription(
			testSubscription,
			"user-123",
		);
		const expectedInterval = billingPeriod === "ANNUAL" ? "year" : "month";
		assertEquals(result.interval, expectedInterval);
	});
});

Deno.test("mapKillBillSubscriptionToSubscription - should prioritize provided accountId over Kill Bill accountId", () => {
	const killBillSubscription: KillBillSubscription = {
		accountId: "kb-account-original",
		bundleId: "kb-bundle-456",
		subscriptionId: "kb-sub-789",
		externalKey: "ext-key-001",
		startDate: "2023-01-01T00:00:00Z",
		productName: "Product",
		productCategory: "BASE",
		billingPeriod: "MONTHLY",
		priceList: "DEFAULT",
		planName: "test-plan",
		state: "ACTIVE",
		sourceType: "USER_API",
		cancelledDate: null,
		chargedThroughDate: "2023-01-31T23:59:59Z",
		billingStartDate: "2023-01-01T00:00:00Z",
		billingEndDate: "2023-02-01T00:00:00Z",
		events: [],
		priceOverrides: [],
	};

	const result = mapKillBillSubscriptionToSubscription(
		killBillSubscription,
		"user-123",
		"provided-account-id",
	);

	assertEquals(result.billing.accountId, "provided-account-id");
});

Deno.test("mapKillBillSubscriptionToSubscription - should use Kill Bill accountId when not provided", () => {
	const killBillSubscription: KillBillSubscription = {
		accountId: "kb-account-fallback",
		bundleId: "kb-bundle-456",
		subscriptionId: "kb-sub-789",
		externalKey: "ext-key-001",
		startDate: "2023-01-01T00:00:00Z",
		productName: "Product",
		productCategory: "BASE",
		billingPeriod: "MONTHLY",
		priceList: "DEFAULT",
		planName: "test-plan",
		state: "ACTIVE",
		sourceType: "USER_API",
		cancelledDate: null,
		chargedThroughDate: "2023-01-31T23:59:59Z",
		billingStartDate: "2023-01-01T00:00:00Z",
		billingEndDate: "2023-02-01T00:00:00Z",
		events: [],
		priceOverrides: [],
	};

	const result = mapKillBillSubscriptionToSubscription(
		killBillSubscription,
		"user-123",
	);

	assertEquals(result.billing.accountId, "kb-account-fallback");
});

Deno.test("mapKillBillSubscriptionToSubscription - should handle empty string accountId parameter", () => {
	const killBillSubscription: KillBillSubscription = {
		accountId: "kb-account-fallback",
		bundleId: "kb-bundle-456",
		subscriptionId: "kb-sub-789",
		externalKey: "ext-key-001",
		startDate: "2023-01-01T00:00:00Z",
		productName: "Product",
		productCategory: "BASE",
		billingPeriod: "MONTHLY",
		priceList: "DEFAULT",
		planName: "test-plan",
		state: "ACTIVE",
		sourceType: "USER_API",
		cancelledDate: null,
		chargedThroughDate: "2023-01-31T23:59:59Z",
		billingStartDate: "2023-01-01T00:00:00Z",
		billingEndDate: "2023-02-01T00:00:00Z",
		events: [],
		priceOverrides: [],
	};

	const result = mapKillBillSubscriptionToSubscription(
		killBillSubscription,
		"user-123",
		"", // Empty string should fallback to Kill Bill accountId
	);

	assertEquals(result.billing.accountId, "kb-account-fallback");
});

Deno.test("mapKillBillSubscriptionToSubscription - should maintain consistent structure", () => {
	const killBillSubscription: KillBillSubscription = {
		accountId: "test-account",
		bundleId: "test-bundle",
		subscriptionId: "test-subscription",
		externalKey: "test-key",
		startDate: "2023-05-01T00:00:00Z",
		productName: "Test Product",
		productCategory: "BASE",
		billingPeriod: "ANNUAL",
		priceList: "DEFAULT",
		planName: "enterprise-annual",
		state: "CANCELLED",
		sourceType: "USER_API",
		cancelledDate: "2023-10-01T00:00:00Z",
		chargedThroughDate: "2023-12-31T23:59:59Z",
		billingStartDate: "2023-05-01T00:00:00Z",
		billingEndDate: "2024-05-01T00:00:00Z",
		events: [],
		priceOverrides: [],
	};

	const result = mapKillBillSubscriptionToSubscription(
		killBillSubscription,
		"user-enterprise",
		"enterprise-account",
	);

	// Verify structure is correct
	assertEquals(typeof result.id, "string");
	assertEquals(typeof result.userId, "string");
	assertEquals(typeof result.planId, "string");
	assertEquals(typeof result.interval, "string");
	assertEquals(typeof result.status, "string");
	assertEquals(typeof result.startDate, "string");
	assertEquals(typeof result.currentPeriodStart, "string");
	assertEquals(typeof result.currentPeriodEnd, "string");
	assertEquals(typeof result.billing, "object");
	assertEquals(typeof result.billing.accountId, "string");
	assertEquals(typeof result.billing.subscriptionId, "string");
	assertEquals(typeof result.billing.bundleId, "string");

	// Verify values
	assertEquals(result.id, "test-subscription");
	assertEquals(result.userId, "user-enterprise");
	assertEquals(result.planId, "enterprise-annual");
	assertEquals(result.interval, "year");
	assertEquals(result.status, "canceled");
	assertEquals(result.billing.accountId, "enterprise-account");
	assertEquals(result.billing.subscriptionId, "test-subscription");
	assertEquals(result.billing.bundleId, "test-bundle");
});
