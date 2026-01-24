import { assertEquals } from "@std/assert";
import {
	InvalidStateTransitionError,
	isValidTransition,
	VALID_STATE_TRANSITIONS,
} from "../../_shared/services/state-management.ts";

// =============================================================================
// VALID_STATE_TRANSITIONS Tests
// =============================================================================

Deno.test("VALID_STATE_TRANSITIONS - empty string transitions to requested", () => {
	assertEquals(VALID_STATE_TRANSITIONS[""], ["requested"]);
});

Deno.test("VALID_STATE_TRANSITIONS - requested can transition to account_ready, failed, cancelled", () => {
	const validTransitions = VALID_STATE_TRANSITIONS["requested"];
	assertEquals(validTransitions.includes("account_ready"), true);
	assertEquals(validTransitions.includes("failed"), true);
	assertEquals(validTransitions.includes("cancelled"), true);
});

Deno.test("VALID_STATE_TRANSITIONS - account_ready can transition to creating_subscription, failed, cancelled", () => {
	const validTransitions = VALID_STATE_TRANSITIONS["account_ready"];
	assertEquals(validTransitions.includes("creating_subscription"), true);
	assertEquals(validTransitions.includes("failed"), true);
	assertEquals(validTransitions.includes("cancelled"), true);
});

Deno.test("VALID_STATE_TRANSITIONS - creating_subscription can transition to subscription_created, failed, cancelled", () => {
	const validTransitions = VALID_STATE_TRANSITIONS["creating_subscription"];
	assertEquals(validTransitions.includes("subscription_created"), true);
	assertEquals(validTransitions.includes("failed"), true);
	assertEquals(validTransitions.includes("cancelled"), true);
});

Deno.test("VALID_STATE_TRANSITIONS - subscription_created can transition to generating_invoice, failed, cancelled", () => {
	const validTransitions = VALID_STATE_TRANSITIONS["subscription_created"];
	assertEquals(validTransitions.includes("generating_invoice"), true);
	assertEquals(validTransitions.includes("failed"), true);
	assertEquals(validTransitions.includes("cancelled"), true);
});

Deno.test("VALID_STATE_TRANSITIONS - generating_invoice can transition to completed, failed, cancelled", () => {
	const validTransitions = VALID_STATE_TRANSITIONS["generating_invoice"];
	assertEquals(validTransitions.includes("completed"), true);
	assertEquals(validTransitions.includes("failed"), true);
	assertEquals(validTransitions.includes("cancelled"), true);
});

Deno.test("VALID_STATE_TRANSITIONS - completed has no valid transitions", () => {
	assertEquals(VALID_STATE_TRANSITIONS["completed"], []);
});

Deno.test("VALID_STATE_TRANSITIONS - failed can transition to requested (retry)", () => {
	const validTransitions = VALID_STATE_TRANSITIONS["failed"];
	assertEquals(validTransitions.includes("requested"), true);
});

Deno.test("VALID_STATE_TRANSITIONS - cancelled has no valid transitions", () => {
	assertEquals(VALID_STATE_TRANSITIONS["cancelled"], []);
});

// =============================================================================
// isValidTransition Tests
// =============================================================================

Deno.test("isValidTransition - should allow initial transition to requested", () => {
	assertEquals(isValidTransition("", "requested"), true);
});

Deno.test("isValidTransition - should allow requested to account_ready", () => {
	assertEquals(isValidTransition("requested", "account_ready"), true);
});

Deno.test("isValidTransition - should allow requested to failed", () => {
	assertEquals(isValidTransition("requested", "failed"), true);
});

Deno.test("isValidTransition - should allow requested to cancelled", () => {
	assertEquals(isValidTransition("requested", "cancelled"), true);
});

Deno.test("isValidTransition - should not allow requested to subscription_created", () => {
	assertEquals(isValidTransition("requested", "subscription_created"), false);
});

Deno.test("isValidTransition - should not allow requested to completed", () => {
	assertEquals(isValidTransition("requested", "completed"), false);
});

Deno.test("isValidTransition - should allow account_ready to creating_subscription", () => {
	assertEquals(
		isValidTransition("account_ready", "creating_subscription"),
		true,
	);
});

Deno.test("isValidTransition - should not allow account_ready to completed", () => {
	assertEquals(isValidTransition("account_ready", "completed"), false);
});

Deno.test("isValidTransition - should allow creating_subscription to subscription_created", () => {
	assertEquals(
		isValidTransition("creating_subscription", "subscription_created"),
		true,
	);
});

