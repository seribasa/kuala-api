import { assertEquals, assertInstanceOf } from "@std/assert";
import {
	ApplicationError,
	classifyError,
	ErrorCodes,
	ErrorType,
	getErrorCode,
	isRetryableError,
} from "../../_shared/errors/error-types.ts";

// =============================================================================
// ApplicationError Tests
// =============================================================================

Deno.test("ApplicationError - should create error with all properties", () => {
	const error = new ApplicationError(
		ErrorCodes.KILLBILL_CONNECTION_ERROR,
		"Test error message",
		{ type: ErrorType.TRANSIENT, retryable: true },
	);

	assertEquals(error.message, "Test error message");
	assertEquals(error.type, ErrorType.TRANSIENT);
	assertEquals(error.code, ErrorCodes.KILLBILL_CONNECTION_ERROR);
	assertEquals(error.retryable, true);
	assertInstanceOf(error, Error);
});

Deno.test("ApplicationError - should default to PERMANENT type if not specified", () => {
	const error = new ApplicationError(
		ErrorCodes.INTERNAL_ERROR,
		"Test error",
	);

	assertEquals(error.type, ErrorType.PERMANENT);
	assertEquals(error.code, ErrorCodes.INTERNAL_ERROR);
	assertEquals(error.retryable, false);
});

Deno.test("ApplicationError - should have correct name", () => {
	const error = new ApplicationError(ErrorCodes.INTERNAL_ERROR, "Test error");
	assertEquals(error.name, "ApplicationError");
});

// =============================================================================
// classifyError Tests - TRANSIENT Errors
// =============================================================================

Deno.test("classifyError - should classify connection refused as TRANSIENT", () => {
	const error = new Error("ECONNREFUSED: connection refused");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.TRANSIENT);
});

Deno.test("classifyError - should classify network error as TRANSIENT", () => {
	const error = new Error("Network error: unable to reach server");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.TRANSIENT);
});

Deno.test("classifyError - should classify timeout as TRANSIENT", () => {
	const error = new Error("Request timed out");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.TRANSIENT);
});

Deno.test("classifyError - should classify ETIMEDOUT as TRANSIENT", () => {
	const error = new Error("ETIMEDOUT");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.TRANSIENT);
});

Deno.test("classifyError - should classify 503 as TRANSIENT", () => {
	const error = new Error("503 Service Unavailable");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.TRANSIENT);
});

Deno.test("classifyError - should classify service unavailable as TRANSIENT", () => {
	const error = new Error("Service temporarily unavailable");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.TRANSIENT);
});

Deno.test("classifyError - should classify 429 as TRANSIENT", () => {
	const error = new Error("429 Too Many Requests");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.TRANSIENT);
});

Deno.test("classifyError - should classify rate limit as TRANSIENT", () => {
	const error = new Error("Rate limit exceeded");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.TRANSIENT);
});

Deno.test("classifyError - should classify fetch failed as TRANSIENT", () => {
	const error = new Error("error sending request for url: fetch failed");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.TRANSIENT);
});

Deno.test("classifyError - should classify DNS resolution failed as TRANSIENT", () => {
	const error = new Error("DNS resolution failed");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.TRANSIENT);
});

Deno.test("classifyError - should classify socket hang up as TRANSIENT", () => {
	const error = new Error("socket hang up");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.TRANSIENT);
});

Deno.test("classifyError - should classify ECONNRESET as TRANSIENT", () => {
	const error = new Error("ECONNRESET: connection reset by peer");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.TRANSIENT);
});

// =============================================================================
// classifyError Tests - PERMANENT Errors
// =============================================================================

Deno.test("classifyError - should classify validation failed as PERMANENT", () => {
	const error = new Error("Validation failed: invalid input");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.PERMANENT);
});

Deno.test("classifyError - should classify 400 bad request as PERMANENT", () => {
	const error = new Error("400 Bad Request");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.PERMANENT);
});

Deno.test("classifyError - should classify not found as PERMANENT", () => {
	const error = new Error("Resource not found");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.PERMANENT);
});

Deno.test("classifyError - should classify 404 as PERMANENT", () => {
	const error = new Error("404 Not Found");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.PERMANENT);
});

