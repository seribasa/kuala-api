// deno-lint-ignore-file require-await
import { assertEquals } from "@std/assert";
import { Stub, stub } from "@std/testing/mock";
import { killBillConfig } from "../../_shared/config/killbill-config.ts";

Deno.test("killBillConfig - should return config with environment variables", () => {
	// Stub environment variables
	const envStub = stub(Deno.env, "get", (key: string) => {
		const envMap: Record<string, string> = {
			"KILLBILL_BASE_URL": "https://killbill.example.com",
			"KILLBILL_API_KEY": "test-api-key",
			"KILLBILL_API_SECRET": "test-api-secret",
			"KILLBILL_USERNAME": "admin",
			"KILLBILL_PASSWORD": "password123",
			"KILLBILL_DEFAULT_CURRENCY": "USD",
		};
		return envMap[key];
	});

	try {
		const config = killBillConfig();

		assertEquals(config.baseUrl, "https://killbill.example.com");
		assertEquals(config.apiKey, "test-api-key");
		assertEquals(config.apiSecret, "test-api-secret");
		assertEquals(config.username, "admin");
		assertEquals(config.password, "password123");
		assertEquals(config.defaultCurrency, "USD");
	} finally {
		envStub.restore();
	}
});

Deno.test("killBillConfig - should return empty strings for missing environment variables", () => {
	// Stub environment variables returning undefined
	const envStub = stub(Deno.env, "get", (_key: string) => {
		return undefined;
	});

	try {
		const config = killBillConfig();

		assertEquals(config.baseUrl, "");
		assertEquals(config.apiKey, "");
		assertEquals(config.apiSecret, "");
		assertEquals(config.username, "");
		assertEquals(config.password, "");
		assertEquals(config.defaultCurrency, "");
	} finally {
		envStub.restore();
	}
});

Deno.test("killBillConfig - should return partial config with some env vars set", () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		const envMap: Record<string, string> = {
			"KILLBILL_BASE_URL": "https://kb.test.com",
			"KILLBILL_DEFAULT_CURRENCY": "EUR",
		};
		return envMap[key];
	});

	try {
		const config = killBillConfig();

		assertEquals(config.baseUrl, "https://kb.test.com");
		assertEquals(config.apiKey, "");
		assertEquals(config.apiSecret, "");
		assertEquals(config.username, "");
		assertEquals(config.password, "");
		assertEquals(config.defaultCurrency, "EUR");
	} finally {
		envStub.restore();
	}
});
