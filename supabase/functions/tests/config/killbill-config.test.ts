import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { killBillConfig } from "../../_shared/config/killbill-config.ts";
import type { KillBillConfig } from "../../_shared/config/killbill-config.ts";

Deno.test("killBillConfig - should return all config values from environment variables", () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		switch (key) {
			case "KILLBILL_BASE_URL":
				return "http://localhost:8080";
			case "KILLBILL_API_KEY":
				return "test_api_key";
			case "KILLBILL_API_SECRET":
				return "test_api_secret";
			case "KILLBILL_USERNAME":
				return "admin";
			case "KILLBILL_PASSWORD":
				return "password123";
			case "KILLBILL_DEFAULT_CURRENCY":
				return "USD";
			default:
				return undefined;
		}
	});

	try {
		const config: KillBillConfig = killBillConfig();

		assertEquals(config.baseUrl, "http://localhost:8080");
		assertEquals(config.apiKey, "test_api_key");
		assertEquals(config.apiSecret, "test_api_secret");
		assertEquals(config.username, "admin");
		assertEquals(config.password, "password123");
		assertEquals(config.defaultCurrency, "USD");
	} finally {
		envStub.restore();
	}
});

Deno.test("killBillConfig - should return empty strings when environment variables are not set", () => {
	const envStub = stub(Deno.env, "get", () => undefined);

	try {
		const config: KillBillConfig = killBillConfig();

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

Deno.test("killBillConfig - should handle partial environment variables", () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		switch (key) {
			case "KILLBILL_BASE_URL":
				return "https://killbill.example.com";
			case "KILLBILL_API_KEY":
				return "my_api_key";
			// Other variables not set (undefined)
			default:
				return undefined;
		}
	});

	try {
		const config: KillBillConfig = killBillConfig();

		assertEquals(config.baseUrl, "https://killbill.example.com");
		assertEquals(config.apiKey, "my_api_key");
		assertEquals(config.apiSecret, "");
		assertEquals(config.username, "");
		assertEquals(config.password, "");
		assertEquals(config.defaultCurrency, "");
	} finally {
		envStub.restore();
	}
});

Deno.test("killBillConfig - should handle empty string environment variables", () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		switch (key) {
			case "KILLBILL_BASE_URL":
				return "";
			case "KILLBILL_API_KEY":
				return "";
			case "KILLBILL_API_SECRET":
				return "";
			case "KILLBILL_USERNAME":
				return "";
			case "KILLBILL_PASSWORD":
				return "";
			case "KILLBILL_DEFAULT_CURRENCY":
				return "";
			default:
				return undefined;
		}
	});

	try {
		const config: KillBillConfig = killBillConfig();

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

Deno.test("killBillConfig - should return correct types for all properties", () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		switch (key) {
			case "KILLBILL_BASE_URL":
				return "http://killbill.local:8080";
			case "KILLBILL_API_KEY":
				return "kb-api-key-123";
			case "KILLBILL_API_SECRET":
				return "kb-secret-456";
			case "KILLBILL_USERNAME":
				return "killbill_user";
			case "KILLBILL_PASSWORD":
				return "secure_password";
			case "KILLBILL_DEFAULT_CURRENCY":
				return "EUR";
			default:
				return undefined;
		}
	});

	try {
		const config: KillBillConfig = killBillConfig();

		// Verify all properties are strings
		assertEquals(typeof config.baseUrl, "string");
		assertEquals(typeof config.apiKey, "string");
		assertEquals(typeof config.apiSecret, "string");
		assertEquals(typeof config.username, "string");
		assertEquals(typeof config.password, "string");
		assertEquals(typeof config.defaultCurrency, "string");

		// Verify specific values
		assertEquals(config.baseUrl, "http://killbill.local:8080");
		assertEquals(config.apiKey, "kb-api-key-123");
		assertEquals(config.apiSecret, "kb-secret-456");
		assertEquals(config.username, "killbill_user");
		assertEquals(config.password, "secure_password");
		assertEquals(config.defaultCurrency, "EUR");
	} finally {
		envStub.restore();
	}
});

Deno.test("killBillConfig - should handle production-like configuration", () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		switch (key) {
			case "KILLBILL_BASE_URL":
				return "https://api.killbill.io";
			case "KILLBILL_API_KEY":
				return "prod_kb_api_key_abc123xyz789";
			case "KILLBILL_API_SECRET":
				return "prod_kb_secret_def456uvw012";
			case "KILLBILL_USERNAME":
				return "production_user";
			case "KILLBILL_PASSWORD":
				return "very_secure_production_password_2023";
			case "KILLBILL_DEFAULT_CURRENCY":
				return "USD";
			default:
				return undefined;
		}
	});

	try {
		const config: KillBillConfig = killBillConfig();

		assertEquals(config.baseUrl, "https://api.killbill.io");
		assertEquals(config.apiKey, "prod_kb_api_key_abc123xyz789");
		assertEquals(config.apiSecret, "prod_kb_secret_def456uvw012");
		assertEquals(config.username, "production_user");
		assertEquals(config.password, "very_secure_production_password_2023");
		assertEquals(config.defaultCurrency, "USD");

		// Verify all fields are non-empty in production scenario
		assertEquals(config.baseUrl.length > 0, true);
		assertEquals(config.apiKey.length > 0, true);
		assertEquals(config.apiSecret.length > 0, true);
		assertEquals(config.username.length > 0, true);
		assertEquals(config.password.length > 0, true);
		assertEquals(config.defaultCurrency.length > 0, true);
	} finally {
		envStub.restore();
	}
});

