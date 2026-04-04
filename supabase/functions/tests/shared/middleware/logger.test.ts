import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
	authLogger,
	customLogger,
	log,
	logger,
} from "../../../_shared/middleware/logger.ts";

// Helper function to capture console output
function captureConsoleOutput(fn: () => void): string[] {
	const originalLog = console.log;
	const originalError = console.error;
	const originalWarn = console.warn;
	const logs: string[] = [];

	const captureFn = (...args: unknown[]) => {
		logs.push(args.join(" "));
	};

	console.log = captureFn;
	console.error = captureFn;
	console.warn = captureFn;

	try {
		fn();
		return logs;
	} finally {
		console.log = originalLog;
		console.error = originalError;
		console.warn = originalWarn;
	}
}

Deno.test("_shared/middleware/logger - customLogger", () => {
    const logs = captureConsoleOutput(() => customLogger("msg", "rest"));
    assertEquals(logs.length, 1);
    assertStringIncludes(logs[0], "msg");
    assertStringIncludes(logs[0], "rest");
});

Deno.test("_shared/middleware/logger - log with data", () => {
    const logs = captureConsoleOutput(() => log("INFO", "handler", "op", { a: 1 }));
    assertEquals(logs.length, 1);
    assertStringIncludes(logs[0], "[INFO]");
    assertStringIncludes(logs[0], "handler");
    assertStringIncludes(logs[0], '"a": 1');
});

Deno.test("_shared/middleware/logger - log without data", () => {
    const logs = captureConsoleOutput(() => log("DEBUG", "h", "op"));
    assertEquals(logs.length, 1);
    assertEquals(logs[0].includes("{"), false);
});

Deno.test("_shared/middleware/logger - logger levels", () => {
    captureConsoleOutput(() => logger.debug("h", "op", {a: 1}));
    captureConsoleOutput(() => logger.info("h", "op", {a: 1}));
    captureConsoleOutput(() => logger.warn("h", "op", {a: 1}));
    captureConsoleOutput(() => logger.error("h", "op", {a: 1}));
});

Deno.test("_shared/middleware/logger - authLogger levels", () => {
    captureConsoleOutput(() => authLogger.start("h", {a: 1}));
    captureConsoleOutput(() => authLogger.validation("h", "op", {a: 1}));
    captureConsoleOutput(() => authLogger.apiCall("h", "op", {a: 1}));
    captureConsoleOutput(() => authLogger.success("h", "op", {a: 1}));
    captureConsoleOutput(() => authLogger.error("h", "op", {a: 1}));
    
    const err = new Error("err");
    err.stack = "line1\nline2\nline3\nline4";
    captureConsoleOutput(() => authLogger.exception("h", err));
    
    const err2 = new Error("err2");
    err2.stack = undefined;
    captureConsoleOutput(() => authLogger.exception("h", err2));
});
