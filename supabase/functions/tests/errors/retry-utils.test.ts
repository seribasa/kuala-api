import { assertEquals, assertRejects } from "@std/assert";
import {
	calculateBackoffDelay,
	DEFAULT_RETRY_CONFIG,
	withRetry,
	withRetryResult,
	withTimeout,
} from "../../_shared/errors/retry-utils.ts";

// =============================================================================
// calculateBackoffDelay Tests
// =============================================================================

Deno.test("calculateBackoffDelay - should calculate correct delay for attempt 0", () => {
	const delay = calculateBackoffDelay(0, {
		baseDelayMs: 1000,
		maxDelayMs: 30000,
		backoffMultiplier: 2,
		useJitter: false,
	});
	assertEquals(delay, 1000);
});

Deno.test("calculateBackoffDelay - should calculate correct delay for attempt 1", () => {
	const delay = calculateBackoffDelay(1, {
		baseDelayMs: 1000,
		maxDelayMs: 30000,
		backoffMultiplier: 2,
		useJitter: false,
	});
	assertEquals(delay, 2000);
});

Deno.test("calculateBackoffDelay - should calculate correct delay for attempt 2", () => {
	const delay = calculateBackoffDelay(2, {
		baseDelayMs: 1000,
		maxDelayMs: 30000,
		backoffMultiplier: 2,
		useJitter: false,
	});
	assertEquals(delay, 4000);
});

Deno.test("calculateBackoffDelay - should cap delay at maxDelayMs", () => {
	const delay = calculateBackoffDelay(10, {
		baseDelayMs: 1000,
		maxDelayMs: 30000,
		backoffMultiplier: 2,
		useJitter: false,
	});
	assertEquals(delay, 30000);
});

Deno.test("calculateBackoffDelay - should apply jitter when enabled", () => {
	const delays = new Set<number>();
	for (let i = 0; i < 10; i++) {
		const delay = calculateBackoffDelay(1, {
			baseDelayMs: 1000,
			maxDelayMs: 30000,
			backoffMultiplier: 2,
			useJitter: true,
		});
		delays.add(delay);
		// Delay should be between base delay and base delay + 25% jitter
		assertEquals(delay >= 2000 && delay <= 2500, true);
	}
});

Deno.test("calculateBackoffDelay - should use custom backoff multiplier", () => {
	const delay = calculateBackoffDelay(2, {
		baseDelayMs: 1000,
		maxDelayMs: 30000,
		backoffMultiplier: 3,
		useJitter: false,
	});
	assertEquals(delay, 9000); // 1000 * 3^2
});

// =============================================================================
// DEFAULT_RETRY_CONFIG Tests
// =============================================================================

Deno.test("DEFAULT_RETRY_CONFIG - should have correct default values", () => {
	assertEquals(DEFAULT_RETRY_CONFIG.maxRetries, 3);
	assertEquals(DEFAULT_RETRY_CONFIG.baseDelayMs, 1000);
	assertEquals(DEFAULT_RETRY_CONFIG.maxDelayMs, 30000);
	assertEquals(DEFAULT_RETRY_CONFIG.backoffMultiplier, 2);
	assertEquals(DEFAULT_RETRY_CONFIG.useJitter, true);
});

// =============================================================================
// withRetry Tests - Success Cases
// =============================================================================

Deno.test("withRetry - should return result on first success", async () => {
	let attempts = 0;
	const result = await withRetry(() => {
		attempts++;
		return Promise.resolve("success");
	});

	assertEquals(result, "success");
	assertEquals(attempts, 1);
});

Deno.test("withRetry - should retry and succeed on second attempt", async () => {
	let attempts = 0;
	const result = await withRetry(
		() => {
			attempts++;
			if (attempts === 1) {
				throw new Error("Connection refused");
			}
			return Promise.resolve("success");
		},
		{ maxRetries: 3, baseDelayMs: 10, useJitter: false },
	);

	assertEquals(result, "success");
	assertEquals(attempts, 2);
});

Deno.test("withRetry - should retry multiple times before success", async () => {
	let attempts = 0;
	const result = await withRetry(
		() => {
			attempts++;
			if (attempts < 3) {
				throw new Error("Service unavailable");
			}
			return Promise.resolve("success");
		},
		{ maxRetries: 5, baseDelayMs: 10, useJitter: false },
	);

	assertEquals(result, "success");
	assertEquals(attempts, 3);
});

// =============================================================================
// withRetry Tests - Failure Cases
// =============================================================================

Deno.test("withRetry - should throw after max retries exceeded", async () => {
	let attempts = 0;
	await assertRejects(
		async () => {
			await withRetry(
				() => {
					attempts++;
					throw new Error("Connection refused");
				},
				{ maxRetries: 3, baseDelayMs: 10, useJitter: false },
			);
		},
		Error,
	);

	assertEquals(attempts, 4); // Initial + 3 retries
});

