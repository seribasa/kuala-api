/**
 * Error Handling Module
 *
 * Centralized error handling utilities for the event-driven subscription flow.
 */

// Error types and classification
export {
	ApplicationError,
	classifyError,
	createPartialError,
	createPermanentError,
	createTransientError,
	ErrorCodes,
	ErrorType,
	getErrorCode,
	isRetryableError,
	requiresCompensation,
} from "./error-types.ts";
export type { ClassifiedError, ErrorCode } from "./error-types.ts";

// Retry utilities
export {
	calculateBackoffDelay,
	createCircuitBreaker,
	createRetryWrapper,
	DEFAULT_RETRY_CONFIG,
	sleep,
	withRetry,
	withRetryResult,
	withTimeout,
} from "./retry-utils.ts";
export type {
	CircuitBreakerConfig,
	RetryConfig,
	RetryResult,
} from "./retry-utils.ts";
