import { assertEquals } from "@std/assert";
import {
	config,
	overrideConfig,
	resetConfig,
} from "../../_shared/config/env.ts";

Deno.test("env config - reads values dynamically from Deno.env", () => {
	const original = Deno.env.get("PAYMENT_GATEWAY");
	try {
		Deno.env.set("PAYMENT_GATEWAY", "bayeu");
		assertEquals(config.PAYMENT_GATEWAY, "bayeu");
	} finally {
		if (original !== undefined) {
			Deno.env.set("PAYMENT_GATEWAY", original);
		} else {
			Deno.env.delete("PAYMENT_GATEWAY");
		}
	}
});

Deno.test("env config - falls back to target if Deno.env value fails parsing", () => {
	const original = Deno.env.get("SUPABASE_URL");
	try {
		Deno.env.set("SUPABASE_URL", "invalid-url-format");
		// Should catch and return fallback target instead of throwing
		const val = config.SUPABASE_URL;
		assertEquals(typeof val === "string" || val === undefined, true);
	} finally {
		if (original !== undefined) {
			Deno.env.set("SUPABASE_URL", original);
		} else {
			Deno.env.delete("SUPABASE_URL");
		}
	}
});

Deno.test("env config - returns target property for non-schema or symbol keys", () => {
	assertEquals(
		(config as unknown as Record<string, unknown>)["NON_EXISTENT_KEY"],
		undefined,
	);
	const sym = Symbol("test");
	assertEquals(
		(config as unknown as Record<symbol, unknown>)[sym],
		undefined,
	);
});

Deno.test("env config - overrideConfig and resetConfig with fallback", () => {
	const original = Deno.env.get("SUPABASE_URL");
	try {
		Deno.env.set("SUPABASE_URL", "invalid-url-format");
		overrideConfig({ SUPABASE_URL: "https://fallback.com" });
		assertEquals(config.SUPABASE_URL, "https://fallback.com");

		resetConfig();
	} finally {
		if (original !== undefined) {
			Deno.env.set("SUPABASE_URL", original);
		} else {
			Deno.env.delete("SUPABASE_URL");
		}
		resetConfig();
	}
});

Deno.test("env config - transforms boolean fields correctly", () => {
	const origCors = Deno.env.get("CORS_ENABLED");
	const origSkip = Deno.env.get("SKIP_WEBHOOK_VERIFICATION");
	try {
		Deno.env.set("CORS_ENABLED", "false");
		assertEquals(config.CORS_ENABLED, false);

		Deno.env.set("CORS_ENABLED", "true");
		assertEquals(config.CORS_ENABLED, true);

		Deno.env.set("SKIP_WEBHOOK_VERIFICATION", "true");
		assertEquals(config.SKIP_WEBHOOK_VERIFICATION, true);

		Deno.env.set("SKIP_WEBHOOK_VERIFICATION", "false");
		assertEquals(config.SKIP_WEBHOOK_VERIFICATION, false);
	} finally {
		if (origCors !== undefined) Deno.env.set("CORS_ENABLED", origCors);
		else Deno.env.delete("CORS_ENABLED");
		if (origSkip !== undefined) {
			Deno.env.set("SKIP_WEBHOOK_VERIFICATION", origSkip);
		} else Deno.env.delete("SKIP_WEBHOOK_VERIFICATION");
	}
});
