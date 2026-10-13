// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@std/assert";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { handleBayeuWebhook } from "../../../kuala/handlers/webhooks/bayeu.ts";
import { Context } from "@hono/hono";
import { stub } from "@std/testing/mock";
import { killBillService } from "../../../_shared/services/killbill.ts";
import { supabase } from "../../../_shared/supabase.ts";

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

function generateMockOutpostSignatureHex(payload: string, secret: string) {
	return "v0=" +
		crypto.createHmac("sha256", Buffer.from(secret)).update(payload).digest(
			"hex",
		);
}

function generateMockOutpostSignatureBase64(payload: string, secret: string) {
	return "v0=" +
		crypto.createHmac("sha256", Buffer.from(secret)).update(payload).digest(
			"base64",
		);
}

function generateMockOutpostSignatureHexWhsec(payload: string, secret: string) {
	const rawKey = secret.slice(6);
	return "v0=" +
		crypto.createHmac("sha256", Buffer.from(rawKey, "hex")).update(payload)
			.digest("hex");
}

function createMockContext(headers: Record<string, string>, body: string) {
	const headerEntries = Object.entries(headers);
	return {
		req: {
			header: (k: string) =>
				headers[k] || headers[k.toLowerCase()] || null,
			text: () => Promise.resolve(body),
			raw: {
				headers: {
					entries: () => headerEntries[Symbol.iterator](),
				},
			},
		},
		json: (body: any, status?: number) => ({ body, status: status || 200 }),
	} as unknown as Context;
}

Deno.test("handleBayeuWebhook - missing signature header returns 401", async () => {
	const originalDenoEnv = Deno.env.get("DENO_ENV");
	const originalSkipVerification = Deno.env.get("SKIP_WEBHOOK_VERIFICATION");
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	Deno.env.delete("DENO_ENV");
	Deno.env.delete("SKIP_WEBHOOK_VERIFICATION");
	Deno.env.set("OUTPOST_WEBHOOK_SECRET", "test_secret");
	try {
		const c = createMockContext({}, "{}");

		const res = await handleBayeuWebhook(c);
		assertEquals((res as any).status, 401);
	} finally {
		if (originalDenoEnv !== undefined) {
			Deno.env.set("DENO_ENV", originalDenoEnv);
		}
		if (originalSkipVerification !== undefined) {
			Deno.env.set("SKIP_WEBHOOK_VERIFICATION", originalSkipVerification);
		}
		if (originalKey !== undefined) {
			Deno.env.set("OUTPOST_WEBHOOK_SECRET", originalKey);
		} else {
			Deno.env.delete("OUTPOST_WEBHOOK_SECRET");
		}
	}
});

Deno.test("handleBayeuWebhook - missing OUTPOST_WEBHOOK_SECRET returns 401", async () => {
	const originalDenoEnv = Deno.env.get("DENO_ENV");
	const originalSkipVerification = Deno.env.get("SKIP_WEBHOOK_VERIFICATION");
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	Deno.env.delete("DENO_ENV");
	Deno.env.delete("SKIP_WEBHOOK_VERIFICATION");
	Deno.env.delete("OUTPOST_WEBHOOK_SECRET");
	try {
		const payload = JSON.stringify({ status: "success", amount: 100 });
		const c = createMockContext({
			"x-hookdeck-signature": "dummy",
		}, payload);

		const res = await handleBayeuWebhook(c);
		assertEquals((res as any).status, 401);
	} finally {
		if (originalDenoEnv !== undefined) {
			Deno.env.set("DENO_ENV", originalDenoEnv);
		}
		if (originalSkipVerification !== undefined) {
			Deno.env.set("SKIP_WEBHOOK_VERIFICATION", originalSkipVerification);
		}
		if (originalKey !== undefined) {
			Deno.env.set("OUTPOST_WEBHOOK_SECRET", originalKey);
		}
	}
});

