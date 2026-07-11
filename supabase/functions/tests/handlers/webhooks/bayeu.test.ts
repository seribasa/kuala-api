// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@std/assert";
import { handleBayeuWebhook } from "../../../kuala/handlers/webhooks/bayeu.ts";
import { Context } from "@hono/hono";
import { stub } from "@std/testing/mock";
import { killBillService } from "../../../_shared/services/killbill.ts";

async function generateMockSignature(payload: string, secret: string) {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signatureBuffer = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(payload),
	);
	return btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
}

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
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	Deno.env.set("OUTPOST_WEBHOOK_SECRET", "test_secret");

	const payload = JSON.stringify({ status: "failed", data: {} });
	const signatureBase64 = await generateMockSignature(payload, "test_secret");

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

Deno.test("handleBayeuWebhook - returns 400 if invoice_id is missing", async () => {
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	Deno.env.set("OUTPOST_WEBHOOK_SECRET", "test_secret");

	const payload = JSON.stringify({ status: "success", amount: 100 });
	const signatureBase64 = await generateMockSignature(payload, "test_secret");

	const c = {
		req: {
			header: (k: string) => signatureBase64,
			text: () => Promise.resolve(payload),
		},
		json: (body: any, status?: number) => ({ body, status: status || 200 }),
	} as unknown as Context;

	try {
		const res = await handleBayeuWebhook(c);
		assertEquals((res as any).status, 400);
	} finally {
		if (originalKey === undefined) {
			Deno.env.delete("OUTPOST_WEBHOOK_SECRET");
		} else {
			Deno.env.set("OUTPOST_WEBHOOK_SECRET", originalKey);
		}
	}
});

Deno.test("handleBayeuWebhook - returns 500 if killBillService throws", async () => {
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	Deno.env.set("OUTPOST_WEBHOOK_SECRET", "test_secret");

	const payload = JSON.stringify({
		status: "success",
		amount: 100,
		metadata: { invoice_id: "inv-123" },
	});
	const signatureBase64 = await generateMockSignature(payload, "test_secret");

	const c = {
		req: {
			header: (k: string) => signatureBase64,
			text: () => Promise.resolve(payload),
		},
		json: (body: any, status?: number) => ({ body, status: status || 200 }),
	} as unknown as Context;

	const payStub = stub(killBillService, "payInvoiceExternal", () => {
		throw new Error("Kill Bill error");
	});

	try {
		const res = await handleBayeuWebhook(c);
		assertEquals((res as any).status, 500);
	} finally {
		payStub.restore();
		if (originalKey === undefined) {
			Deno.env.delete("OUTPOST_WEBHOOK_SECRET");
		} else {
			Deno.env.set("OUTPOST_WEBHOOK_SECRET", originalKey);
		}
	}
});

Deno.test("handleBayeuWebhook - returns 200 on success", async () => {
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	Deno.env.set("OUTPOST_WEBHOOK_SECRET", "test_secret");

	const payload = JSON.stringify({
		status: "success",
		amount: 100,
		metadata: { invoice_id: "inv-123" },
	});
	const signatureBase64 = await generateMockSignature(payload, "test_secret");

	const c = {
		req: {
			header: (k: string) => signatureBase64,
			text: () => Promise.resolve(payload),
		},
		json: (body: any, status?: number) => ({ body, status: status || 200 }),
	} as unknown as Context;

	const payStub = stub(killBillService, "payInvoiceExternal", () => {
		return Promise.resolve();
	});

	try {
		const res = await handleBayeuWebhook(c);
		assertEquals((res as any).status, 200);
		assertEquals((res as any).body.message, "Payment processed");
	} finally {
		payStub.restore();
		if (originalKey === undefined) {
			Deno.env.delete("OUTPOST_WEBHOOK_SECRET");
		} else {
			Deno.env.set("OUTPOST_WEBHOOK_SECRET", originalKey);
		}
	}
});