Deno.test("withRetry - should not retry permanent errors", async () => {
	let attempts = 0;
	await assertRejects(
		async () => {
			await withRetry(
				() => {
					attempts++;
					throw new Error("Validation failed");
				},
				{ maxRetries: 3, baseDelayMs: 10, useJitter: false },
			);
		},
		Error,
	);

	assertEquals(attempts, 1); // No retries for permanent errors
});

Deno.test("withRetry - should not retry 404 errors", async () => {
	let attempts = 0;
	await assertRejects(
		async () => {
			await withRetry(
				() => {
					attempts++;
					throw new Error("404 Not Found");
				},
				{ maxRetries: 3, baseDelayMs: 10, useJitter: false },
			);
		},
		Error,
	);

	assertEquals(attempts, 1);
});

Deno.test("withRetry - should not retry duplicate errors", async () => {
	let attempts = 0;
	await assertRejects(
		async () => {
			await withRetry(
				() => {
					attempts++;
					throw new Error("Duplicate entry");
				},
				{ maxRetries: 3, baseDelayMs: 10, useJitter: false },
			);
		},
		Error,
	);

	assertEquals(attempts, 1);
});

// =============================================================================
// withRetry Tests - Callback Tests
// =============================================================================

Deno.test("withRetry - should call onRetry callback", async () => {
	const retryLogs: { attempt: number; delay: number }[] = [];
	let attempts = 0;

	await withRetry(
		() => {
			attempts++;
			if (attempts < 3) {
				throw new Error("Connection timeout");
			}
			return Promise.resolve("success");
		},
		{
			maxRetries: 5,
			baseDelayMs: 10,
			useJitter: false,
			onRetry: (_error, attempt, delay) => {
				retryLogs.push({ attempt, delay });
			},
		},
	);

	assertEquals(retryLogs.length, 2);
	assertEquals(retryLogs[0].attempt, 1);
	assertEquals(retryLogs[1].attempt, 2);
});

// =============================================================================
// withRetryResult Tests
// =============================================================================

Deno.test("withRetryResult - should return success result", async () => {
	const result = await withRetryResult(() => Promise.resolve("success"));

	assertEquals(result.success, true);
	if (result.success) {
		assertEquals(result.result, "success");
	}
});

Deno.test("withRetryResult - should return failure result without throwing", async () => {
	const result = await withRetryResult(
		() => {
			throw new Error("Validation failed");
		},
		{ maxRetries: 1, baseDelayMs: 10 },
	);

	assertEquals(result.success, false);
	if (!result.success) {
		assertEquals(result.error instanceof Error, true);
	}
});

Deno.test("withRetryResult - should include attempt count in result", async () => {
	let attempts = 0;
	const result = await withRetryResult(
		() => {
			attempts++;
			if (attempts < 2) {
				throw new Error("Connection refused");
			}
			return Promise.resolve("success");
		},
		{ maxRetries: 3, baseDelayMs: 10, useJitter: false },
	);

	assertEquals(result.success, true);
	assertEquals(result.attempts, 2);
});

// =============================================================================
// withTimeout Tests
// =============================================================================

Deno.test("withTimeout - should return result if completed within timeout", async () => {
	const result = await withTimeout(
		async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			return "success";
		},
		1000,
	);

	assertEquals(result, "success");
});

Deno.test({
	name: "withTimeout - should throw on timeout",
	sanitizeOps: false,
	sanitizeResources: false,
	fn: async () => {
		await assertRejects(
			async () => {
				await withTimeout(
					async () => {
						await new Promise((resolve) =>
							setTimeout(resolve, 1000)
						);
						return "success";
					},
					50,
				);
			},
			Error,
			"timed out",
		);
	},
});

// =============================================================================
// Integration Tests
// =============================================================================

Deno.test("withRetry + withTimeout - should work together", async () => {
	let attempts = 0;

	const result = await withRetry(
		async () => {
			return await withTimeout(
				() => {
					attempts++;
					if (attempts < 2) {
						throw new Error("Connection refused");
					}
					return Promise.resolve("success");
				},
				1000,
			);
		},
		{ maxRetries: 3, baseDelayMs: 10, useJitter: false },
	);

	assertEquals(result, "success");
	assertEquals(attempts, 2);
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("withRetry - should handle maxRetries of 0", async () => {
	let attempts = 0;
	await assertRejects(
		async () => {
			await withRetry(
				() => {
					attempts++;
					throw new Error("Connection refused");
				},
				{ maxRetries: 0, baseDelayMs: 10 },
			);
		},
	);

	assertEquals(attempts, 1);
});

Deno.test("withRetry - should handle async operations correctly", async () => {
	let attempts = 0;
	const start = Date.now();

	await withRetry(
		() => {
			attempts++;
			if (attempts < 2) {
				throw new Error("Connection refused");
			}
			return Promise.resolve("success");
		},
		{ maxRetries: 3, baseDelayMs: 50, useJitter: false },
	);

	const elapsed = Date.now() - start;
	// Should have waited at least 50ms between retries
	assertEquals(elapsed >= 50, true);
});
