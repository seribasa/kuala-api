/**
 * Error Classification System for Event-Driven Subscription Flow
 *
 * This module provides a standardized error classification system that helps
 * determine how errors should be handled (retry, fail, compensate).
 */

/**
 * Error categories for classification
 */
export enum ErrorType {
	/** Transient errors that may succeed on retry (network issues, timeouts) */
	TRANSIENT = "TRANSIENT",
	/** Permanent errors that won't succeed on retry (validation, business logic) */
	PERMANENT = "PERMANENT",
	/** Partial failures that require compensation (rollback) */
	PARTIAL = "PARTIAL",
}

/**
 * Error codes for subscription flow
 */
export const ErrorCodes = {
	// Validation errors (PERMANENT)
	MISSING_PLAN_ID: "MISSING_PLAN_ID",
	INVALID_USER_ID: "INVALID_USER_ID",
	INVALID_EVENT_STRUCTURE: "INVALID_EVENT_STRUCTURE",

	// Duplicate/conflict errors (PERMANENT)
	DUPLICATE_SUBSCRIPTION: "DUPLICATE_SUBSCRIPTION",
	PENDING_SUBSCRIPTION_REQUEST: "PENDING_SUBSCRIPTION_REQUEST",

	// External service errors (TRANSIENT)
	KILLBILL_CONNECTION_ERROR: "KILLBILL_CONNECTION_ERROR",
	KILLBILL_TIMEOUT: "KILLBILL_TIMEOUT",
	RABBITMQ_CONNECTION_ERROR: "RABBITMQ_CONNECTION_ERROR",
	RABBITMQ_PUBLISH_ERROR: "RABBITMQ_PUBLISH_ERROR",
	SUPABASE_CONNECTION_ERROR: "SUPABASE_CONNECTION_ERROR",

	// External service errors (PERMANENT)
	KILLBILL_VALIDATION_ERROR: "KILLBILL_VALIDATION_ERROR",
	KILLBILL_NOT_FOUND: "KILLBILL_NOT_FOUND",

	// State management errors
	STATE_TRANSITION_FAILED: "STATE_TRANSITION_FAILED",
	INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",

	// Processing errors
	HANDLER_TIMEOUT: "HANDLER_TIMEOUT",
	MAX_RETRIES_EXCEEDED: "MAX_RETRIES_EXCEEDED",

	// Internal errors
	INTERNAL_ERROR: "INTERNAL_ERROR",
	UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Classified error with retry and compensation information
 */
export interface ClassifiedError {
	type: ErrorType;
	code: ErrorCode;
	message: string;
	originalError?: Error;
	retryable: boolean;
	compensationRequired: boolean;
	suggestedRetryDelay?: number;
}

/**
 * Application-specific error with classification
 */
export class ApplicationError extends Error {
	public readonly type: ErrorType;
	public readonly code: ErrorCode;
	public readonly retryable: boolean;
	public readonly compensationRequired: boolean;
	public readonly originalError?: Error;

	constructor(
		code: ErrorCode,
		message: string,
		options?: {
			type?: ErrorType;
			retryable?: boolean;
			compensationRequired?: boolean;
			cause?: Error;
		},
	) {
		super(message);
		this.name = "ApplicationError";
		this.code = code;
		this.type = options?.type ?? ErrorType.PERMANENT;
		this.retryable = options?.retryable ?? false;
		this.compensationRequired = options?.compensationRequired ?? false;
		this.originalError = options?.cause;

		// Maintain proper stack trace for V8
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, ApplicationError);
		}
	}

	toJSON() {
		return {
			name: this.name,
			code: this.code,
			type: this.type,
			message: this.message,
			retryable: this.retryable,
			compensationRequired: this.compensationRequired,
		};
	}
}

/**
 * Error patterns for classification
 */