Deno.test("killBillConfig - should handle different currency codes", () => {
	const currencies = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD"];

	for (const currency of currencies) {
		const envStub = stub(Deno.env, "get", (key: string) => {
			switch (key) {
				case "KILLBILL_BASE_URL":
					return "http://localhost:8080";
				case "KILLBILL_API_KEY":
					return "test_key";
				case "KILLBILL_API_SECRET":
					return "test_secret";
				case "KILLBILL_USERNAME":
					return "admin";
				case "KILLBILL_PASSWORD":
					return "password";
				case "KILLBILL_DEFAULT_CURRENCY":
					return currency;
				default:
					return undefined;
			}
		});

		try {
			const config: KillBillConfig = killBillConfig();
			assertEquals(config.defaultCurrency, currency);
		} finally {
			envStub.restore();
		}
	}
});

Deno.test("killBillConfig - should handle URL variations", () => {
	const urls = [
		"http://localhost:8080",
		"https://killbill.example.com",
		"https://api.killbill.io:443",
		"http://192.168.1.100:9090",
		"https://killbill-prod.company.com",
	];

	for (const url of urls) {
		const envStub = stub(Deno.env, "get", (key: string) => {
			switch (key) {
				case "KILLBILL_BASE_URL":
					return url;
				case "KILLBILL_API_KEY":
					return "test_key";
				case "KILLBILL_API_SECRET":
					return "test_secret";
				case "KILLBILL_USERNAME":
					return "admin";
				case "KILLBILL_PASSWORD":
					return "password";
				case "KILLBILL_DEFAULT_CURRENCY":
					return "USD";
				default:
					return undefined;
			}
		});

		try {
			const config: KillBillConfig = killBillConfig();
			assertEquals(config.baseUrl, url);
		} finally {
			envStub.restore();
		}
	}
});

Deno.test("killBillConfig - should return consistent results on multiple calls", () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		switch (key) {
			case "KILLBILL_BASE_URL":
				return "http://consistent.test:8080";
			case "KILLBILL_API_KEY":
				return "consistent_key";
			case "KILLBILL_API_SECRET":
				return "consistent_secret";
			case "KILLBILL_USERNAME":
				return "consistent_user";
			case "KILLBILL_PASSWORD":
				return "consistent_pass";
			case "KILLBILL_DEFAULT_CURRENCY":
				return "USD";
			default:
				return undefined;
		}
	});

	try {
		const config1: KillBillConfig = killBillConfig();
		const config2: KillBillConfig = killBillConfig();
		const config3: KillBillConfig = killBillConfig();

		// All calls should return identical configurations
		assertEquals(config1.baseUrl, config2.baseUrl);
		assertEquals(config1.baseUrl, config3.baseUrl);
		assertEquals(config1.apiKey, config2.apiKey);
		assertEquals(config1.apiKey, config3.apiKey);
		assertEquals(config1.apiSecret, config2.apiSecret);
		assertEquals(config1.apiSecret, config3.apiSecret);
		assertEquals(config1.username, config2.username);
		assertEquals(config1.username, config3.username);
		assertEquals(config1.password, config2.password);
		assertEquals(config1.password, config3.password);
		assertEquals(config1.defaultCurrency, config2.defaultCurrency);
		assertEquals(config1.defaultCurrency, config3.defaultCurrency);
	} finally {
		envStub.restore();
	}
});

Deno.test("killBillConfig - should handle special characters in credentials", () => {
	const envStub = stub(Deno.env, "get", (key: string) => {
		switch (key) {
			case "KILLBILL_BASE_URL":
				return "https://killbill.example.com";
			case "KILLBILL_API_KEY":
				return "key_with-dashes_and.dots";
			case "KILLBILL_API_SECRET":
				return "secret@#$%^&*()_+{}[]|\\:;\"'<>?,./";
			case "KILLBILL_USERNAME":
				return "user.name@domain.com";
			case "KILLBILL_PASSWORD":
				return "P@ssw0rd!2023#Complex";
			case "KILLBILL_DEFAULT_CURRENCY":
				return "USD";
			default:
				return undefined;
		}
	});

	try {
		const config: KillBillConfig = killBillConfig();

		assertEquals(config.baseUrl, "https://killbill.example.com");
		assertEquals(config.apiKey, "key_with-dashes_and.dots");
		assertEquals(config.apiSecret, "secret@#$%^&*()_+{}[]|\\:;\"'<>?,./");
		assertEquals(config.username, "user.name@domain.com");
		assertEquals(config.password, "P@ssw0rd!2023#Complex");
		assertEquals(config.defaultCurrency, "USD");
	} finally {
		envStub.restore();
	}
});