Deno.test("classifyError - should classify duplicate as PERMANENT", () => {
	const error = new Error("Duplicate entry: already exists");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.PERMANENT);
});

Deno.test("classifyError - should classify 409 conflict as PERMANENT", () => {
	const error = new Error("409 Conflict");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.PERMANENT);
});

Deno.test("classifyError - should classify invalid as PERMANENT", () => {
	const error = new Error("Invalid configuration");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.PERMANENT);
});

Deno.test("classifyError - should classify authentication error as PERMANENT", () => {
	const error = new Error("401 Unauthorized");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.PERMANENT);
});

Deno.test("classifyError - should classify authorization error as PERMANENT", () => {
	const error = new Error("403 Forbidden");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.PERMANENT);
});

// =============================================================================
// classifyError Tests - Default Behavior
// =============================================================================

Deno.test("classifyError - should default to PERMANENT for unknown errors", () => {
	const error = new Error("Some random error");
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.PERMANENT);
});

Deno.test("classifyError - should handle non-Error objects", () => {
	const error = "String error";
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.PERMANENT);
});

Deno.test("classifyError - should handle null", () => {
	const classified = classifyError(null);
	assertEquals(classified.type, ErrorType.PERMANENT);
});

Deno.test("classifyError - should handle undefined", () => {
	const classified = classifyError(undefined);
	assertEquals(classified.type, ErrorType.PERMANENT);
});

Deno.test("classifyError - should preserve ApplicationError type", () => {
	const error = new ApplicationError(
		ErrorCodes.KILLBILL_TIMEOUT,
		"Custom error",
		{ type: ErrorType.TRANSIENT },
	);
	const classified = classifyError(error);
	assertEquals(classified.type, ErrorType.TRANSIENT);
});

// =============================================================================
// isRetryableError Tests
// =============================================================================

Deno.test("isRetryableError - should return true for TRANSIENT errors", () => {
	const error = new Error("Connection refused");
	assertEquals(isRetryableError(error), true);
});

Deno.test("isRetryableError - should return false for PERMANENT errors", () => {
	const error = new Error("Validation failed");
	assertEquals(isRetryableError(error), false);
});

Deno.test("isRetryableError - should return true for ApplicationError with retryable flag", () => {
	const error = new ApplicationError(
		ErrorCodes.KILLBILL_TIMEOUT,
		"Timeout",
		{ type: ErrorType.TRANSIENT, retryable: true },
	);
	assertEquals(isRetryableError(error), true);
});

Deno.test("isRetryableError - should return false for ApplicationError without retryable flag", () => {
	const error = new ApplicationError(
		ErrorCodes.MISSING_PLAN_ID,
		"Invalid input",
		{ type: ErrorType.PERMANENT, retryable: false },
	);
	assertEquals(isRetryableError(error), false);
});

// =============================================================================
// getErrorCode Tests
// =============================================================================

Deno.test("getErrorCode - should return code from ApplicationError", () => {
	const error = new ApplicationError(
		ErrorCodes.MISSING_PLAN_ID,
		"Test",
		{ type: ErrorType.PERMANENT },
	);
	assertEquals(getErrorCode(error), ErrorCodes.MISSING_PLAN_ID);
});

Deno.test("getErrorCode - should return KILLBILL_CONNECTION_ERROR for connection errors", () => {
	const error = new Error("ECONNREFUSED");
	assertEquals(getErrorCode(error), ErrorCodes.KILLBILL_CONNECTION_ERROR);
});

Deno.test("getErrorCode - should return KILLBILL_TIMEOUT for timeout errors", () => {
	const error = new Error("Request timed out");
	assertEquals(getErrorCode(error), ErrorCodes.KILLBILL_TIMEOUT);
});

Deno.test("getErrorCode - should return DUPLICATE_SUBSCRIPTION for duplicate errors", () => {
	const error = new Error("Duplicate entry");
	assertEquals(getErrorCode(error), ErrorCodes.DUPLICATE_SUBSCRIPTION);
});