const ERROR_PATTERNS: Array<{
	pattern: RegExp | ((error: Error) => boolean);
	classification: Omit<ClassifiedError, "message" | "originalError">;
}> = [
	// Network/Connection errors (TRANSIENT)
	{
		pattern: /connection.*refused|ECONNREFUSED|network.*error/i,
		classification: {
			type: ErrorType.TRANSIENT,
			code: ErrorCodes.KILLBILL_CONNECTION_ERROR,
			retryable: true,
			compensationRequired: false,
			suggestedRetryDelay: 1000,
		},
	},
	{
		pattern: /timeout|ETIMEDOUT|timed out/i,
		classification: {
			type: ErrorType.TRANSIENT,
			code: ErrorCodes.KILLBILL_TIMEOUT,
			retryable: true,
			compensationRequired: false,
			suggestedRetryDelay: 2000,
		},
	},
	{
		pattern: /RabbitMQ.*connection|AMQP.*error/i,
		classification: {
			type: ErrorType.TRANSIENT,
			code: ErrorCodes.RABBITMQ_CONNECTION_ERROR,
			retryable: true,
			compensationRequired: false,
			suggestedRetryDelay: 1000,
		},
	},
	// Service unavailable (TRANSIENT)
	{
		pattern: /503|service.*unavailable|temporarily.*unavailable/i,
		classification: {
			type: ErrorType.TRANSIENT,
			code: ErrorCodes.KILLBILL_CONNECTION_ERROR,
			retryable: true,
			compensationRequired: false,
			suggestedRetryDelay: 5000,
		},
	},
	// Rate limiting (TRANSIENT)
	{
		pattern: /429|rate.*limit|too many requests/i,
		classification: {
			type: ErrorType.TRANSIENT,
			code: ErrorCodes.KILLBILL_CONNECTION_ERROR,
			retryable: true,
			compensationRequired: false,
			suggestedRetryDelay: 10000,
		},
	},
	// Validation errors (PERMANENT)
	{
		pattern: /validation.*failed|invalid.*input|400.*bad.*request/i,
		classification: {
			type: ErrorType.PERMANENT,
			code: ErrorCodes.KILLBILL_VALIDATION_ERROR,
			retryable: false,
			compensationRequired: false,
		},
	},
	// Not found (PERMANENT)
	{
		pattern: /not.*found|404|does not exist/i,
		classification: {
			type: ErrorType.PERMANENT,
			code: ErrorCodes.KILLBILL_NOT_FOUND,
			retryable: false,
			compensationRequired: false,
		},
	},
	// Duplicate errors (PERMANENT)
	{
		pattern: /duplicate|already exists|conflict|409/i,
		classification: {
			type: ErrorType.PERMANENT,
			code: ErrorCodes.DUPLICATE_SUBSCRIPTION,
			retryable: false,
			compensationRequired: false,
		},
	},
	// State transition errors
	{
		pattern: /invalid.*state.*transition/i,
		classification: {
			type: ErrorType.PERMANENT,
			code: ErrorCodes.INVALID_STATE_TRANSITION,
			retryable: false,
			compensationRequired: false,
		},
	},
];

/**
 * Classify an error based on its characteristics
 */
export function classifyError(error: unknown): ClassifiedError {
	const errorObj = error instanceof Error ? error : new Error(String(error));
	const errorMessage = errorObj.message;

	// Check against known patterns
	for (const { pattern, classification } of ERROR_PATTERNS) {
		const matches = typeof pattern === "function"
			? pattern(errorObj)
			: pattern.test(errorMessage);

		if (matches) {
			return {
				...classification,
				message: errorMessage,
				originalError: errorObj,
			};
		}
	}

	// Default classification for unknown errors
	return {
		type: ErrorType.PERMANENT,
		code: ErrorCodes.UNKNOWN_ERROR,
		message: errorMessage,
		originalError: errorObj,
		retryable: false,
		compensationRequired: false,
	};
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
	if (error instanceof ApplicationError) {
		return error.retryable;
	}
	return classifyError(error).retryable;
}

/**
 * Check if an error requires compensation
 */
export function requiresCompensation(error: unknown): boolean {
	if (error instanceof ApplicationError) {
		return error.compensationRequired;
	}
	return classifyError(error).compensationRequired;
}

/**
 * Get error code from error
 */
export function getErrorCode(error: unknown): ErrorCode {
	if (error instanceof ApplicationError) {
		return error.code;
	}
	return classifyError(error).code;
}

/**
 * Create a transient error
 */
export function createTransientError(
	code: ErrorCode,
	message: string,
	cause?: Error,
): ApplicationError {
	return new ApplicationError(code, message, {
		type: ErrorType.TRANSIENT,
		retryable: true,
		compensationRequired: false,
		cause,
	});
}

/**
 * Create a permanent error
 */
export function createPermanentError(
	code: ErrorCode,
	message: string,
	cause?: Error,
): ApplicationError {
	return new ApplicationError(code, message, {
		type: ErrorType.PERMANENT,
		retryable: false,
		compensationRequired: false,
		cause,
	});
}

/**
 * Create a partial failure error that requires compensation
 */
export function createPartialError(
	code: ErrorCode,
	message: string,
	cause?: Error,
): ApplicationError {
	return new ApplicationError(code, message, {
		type: ErrorType.PARTIAL,
		retryable: false,
		compensationRequired: true,
		cause,
	});
}
