import { assertEquals, assertStringIncludes } from "@std/assert";
import {
	authLogger,
	customLogger,
	log,
	type LogData,
	logger,
	type LogLevel,
} from "../../kuala/middleware/logger.ts";

// Helper function to capture console output
function captureConsoleOutput(fn: () => void): string[] {
	const originalLog = console.log;
	const logs: string[] = [];

	console.log = (...args: unknown[]) => {
		logs.push(args.join(" "));
	};

	try {
		fn();
		return logs;
	} finally {
		console.log = originalLog;
	}
}

Deno.test("customLogger - should format and log message with timestamp", () => {
	const logs = captureConsoleOutput(() => {
		customLogger("Test message", "extra info");
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], "Test message");
	assertStringIncludes(logs[0], "extra info");
	// Check ISO timestamp format pattern
	assertStringIncludes(logs[0], "[");
	assertStringIncludes(logs[0], "T");
	assertStringIncludes(logs[0], "Z]");
});

Deno.test("customLogger - should handle message without additional arguments", () => {
	const logs = captureConsoleOutput(() => {
		customLogger("Simple message");
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], "Simple message");
});

Deno.test("log - should format structured log with all parameters", () => {
	const testData: LogData = {
		userId: "123",
		action: "login",
		success: true,
		attempts: 1,
	};

	const logs = captureConsoleOutput(() => {
		log("INFO", "auth", "User authentication", testData);
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], "[INFO]");
	assertStringIncludes(logs[0], "[auth]");
	assertStringIncludes(logs[0], "User authentication:");
	assertStringIncludes(logs[0], '"userId": "123"');
	assertStringIncludes(logs[0], '"success": true');
	assertStringIncludes(logs[0], '"attempts": 1');
});

Deno.test("log - should format log without data parameter", () => {
	const logs = captureConsoleOutput(() => {
		log("ERROR", "database", "Connection failed");
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], "[ERROR]");
	assertStringIncludes(logs[0], "[database]");
	assertStringIncludes(logs[0], "Connection failed");
	// Should not contain JSON formatting when no data provided
	assertEquals(logs[0].includes("{"), false);
});

Deno.test("log - should handle various log levels", () => {
	const levels: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR"];

	levels.forEach((level) => {
		const logs = captureConsoleOutput(() => {
			log(level, "test-handler", "Test operation");
		});

		assertEquals(logs.length, 1);
		assertStringIncludes(logs[0], `[${level}]`);
		assertStringIncludes(logs[0], "[test-handler]");
		assertStringIncludes(logs[0], "Test operation");
	});
});

Deno.test("log - should handle data with null and undefined values", () => {
	const testData: LogData = {
		validValue: "test",
		nullValue: null,
		undefinedValue: undefined,
		zeroValue: 0,
		falseValue: false,
	};

	const logs = captureConsoleOutput(() => {
		log("INFO", "test", "Mixed data types", testData);
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], '"validValue": "test"');
	assertStringIncludes(logs[0], '"nullValue": null');
	// JSON.stringify omits undefined values, so we shouldn't expect it in output
	assertStringIncludes(logs[0], '"zeroValue": 0');
	assertStringIncludes(logs[0], '"falseValue": false');
	// Verify undefined is not in the output (as expected with JSON.stringify)
	assertEquals(logs[0].includes('"undefinedValue"'), false);
});

Deno.test("logger.debug - should log with DEBUG level", () => {
	const logs = captureConsoleOutput(() => {
		logger.debug("test-handler", "Debug operation", { debug: true });
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], "[DEBUG]");
	assertStringIncludes(logs[0], "[test-handler]");
	assertStringIncludes(logs[0], "Debug operation:");
	assertStringIncludes(logs[0], '"debug": true');
});