Deno.test("isValidTransition - should allow subscription_created to generating_invoice", () => {
	assertEquals(
		isValidTransition("subscription_created", "generating_invoice"),
		true,
	);
});

Deno.test("isValidTransition - should allow generating_invoice to completed", () => {
	assertEquals(isValidTransition("generating_invoice", "completed"), true);
});

Deno.test("isValidTransition - should not allow completed to any state", () => {
	assertEquals(isValidTransition("completed", "requested"), false);
	assertEquals(isValidTransition("completed", "failed"), false);
	assertEquals(isValidTransition("completed", "cancelled"), false);
});

Deno.test("isValidTransition - should allow failed to requested (retry)", () => {
	assertEquals(isValidTransition("failed", "requested"), true);
});

Deno.test("isValidTransition - should not allow failed to completed", () => {
	assertEquals(isValidTransition("failed", "completed"), false);
});

Deno.test("isValidTransition - should not allow cancelled to any state", () => {
	assertEquals(isValidTransition("cancelled", "requested"), false);
	assertEquals(isValidTransition("cancelled", "failed"), false);
});

Deno.test("isValidTransition - should not allow skipping states", () => {
	// Cannot skip from requested directly to subscription_created
	assertEquals(isValidTransition("requested", "subscription_created"), false);
	// Cannot skip from account_ready directly to completed
	assertEquals(isValidTransition("account_ready", "completed"), false);
	// Cannot skip from creating_subscription to completed
	assertEquals(
		isValidTransition("creating_subscription", "completed"),
		false,
	);
});

Deno.test("isValidTransition - should not allow going backwards", () => {
	assertEquals(isValidTransition("account_ready", "requested"), false);
	assertEquals(
		isValidTransition("creating_subscription", "account_ready"),
		false,
	);
	assertEquals(
		isValidTransition("subscription_created", "creating_subscription"),
		false,
	);
	assertEquals(
		isValidTransition("generating_invoice", "subscription_created"),
		false,
	);
	assertEquals(isValidTransition("completed", "generating_invoice"), false);
});

// =============================================================================
// InvalidStateTransitionError Tests
// =============================================================================

Deno.test("InvalidStateTransitionError - should include from and to states in message", () => {
	const error = new InvalidStateTransitionError(
		"requested",
		"completed",
		"subscription_request",
		"test-entity-id",
	);
	assertEquals(error.message.includes("requested"), true);
	assertEquals(error.message.includes("completed"), true);
});

Deno.test("InvalidStateTransitionError - should have correct name", () => {
	const error = new InvalidStateTransitionError(
		"requested",
		"completed",
		"subscription_request",
		"test-entity-id",
	);
	assertEquals(error.name, "InvalidStateTransitionError");
});

Deno.test("InvalidStateTransitionError - should expose fromState and toState", () => {
	const error = new InvalidStateTransitionError(
		"requested",
		"completed",
		"subscription_request",
		"test-entity-id",
	);
	assertEquals(error.fromState, "requested");
	assertEquals(error.toState, "completed");
});

Deno.test("InvalidStateTransitionError - should be instance of Error", () => {
	const error = new InvalidStateTransitionError(
		"requested",
		"completed",
		"subscription_request",
		"test-entity-id",
	);
	assertEquals(error instanceof Error, true);
});

// =============================================================================
// Happy Path Tests
// =============================================================================

Deno.test("isValidTransition - full happy path should be valid", () => {
	const happyPath: [string, string][] = [
		["", "requested"],
		["requested", "account_ready"],
		["account_ready", "creating_subscription"],
		["creating_subscription", "subscription_created"],
		["subscription_created", "generating_invoice"],
		["generating_invoice", "completed"],
	];

	for (const [from, to] of happyPath) {
		assertEquals(
			isValidTransition(from, to),
			true,
			`Transition from ${from} to ${to} should be valid`,
		);
	}
});

Deno.test("isValidTransition - failure and retry path should be valid", () => {
	// Path: requested -> failed -> requested (retry)
	assertEquals(isValidTransition("requested", "failed"), true);
	assertEquals(isValidTransition("failed", "requested"), true);
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("isValidTransition - same state transition should not be valid", () => {
	assertEquals(isValidTransition("requested", "requested"), false);
	assertEquals(isValidTransition("account_ready", "account_ready"), false);
	assertEquals(isValidTransition("completed", "completed"), false);
});

Deno.test("isValidTransition - should allow any transition for non-subscription_request entity type", () => {
	// Other entity types are not validated
	assertEquals(
		isValidTransition("requested", "completed", "other_entity"),
		true,
	);
});