Deno.test("handleBayeuWebhook - signature mismatch returns 401", async () => {
	const originalDenoEnv = Deno.env.get("DENO_ENV");
	const originalSkipVerification = Deno.env.get("SKIP_WEBHOOK_VERIFICATION");
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	Deno.env.delete("DENO_ENV");
	Deno.env.delete("SKIP_WEBHOOK_VERIFICATION");
	Deno.env.set("OUTPOST_WEBHOOK_SECRET", "test_secret");
	try {
		const payload = JSON.stringify({ status: "success", amount: 100 });
		const c = createMockContext({
			"x-hookdeck-signature": "completely_wrong_signature",
			"x-outpost-signature":
				"v0=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		}, payload);

		const res = await handleBayeuWebhook(c);
		assertEquals((res as any).status, 401);
	} finally {
		if (originalDenoEnv !== undefined) {
			Deno.env.set("DENO_ENV", originalDenoEnv);
		}
		if (originalSkipVerification !== undefined) {
			Deno.env.set("SKIP_WEBHOOK_VERIFICATION", originalSkipVerification);
		}
		if (originalKey !== undefined) {
			Deno.env.set("OUTPOST_WEBHOOK_SECRET", originalKey);
		} else {
			Deno.env.delete("OUTPOST_WEBHOOK_SECRET");
		}
	}
});

Deno.test("handleBayeuWebhook - ignore non payment.success events", async () => {
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	Deno.env.set("OUTPOST_WEBHOOK_SECRET", "test_secret");

	const payload = JSON.stringify({ status: "failed", data: {} });
	const signatureBase64 = await generateMockSignature(payload, "test_secret");

	const c = createMockContext({
		"x-hookdeck-signature": signatureBase64,
	}, payload);

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

	const c = createMockContext({
		"x-hookdeck-signature": signatureBase64,
	}, payload);

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

	const c = createMockContext({
		"x-hookdeck-signature": signatureBase64,
	}, payload);

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

Deno.test("handleBayeuWebhook - returns 200 on success with hookdeck-signature header", async () => {
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	Deno.env.set("OUTPOST_WEBHOOK_SECRET", "test_secret");

	const payload = JSON.stringify({
		status: "success",
		amount: 100,
		metadata: { invoice_id: "inv-123" },
	});
	const signatureBase64 = await generateMockSignature(payload, "test_secret");

	const c = createMockContext({
		"hookdeck-signature": signatureBase64,
	}, payload);

	const payStub = stub(killBillService, "payInvoiceExternal", () => {
		return Promise.resolve();
	});

	const storageFromStub = stub(supabase.storage, "from", () => {
		return {
			remove: () => Promise.resolve({ data: null, error: null }),
		} as any;
	});

	try {
		const res = await handleBayeuWebhook(c);
		assertEquals((res as any).status, 200);
		assertEquals((res as any).body.message, "Payment processed");
	} finally {
		payStub.restore();
		storageFromStub.restore();
		if (originalKey === undefined) {
			Deno.env.delete("OUTPOST_WEBHOOK_SECRET");
		} else {
			Deno.env.set("OUTPOST_WEBHOOK_SECRET", originalKey);
		}
	}
});

Deno.test("handleBayeuWebhook - outpost format valid signature with timestamp returns 200", async () => {
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	Deno.env.set("OUTPOST_WEBHOOK_SECRET", "test_secret");

	const payload = JSON.stringify({
		status: "success",
		amount: 100,
		metadata: { invoice_id: "inv-123" },
	});
	const timestamp = "2026-08-12T10:00:00Z";
	const payloadToSign = `${timestamp}.${payload}`;
	const signatureHex = generateMockOutpostSignatureHex(
		payloadToSign,
		"test_secret",
	);

	const c = createMockContext({
		"x-outpost-signature": signatureHex,
		"x-outpost-timestamp": timestamp,
	}, payload);

	const payStub = stub(killBillService, "payInvoiceExternal", () => {
		return Promise.resolve();
	});

	const storageFromStub = stub(supabase.storage, "from", () => {
		return {
			remove: () => Promise.resolve({ data: null, error: null }),
		} as any;
	});

	try {
		const res = await handleBayeuWebhook(c);
		assertEquals((res as any).status, 200);
		assertEquals((res as any).body.message, "Payment processed");
	} finally {
		payStub.restore();
		storageFromStub.restore();
		if (originalKey === undefined) {
			Deno.env.delete("OUTPOST_WEBHOOK_SECRET");
		} else {
			Deno.env.set("OUTPOST_WEBHOOK_SECRET", originalKey);
		}
	}
});

Deno.test("handleBayeuWebhook - outpost format base64 signature returns 200", async () => {
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	Deno.env.set("OUTPOST_WEBHOOK_SECRET", "test_secret");

	const payload = JSON.stringify({
		status: "success",
		amount: 100,
		metadata: { invoice_id: "inv-123" },
	});
	const signatureBase64 = generateMockOutpostSignatureBase64(
		payload,
		"test_secret",
	);

	const c = createMockContext({
		"x-outpost-signature": signatureBase64,
	}, payload);

	const payStub = stub(killBillService, "payInvoiceExternal", () => {
		return Promise.resolve();
	});

	const storageFromStub = stub(supabase.storage, "from", () => {
		return {
			remove: () => Promise.resolve({ data: null, error: null }),
		} as any;
	});

	try {
		const res = await handleBayeuWebhook(c);
		assertEquals((res as any).status, 200);
		assertEquals((res as any).body.message, "Payment processed");
	} finally {
		payStub.restore();
		storageFromStub.restore();
		if (originalKey === undefined) {
			Deno.env.delete("OUTPOST_WEBHOOK_SECRET");
		} else {
			Deno.env.set("OUTPOST_WEBHOOK_SECRET", originalKey);
		}
	}
});

Deno.test("handleBayeuWebhook - outpost format valid signature with event_id and timestamp returns 200", async () => {
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	Deno.env.set("OUTPOST_WEBHOOK_SECRET", "test_secret");

	const payload = JSON.stringify({
		status: "success",
		amount: 100,
		metadata: { invoice_id: "inv-123" },
	});
	const eventId = "evt_123";
	const timestamp = "2026-08-12T10:00:00Z";
	const payloadToSign = `${eventId}.${timestamp}.${payload}`;
	const signatureHex = generateMockOutpostSignatureHex(
		payloadToSign,
		"test_secret",
	);

	const c = createMockContext({
		"x-outpost-signature": signatureHex,
		"x-outpost-event-id": eventId,
		"x-outpost-timestamp": timestamp,
	}, payload);

	const payStub = stub(killBillService, "payInvoiceExternal", () => {
		return Promise.resolve();
	});

	const storageFromStub = stub(supabase.storage, "from", () => {
		return {
			remove: () => Promise.resolve({ data: null, error: null }),
		} as any;
	});

	try {
		const res = await handleBayeuWebhook(c);
		assertEquals((res as any).status, 200);
	} finally {
		payStub.restore();
		storageFromStub.restore();
		if (originalKey === undefined) {
			Deno.env.delete("OUTPOST_WEBHOOK_SECRET");
		} else {
			Deno.env.set("OUTPOST_WEBHOOK_SECRET", originalKey);
		}
	}
});

Deno.test("handleBayeuWebhook - outpost format with whsec_ secret returns 200", async () => {
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	const dummySecret =
		"whsec_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
	Deno.env.set("OUTPOST_WEBHOOK_SECRET", dummySecret);

	const payload = JSON.stringify({
		status: "success",
		amount: 100,
		metadata: { invoice_id: "inv-123" },
	});
	const signatureHex = generateMockOutpostSignatureHexWhsec(
		payload,
		dummySecret,
	);

	const c = createMockContext({
		"x-outpost-signature": signatureHex,
	}, payload);

	const payStub = stub(killBillService, "payInvoiceExternal", () => {
		return Promise.resolve();
	});

	const storageFromStub = stub(supabase.storage, "from", () => {
		return {
			remove: () => Promise.resolve({ data: null, error: null }),
		} as any;
	});

	try {
		const res = await handleBayeuWebhook(c);
		assertEquals((res as any).status, 200);
	} finally {
		payStub.restore();
		storageFromStub.restore();
		if (originalKey === undefined) {
			Deno.env.delete("OUTPOST_WEBHOOK_SECRET");
		} else {
			Deno.env.set("OUTPOST_WEBHOOK_SECRET", originalKey);
		}
	}
});

Deno.test("handleBayeuWebhook - handles storage remove error gracefully", async () => {
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	Deno.env.set("OUTPOST_WEBHOOK_SECRET", "test_secret");

	const payload = JSON.stringify({
		status: "success",
		amount: 100,
		metadata: { invoice_id: "inv-123" },
	});
	const signatureBase64 = await generateMockSignature(payload, "test_secret");

	const c = createMockContext({
		"x-hookdeck-signature": signatureBase64,
	}, payload);

	const payStub = stub(killBillService, "payInvoiceExternal", () => {
		return Promise.resolve();
	});

	const storageFromStub = stub(supabase.storage, "from", () => {
		return {
			remove: () =>
				Promise.resolve({
					data: null,
					error: { message: "Failed deletion" },
				}),
		} as any;
	});

	try {
		const res = await handleBayeuWebhook(c);
		assertEquals((res as any).status, 200);
	} finally {
		payStub.restore();
		storageFromStub.restore();
		if (originalKey === undefined) {
			Deno.env.delete("OUTPOST_WEBHOOK_SECRET");
		} else {
			Deno.env.set("OUTPOST_WEBHOOK_SECRET", originalKey);
		}
	}
});

Deno.test("handleBayeuWebhook - handles storage remove exception gracefully", async () => {
	const originalKey = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	Deno.env.set("OUTPOST_WEBHOOK_SECRET", "test_secret");

	const payload = JSON.stringify({
		status: "success",
		amount: 100,
		metadata: { invoice_id: "inv-123" },
	});
	const signatureBase64 = await generateMockSignature(payload, "test_secret");

	const c = createMockContext({
		"x-hookdeck-signature": signatureBase64,
	}, payload);

	const payStub = stub(killBillService, "payInvoiceExternal", () => {
		return Promise.resolve();
	});

	const storageFromStub = stub(supabase.storage, "from", () => {
		return {
			remove: () => Promise.reject(new Error("Storage service failure")),
		} as any;
	});

	try {
		const res = await handleBayeuWebhook(c);
		assertEquals((res as any).status, 200);
	} finally {
		payStub.restore();
		storageFromStub.restore();
		if (originalKey === undefined) {
			Deno.env.delete("OUTPOST_WEBHOOK_SECRET");
		} else {
			Deno.env.set("OUTPOST_WEBHOOK_SECRET", originalKey);
		}
	}
});

Deno.test("handleBayeuWebhook - returns 500 when request body is malformed JSON", async () => {
	const origSkip = Deno.env.get("SKIP_WEBHOOK_VERIFICATION");
	Deno.env.set("SKIP_WEBHOOK_VERIFICATION", "true");
	try {
		const c = createMockContext({}, "invalid-json-body");
		const res = await handleBayeuWebhook(c);
		assertEquals((res as any).status, 500);
	} finally {
		if (origSkip !== undefined) {
			Deno.env.set("SKIP_WEBHOOK_VERIFICATION", origSkip);
		} else {
			Deno.env.delete("SKIP_WEBHOOK_VERIFICATION");
		}
	}
});