Deno.test("logger.info - should log with INFO level", () => {
	const logs = captureConsoleOutput(() => {
		logger.info("api", "Request processed", { requestId: "req-123" });
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], "[INFO]");
	assertStringIncludes(logs[0], "[api]");
	assertStringIncludes(logs[0], "Request processed:");
	assertStringIncludes(logs[0], '"requestId": "req-123"');
});

Deno.test("logger.warn - should log with WARN level", () => {
	const logs = captureConsoleOutput(() => {
		logger.warn("security", "Rate limit approaching", { remaining: 5 });
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], "[WARN]");
	assertStringIncludes(logs[0], "[security]");
	assertStringIncludes(logs[0], "Rate limit approaching:");
	assertStringIncludes(logs[0], '"remaining": 5');
});

Deno.test("logger.error - should log with ERROR level", () => {
	const logs = captureConsoleOutput(() => {
		logger.error("database", "Query failed", { error: "timeout" });
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], "[ERROR]");
	assertStringIncludes(logs[0], "[database]");
	assertStringIncludes(logs[0], "Query failed:");
	assertStringIncludes(logs[0], '"error": "timeout"');
});

Deno.test("authLogger.start - should log request start", () => {
	const logs = captureConsoleOutput(() => {
		authLogger.start("authorize", { userId: "user-123" });
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], "[INFO]");
	assertStringIncludes(logs[0], "[authorize]");
	assertStringIncludes(logs[0], "Starting request:");
	assertStringIncludes(logs[0], '"userId": "user-123"');
});

Deno.test("authLogger.validation - should log validation with debug level", () => {
	const logs = captureConsoleOutput(() => {
		authLogger.validation("authorize", "redirect_to parameter", {
			valid: true,
		});
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], "[DEBUG]");
	assertStringIncludes(logs[0], "[authorize]");
	assertStringIncludes(logs[0], "Validation: redirect_to parameter:");
	assertStringIncludes(logs[0], '"valid": true');
});

Deno.test("authLogger.apiCall - should log API calls with debug level", () => {
	const logs = captureConsoleOutput(() => {
		authLogger.apiCall("token-exchange", "Supabase OAuth", {
			endpoint: "/oauth/v1/token",
			method: "POST",
		});
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], "[DEBUG]");
	assertStringIncludes(logs[0], "[token-exchange]");
	assertStringIncludes(logs[0], "API Call: Supabase OAuth:");
	assertStringIncludes(logs[0], '"endpoint": "/oauth/v1/token"');
	assertStringIncludes(logs[0], '"method": "POST"');
});

Deno.test("authLogger.success - should log successful operations", () => {
	const logs = captureConsoleOutput(() => {
		authLogger.success("authorize", "OAuth redirect", {
			redirectUrl: "https://keycloak.example.com",
		});
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], "[INFO]");
	assertStringIncludes(logs[0], "[authorize]");
	assertStringIncludes(logs[0], "Success: OAuth redirect:");
	assertStringIncludes(
		logs[0],
		'"redirectUrl": "https://keycloak.example.com"',
	);
});

Deno.test("authLogger.error - should log error operations", () => {
	const logs = captureConsoleOutput(() => {
		authLogger.error("token-exchange", "Invalid code", {
			code: "invalid_grant",
			statusCode: 400,
		});
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], "[ERROR]");
	assertStringIncludes(logs[0], "[token-exchange]");
	assertStringIncludes(logs[0], "Error: Invalid code:");
	assertStringIncludes(logs[0], '"code": "invalid_grant"');
	assertStringIncludes(logs[0], '"statusCode": 400');
});

