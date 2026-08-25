import { assertEquals } from "@std/assert";
import { killBillConfig } from "../../_shared/config/killbill-config.ts";
import { overrideConfig, resetConfig } from "../../_shared/config/env.ts";

Deno.test("killBillConfig - should return config with environment variables", () => {
	overrideConfig({
		KILLBILL_BASE_URL: "https://killbill.example.com",
		KILLBILL_API_KEY: "test-api-key",
		KILLBILL_API_SECRET: "test-api-secret",
		KILLBILL_USERNAME: "admin",
		KILLBILL_PASSWORD: "password123",
		KILLBILL_DEFAULT_CURRENCY: "USD",
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
		resetConfig();
	}
});

Deno.test("killBillConfig - should return empty strings for missing environment variables", () => {
	overrideConfig({
		KILLBILL_BASE_URL: "",
		KILLBILL_API_KEY: "",
		KILLBILL_API_SECRET: "",
		KILLBILL_USERNAME: "",
		KILLBILL_PASSWORD: "",
		KILLBILL_DEFAULT_CURRENCY: "",
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
		resetConfig();
	}
});

Deno.test("killBillConfig - should return partial config with some env vars set", () => {
	overrideConfig({
		KILLBILL_BASE_URL: "https://kb.test.com",
		KILLBILL_API_KEY: "",
		KILLBILL_API_SECRET: "",
		KILLBILL_USERNAME: "",
		KILLBILL_PASSWORD: "",
		KILLBILL_DEFAULT_CURRENCY: "EUR",
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
		resetConfig();
	}
});
