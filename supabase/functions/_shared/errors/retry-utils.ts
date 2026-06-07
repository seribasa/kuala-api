/**
 * Retry Utilities with Exponential Backoff
 *
 * Provides retry mechanisms for transient failures in the subscription flow.
 */

import { isRetryableError } from "./error-types.ts";

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
	/** Maximum number of retry attempts (default: 3) */
	maxRetries: number;
	/** Base delay in milliseconds (default: 1000) */
	baseDelayMs: number;
	/** Maximum delay in milliseconds (default: 30000) */
	maxDelayMs: number;
	/** Multiplier for exponential backoff (default: 2) */
	backoffMultiplier: number;
	/** Whether to add jitter to delays (default: true) */
	useJitter: boolean;
	/** Custom function to determine if error is retryable */
	isRetryable?: (error: unknown, attempt: number) => boolean;
	/** Callback on each retry attempt */
	onRetry?: (error: unknown, attempt: number, delay: number) => void;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxRetries: 3,
	baseDelayMs: 1000,
	maxDelayMs: 30000,
	backoffMultiplier: 2,
	useJitter: true,
};

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
	success: boolean;
	result?: T;
	error?: unknown;
	attempts: number;
	totalDelayMs: number;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
export function calculateBackoffDelay(
	attempt: number,
	config: Pick<
		RetryConfig,
		"baseDelayMs" | "maxDelayMs" | "backoffMultiplier" | "useJitter"
	>,
): number {
	const exponentialDelay = config.baseDelayMs *
		Math.pow(config.backoffMultiplier, attempt);
	const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

	if (config.useJitter) {
		// Add random jitter between 0-25% of the delay
		const jitter = cappedDelay * 0.25 * Math.random();
		return Math.floor(cappedDelay + jitter);
	}

	return Math.floor(cappedDelay);
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an operation with retry logic
 *
 * @param operation - The async operation to execute
 * @param config - Retry configuration (optional, uses defaults)
 * @returns Promise with the operation result or throws after all retries exhausted
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => killBillService.createAccount(userId),
 *   { maxRetries: 3, baseDelayMs: 1000 }
 * );
 * ```
 */
export async function withRetry<T>(
	operation: () => Promise<T>,
	config: Partial<RetryConfig> = {},
): Promise<T> {
	const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
	let lastError: unknown;

	for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;

			// Check if we should retry
			const shouldRetry = fullConfig.isRetryable
				? fullConfig.isRetryable(error, attempt)
				: isRetryableError(error);

			// If not retryable or last attempt, throw
			if (!shouldRetry || attempt >= fullConfig.maxRetries) {
				throw error;
			}

			// Calculate delay
			const delay = calculateBackoffDelay(attempt, fullConfig);

			// Call retry callback if provided
			if (fullConfig.onRetry) {
				fullConfig.onRetry(error, attempt + 1, delay);
			}

			// Wait before retrying
			await sleep(delay);
		}
	}

	// Should not reach here, but TypeScript needs this
	throw lastError;
}

/**
 * Execute an operation with retry logic and return detailed result
 *
 * Unlike `withRetry`, this function never throws and instead returns
 * a result object indicating success or failure with details.
 *
 * @example
 * ```typescript
 * const result = await withRetryResult(
 *   () => publishEvent("subscription.requested", event),
 *   { maxRetries: 3 }
 * );
 *
 * if (!result.success) {
 *   console.log(`Failed after ${result.attempts} attempts`);
 *   // Handle failure
 * }
 * ```
 */
export async function withRetryResult<T>(
	operation: () => Promise<T>,
	config: Partial<RetryConfig> = {},
): Promise<RetryResult<T>> {
	const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
	let attempts = 0;
	let totalDelayMs = 0;
	let lastError: unknown;

	for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
		attempts++;
		try {
			const result = await operation();
			return {
				success: true,
				result,
				attempts,
				totalDelayMs,
			};
		} catch (error) {
			lastError = error;

			// Check if we should retry
			const shouldRetry = fullConfig.isRetryable
				? fullConfig.isRetryable(error, attempt)
				: isRetryableError(error);

			// If not retryable or last attempt, return failure
			if (!shouldRetry || attempt >= fullConfig.maxRetries) {
				return {
					success: false,
					error: lastError,
					attempts,
					totalDelayMs,
				};
			}

			// Calculate delay
			const delay = calculateBackoffDelay(attempt, fullConfig);
			totalDelayMs += delay;

			// Call retry callback if provided
			if (fullConfig.onRetry) {
				fullConfig.onRetry(error, attempt + 1, delay);
			}

			// Wait before retrying
			await sleep(delay);
		}
	}

	// Should not reach here
	return {
		success: false,
		error: lastError,
		attempts,
		totalDelayMs,
	};
}

/**
 * Create a retry wrapper for a specific operation
 *
 * @example
 * ```typescript
 * const retryablePublish = createRetryWrapper(
 *   (routingKey: string, event: DomainEvent) => publishEvent(routingKey, event),
 *   { maxRetries: 3, baseDelayMs: 500 }
 * );
 *
 * await retryablePublish("subscription.requested", event);
 * ```
 */
export function createRetryWrapper<TArgs extends unknown[], TResult>(
	operation: (...args: TArgs) => Promise<TResult>,
	config: Partial<RetryConfig> = {},
): (...args: TArgs) => Promise<TResult> {
	return (...args: TArgs) => withRetry(() => operation(...args), config);
}

/**
 * Circuit breaker state
 */
interface CircuitBreakerState {
	failures: number;
	lastFailure: number | null;
	state: "closed" | "open" | "half-open";
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
	/** Number of failures before opening circuit (default: 5) */
	failureThreshold: number;
	/** Time in ms to wait before trying again (default: 60000) */
	resetTimeoutMs: number;
	/** Number of successful calls to close circuit (default: 3) */
	successThreshold: number;
}

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
	failureThreshold: 5,
	resetTimeoutMs: 60000,
	successThreshold: 3,
};

/**
 * Create a circuit breaker wrapper for an operation
 *
 * Circuit breaker prevents cascading failures by failing fast when
 * a service is experiencing issues.
 *
 * @example
 * ```typescript
 * const protectedKillBillCall = createCircuitBreaker(
 *   () => killBillService.createAccount(userId),
 *   { failureThreshold: 5, resetTimeoutMs: 60000 }
 * );
 * ```
 */
export function createCircuitBreaker<T>(
	operation: () => Promise<T>,
	config: Partial<CircuitBreakerConfig> = {},
): () => Promise<T> {
	const fullConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
	const state: CircuitBreakerState = {
		failures: 0,
		lastFailure: null,
		state: "closed",
	};
	let successCount = 0;

	return async () => {
		// Check if circuit is open
		if (state.state === "open") {
			const timeSinceFailure = state.lastFailure
				? Date.now() - state.lastFailure
				: Infinity;

			if (timeSinceFailure < fullConfig.resetTimeoutMs) {
				throw new Error("Circuit breaker is open - failing fast");
			}

			// Try half-open
			state.state = "half-open";
			successCount = 0;
		}

		try {
			const result = await operation();

			// Success - update state
			if (state.state === "half-open") {
				successCount++;
				if (successCount >= fullConfig.successThreshold) {
					state.state = "closed";
					state.failures = 0;
				}
			} else {
				state.failures = 0;
			}

			return result;
		} catch (error) {
			state.failures++;
			state.lastFailure = Date.now();

			if (
				state.failures >= fullConfig.failureThreshold ||
				state.state === "half-open"
			) {
				state.state = "open";
			}

			throw error;
		}
	};
}

/**
 * Timeout wrapper for operations
 */
export async function withTimeout<T>(
	operation: () => Promise<T>,
	timeoutMs: number,
	errorMessage = "Operation timed out",
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
	});

	try {
		return await Promise.race([operation(), timeoutPromise]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
