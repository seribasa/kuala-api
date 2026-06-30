// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@std/assert";
import { handleBayeuWebhook } from "../../../kuala/handlers/webhooks/bayeu.ts";
import { Context } from "@hono/hono";
import { stub } from "@std/testing/mock";
import { killBillService } from "@shared/services/killbill.ts";

Deno.test("handleBayeuWebhook - missing signature header returns 401", async () => {
	const req = new Request("http://localhost/webhooks/bayeu", {
		method: "POST",
	});
	const c = {
		req: {
			header: (k: string) => null,
			text: () => Promise.resolve("{}"),
		},
		json: (body: any, status?: number) => ({ body, status }),
	} as unknown as Context;

	const res = await handleBayeuWebhook(c);
	assertEquals((res as any).status, 401);
});

Deno.test("handleBayeuWebhook - ignore non payment.success events", async () => {
	// We mock OUTPOST_WEBHOOK_SECRET to test the Crypto API
	// It's easier to mock the verifyHookdeckSignature if it was exported, but we can also just set the env
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	Deno.env.set("OUTPOST_WEBHOOK_SECRET", "test_secret");

	const payload = JSON.stringify({ type: "some.other.event", data: {} });

	// Create signature
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode("test_secret"),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signatureBuffer = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(payload),
	);
	const signatureBase64 = btoa(
		String.fromCharCode(...new Uint8Array(signatureBuffer)),
	);

	const req = new Request("http://localhost/webhooks/bayeu", {
		method: "POST",
	});
	const c = {
		req: {
			header: (k: string) => signatureBase64,
			text: () => Promise.resolve(payload),
		},
		json: (body: any, status?: number) => ({ body, status: status || 200 }),
	} as unknown as Context;

	try {
		const res = await handleBayeuWebhook(c);
		assertEquals((res as any).status, 200);
		assertEquals((res as any).body.message, "Ignored");
	} finally {
		if (originalKey === undefined) {
			Deno.env.delete("OUTPOST_WEBHOOK_SECRET");
		} else {
			Deno.env.set("OUTPOST_WEBHOOK_SECRET", originalKey);
		}
	}
});