Deno.test("authLogger.exception - should log exceptions with stack trace", () => {
	const testError = new Error("Database connection failed");
	testError.stack = [
		"Error: Database connection failed",
		"    at connect (/app/db.ts:15:10)",
		"    at handler (/app/handler.ts:25:5)",
		"    at process (/app/server.ts:40:12)",
		"    at main (/app/main.ts:8:3)",
	].join("\n");

	const logs = captureConsoleOutput(() => {
		authLogger.exception("database", testError);
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], "[ERROR]");
	assertStringIncludes(logs[0], "[database]");
	assertStringIncludes(logs[0], "Exception caught:");
	assertStringIncludes(logs[0], '"name": "Error"');
	assertStringIncludes(logs[0], '"message": "Database connection failed"');
	// Should include truncated stack trace (first 3 lines joined by "; ")
	assertStringIncludes(logs[0], "at connect (/app/db.ts:15:10)");
	assertStringIncludes(logs[0], "at handler (/app/handler.ts:25:5)");
	// Check that lines are joined with "; " as per the logger implementation
	assertStringIncludes(logs[0], "; ");
	// Should not include the 4th line due to slice(0, 3) truncation
	assertEquals(logs[0].includes("at main (/app/main.ts:8:3)"), false);
});

Deno.test("authLogger.exception - should handle error without stack trace", () => {
	const testError = new Error("Simple error");
	testError.stack = undefined;

	const logs = captureConsoleOutput(() => {
		authLogger.exception("auth", testError);
	});

	assertEquals(logs.length, 1);
	assertStringIncludes(logs[0], "[ERROR]");
	assertStringIncludes(logs[0], "[auth]");
	assertStringIncludes(logs[0], "Exception caught:");
	assertStringIncludes(logs[0], '"name": "Error"');
	assertStringIncludes(logs[0], '"message": "Simple error"');
	// When stack is undefined, the logger doesn't include stack property at all
	assertEquals(logs[0].includes('"stack"'), false);
});

Deno.test("logger methods - should work without data parameter", () => {
	const methods = [
		() => logger.debug("test", "Debug message"),
		() => logger.info("test", "Info message"),
		() => logger.warn("test", "Warn message"),
		() => logger.error("test", "Error message"),
		() => authLogger.start("test"),
		() => authLogger.validation("test", "param check"),
		() => authLogger.apiCall("test", "API request"),
		() => authLogger.success("test", "operation completed"),
		() => authLogger.error("test", "operation failed"),
	];

	methods.forEach((method, index) => {
		const logs = captureConsoleOutput(method);
		assertEquals(
			logs.length,
			1,
			`Method ${index} should produce exactly one log`,
		);
		assertStringIncludes(logs[0], "[test]");
	});
});

Deno.test("timestamp format - should use ISO 8601 format", () => {
	// Mock Date.prototype.toISOString to control timestamp
	const originalToISOString = Date.prototype.toISOString;
	const fixedTimestamp = "2023-12-25T10:30:45.123Z";

	Date.prototype.toISOString = () => fixedTimestamp;

	try {
		const logs = captureConsoleOutput(() => {
			customLogger("Test timestamp");
		});

		assertEquals(logs.length, 1);
		assertStringIncludes(logs[0], `[${fixedTimestamp}]`);
		assertStringIncludes(logs[0], "Test timestamp");
	} finally {
		Date.prototype.toISOString = originalToISOString;
	}
});

Deno.test("logger integration - should maintain consistent format across all methods", () => {
	// Test that all logging methods follow the same format pattern
	const testCases = [
		{
			fn: () => logger.info("handler", "operation"),
			expectedPattern:
				/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[handler\] operation$/,
		},
		{
			fn: () => authLogger.start("handler"),
			expectedPattern:
				/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[handler\] Starting request$/,
		},
		{
			fn: () => customLogger("Custom message"),
			expectedPattern:
				/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] Custom message$/,
		},
	];

	testCases.forEach(({ fn, expectedPattern }, index) => {
		const logs = captureConsoleOutput(fn);
		assertEquals(
			logs.length,
			1,
			`Test case ${index} should produce one log`,
		);
		assertEquals(
			expectedPattern.test(logs[0]),
			true,
			`Log format should match pattern. Got: ${logs[0]}`,
		);
	});
});