Deno.test("getErrorCode - should return UNKNOWN_ERROR for unknown errors", () => {
	const error = new Error("Random error");
	assertEquals(getErrorCode(error), ErrorCodes.UNKNOWN_ERROR);
});

// =============================================================================
// ErrorCodes Constants Tests
// =============================================================================

Deno.test("ErrorCodes - should have all required error codes", () => {
	assertEquals(typeof ErrorCodes.MISSING_PLAN_ID, "string");
	assertEquals(typeof ErrorCodes.INVALID_USER_ID, "string");
	assertEquals(typeof ErrorCodes.INVALID_EVENT_STRUCTURE, "string");
	assertEquals(typeof ErrorCodes.DUPLICATE_SUBSCRIPTION, "string");
	assertEquals(typeof ErrorCodes.PENDING_SUBSCRIPTION_REQUEST, "string");
	assertEquals(typeof ErrorCodes.KILLBILL_CONNECTION_ERROR, "string");
	assertEquals(typeof ErrorCodes.KILLBILL_TIMEOUT, "string");
	assertEquals(typeof ErrorCodes.RABBITMQ_CONNECTION_ERROR, "string");
	assertEquals(typeof ErrorCodes.RABBITMQ_PUBLISH_ERROR, "string");
	assertEquals(typeof ErrorCodes.STATE_TRANSITION_FAILED, "string");
	assertEquals(typeof ErrorCodes.INVALID_STATE_TRANSITION, "string");
	assertEquals(typeof ErrorCodes.HANDLER_TIMEOUT, "string");
	assertEquals(typeof ErrorCodes.MAX_RETRIES_EXCEEDED, "string");
	assertEquals(typeof ErrorCodes.INTERNAL_ERROR, "string");
});

// =============================================================================
// ErrorType Enum Tests
// =============================================================================

Deno.test("ErrorType - should have correct values", () => {
	assertEquals(ErrorType.TRANSIENT, "TRANSIENT");
	assertEquals(ErrorType.PERMANENT, "PERMANENT");
	assertEquals(ErrorType.PARTIAL, "PARTIAL");
});

// =============================================================================
// Missing Functions Tests
// =============================================================================

import {
	createTransientError,
	createPermanentError,
	createPartialError,
	requiresCompensation,
} from "../../_shared/errors/error-types.ts";

Deno.test("ApplicationError - toJSON should return plain object", () => {
	const err = new ApplicationError(ErrorCodes.INTERNAL_ERROR, "msg", { type: ErrorType.TRANSIENT, retryable: true, compensationRequired: true });
	const json = err.toJSON();
	assertEquals(json.name, "ApplicationError");
	assertEquals(json.code, ErrorCodes.INTERNAL_ERROR);
	assertEquals(json.type, ErrorType.TRANSIENT);
	assertEquals(json.message, "msg");
	assertEquals(json.retryable, true);
	assertEquals(json.compensationRequired, true);
});

Deno.test("requiresCompensation - should return true if required", () => {
	const err = new ApplicationError(ErrorCodes.INTERNAL_ERROR, "msg", { compensationRequired: true });
	assertEquals(requiresCompensation(err), true);
	assertEquals(requiresCompensation(new Error("standard error")), false);
});

Deno.test("createTransientError - should create right error", () => {
	const err = createTransientError(ErrorCodes.INTERNAL_ERROR, "msg", new Error("cause"));
	assertEquals(err.type, ErrorType.TRANSIENT);
	assertEquals(err.retryable, true);
	assertEquals(err.compensationRequired, false);
	assertEquals(err.originalError?.message, "cause");
});

Deno.test("createPermanentError - should create right error", () => {
	const err = createPermanentError(ErrorCodes.INTERNAL_ERROR, "msg", new Error("cause"));
	assertEquals(err.type, ErrorType.PERMANENT);
	assertEquals(err.retryable, false);
	assertEquals(err.compensationRequired, false);
});

Deno.test("createPartialError - should create right error", () => {
	const err = createPartialError(ErrorCodes.INTERNAL_ERROR, "msg", new Error("cause"));
	assertEquals(err.type, ErrorType.PARTIAL);
	assertEquals(err.retryable, false);
	assertEquals(err.compensationRequired, true);
});

