import { assertEquals } from "@std/assert";
import { handlePayInvoice } from "../../../kuala/handlers/invoices/pay.ts";
import { Context } from "@hono/hono";
import { stub } from "@std/testing/mock";
import { killBillService } from "../../../_shared/services/killbill.ts";
import {
	KillBillAccount,
	KillBillInvoice,
} from "../../../_shared/types/index.ts";

type MockResponse = { status?: number; body: unknown };

function createMockContext(options: {
	headers?: Record<string, string>;
	user?: { id: string; email: string } | null;
	paramId?: string;
	body?: Record<string, unknown>;
	queries?: Record<string, string>;
	paramThrows?: boolean;
}) {
	const {
		headers = { Authorization: "Bearer token" },
		user = { id: "123", email: "test@example.com" },
		paramId = "inv-123",
		body = {},
		queries = {},
		paramThrows = false,
	} = options;

	return {
		req: {
			header: (k: string) => headers[k] || null,
			param: (k: string) => {
				if (paramThrows) throw new Error("Param read failure");
				return paramId;
			},
			query: (k?: string) => (k ? queries[k] : queries),
			valid: () => body,
		},
		get: (k: string) => (k === "user" ? user : null),
		json: (body: unknown, status?: number) => ({
			body,
			status: status ?? 200,
		}),
	} as unknown as Context;
}

Deno.test("handlePayInvoice - missing auth header returns 401", async () => {
	const c = createMockContext({ headers: {} });
	const res = await handlePayInvoice(c);
	assertEquals((res as unknown as MockResponse).status, 401);
});

Deno.test("handlePayInvoice - user not in context returns 401", async () => {
	const c = createMockContext({ user: null });
	const res = await handlePayInvoice(c);
	assertEquals((res as unknown as MockResponse).status, 401);
});

Deno.test("handlePayInvoice - returns 500 if PAYMENT_GATEWAY missing", async () => {
	const origGateway = Deno.env.get("PAYMENT_GATEWAY");
	Deno.env.delete("PAYMENT_GATEWAY");
	try {
		const c = createMockContext({});
		const res = await handlePayInvoice(c);
		assertEquals((res as unknown as MockResponse).status, 500);
	} finally {
		if (origGateway !== undefined) {
			Deno.env.set("PAYMENT_GATEWAY", origGateway);
		}
	}
});

Deno.test("handlePayInvoice - returns 500 if invoice fetch fails", async () => {
	Deno.env.set("PAYMENT_GATEWAY", "stripe");
	const getInvoiceByIdStub = stub(killBillService, "getInvoiceById", () => {
		throw new Error("Failed to fetch");
	});
	try {
		const c = createMockContext({});
		const res = await handlePayInvoice(c);
		assertEquals((res as unknown as MockResponse).status, 500);
	} finally {
		getInvoiceByIdStub.restore();
	}
});

Deno.test("handlePayInvoice - returns 403 if account is not found", async () => {
	Deno.env.set("PAYMENT_GATEWAY", "stripe");
	const getInvoiceByIdStub = stub(killBillService, "getInvoiceById", () => {
		return Promise.resolve({
			accountId: "acc-123",
			balance: 100,
			currency: "USD",
		} as unknown as KillBillInvoice);
	});
	const getAccountStub = stub(
		killBillService,
		"getAccountByExternalKey",
		() => {
			return Promise.resolve(null as unknown as KillBillAccount);
		},
	);
	try {
		const c = createMockContext({});
		const res = await handlePayInvoice(c);
		assertEquals((res as unknown as MockResponse).status, 403);
	} finally {
		getInvoiceByIdStub.restore();
		getAccountStub.restore();
	}
});

Deno.test("handlePayInvoice - returns 403 if invoice does not belong to user", async () => {
	Deno.env.set("PAYMENT_GATEWAY", "stripe");
	const getInvoiceByIdStub = stub(killBillService, "getInvoiceById", () => {
		return Promise.resolve({
			accountId: "other-acc-456",
			balance: 100,
			currency: "USD",
		} as unknown as KillBillInvoice);
	});
	const getAccountStub = stub(
		killBillService,
		"getAccountByExternalKey",
		() => {
			return Promise.resolve(
				{ accountId: "acc-123" } as unknown as KillBillAccount,
			);
		},
	);
	try {
		const c = createMockContext({});
		const res = await handlePayInvoice(c);
		assertEquals((res as unknown as MockResponse).status, 403);
	} finally {
		getInvoiceByIdStub.restore();
		getAccountStub.restore();
	}
});

Deno.test("handlePayInvoice - returns 400 if invoice balance is zero or negative", async () => {
	Deno.env.set("PAYMENT_GATEWAY", "stripe");
	const getInvoiceByIdStub = stub(killBillService, "getInvoiceById", () => {
		return Promise.resolve({
			accountId: "acc-123",
			balance: 0,
			currency: "USD",
		} as unknown as KillBillInvoice);
	});
	const getAccountStub = stub(
		killBillService,
		"getAccountByExternalKey",
		() => {
			return Promise.resolve(
				{ accountId: "acc-123" } as unknown as KillBillAccount,
			);
		},
	);
	try {
		const c = createMockContext({});
		const res = await handlePayInvoice(c);
		assertEquals((res as unknown as MockResponse).status, 400);
	} finally {
		getInvoiceByIdStub.restore();
		getAccountStub.restore();
	}
});

Deno.test("handlePayInvoice - returns 500 if BAYEU_API_URL missing", async () => {
	Deno.env.set("PAYMENT_GATEWAY", "stripe");
	const origUrl = Deno.env.get("BAYEU_API_URL");
	Deno.env.delete("BAYEU_API_URL");
	Deno.env.set("BAYEU_ANON_KEY", "test-anon-key");
	const getInvoiceByIdStub = stub(killBillService, "getInvoiceById", () => {
		return Promise.resolve({
			accountId: "acc-123",
			balance: 100,
			currency: "USD",
		} as unknown as KillBillInvoice);
	});
	const getAccountStub = stub(
		killBillService,
		"getAccountByExternalKey",
		() => {
			return Promise.resolve(
				{ accountId: "acc-123" } as unknown as KillBillAccount,
			);
		},
	);
	try {
		const c = createMockContext({});
		const res = await handlePayInvoice(c);
		assertEquals((res as unknown as MockResponse).status, 500);
	} finally {
		getInvoiceByIdStub.restore();
		getAccountStub.restore();
		if (origUrl !== undefined) {
			Deno.env.set("BAYEU_API_URL", origUrl);
		}
	}
});

Deno.test("handlePayInvoice - returns 500 if BAYEU_ANON_KEY missing", async () => {
	Deno.env.set("PAYMENT_GATEWAY", "stripe");
	Deno.env.set("BAYEU_API_URL", "http://localhost:54331");
	const origKey = Deno.env.get("BAYEU_ANON_KEY");
	Deno.env.delete("BAYEU_ANON_KEY");
	const getInvoiceByIdStub = stub(killBillService, "getInvoiceById", () => {
		return Promise.resolve({
			accountId: "acc-123",
			balance: 100,
			currency: "USD",
		} as unknown as KillBillInvoice);
	});
	const getAccountStub = stub(
		killBillService,
		"getAccountByExternalKey",
		() => {
			return Promise.resolve(
				{ accountId: "acc-123" } as unknown as KillBillAccount,
			);
		},
	);
	try {
		const c = createMockContext({});
		const res = await handlePayInvoice(c);
		assertEquals((res as unknown as MockResponse).status, 500);
	} finally {
		getInvoiceByIdStub.restore();
		getAccountStub.restore();
		if (origKey !== undefined) {
			Deno.env.set("BAYEU_ANON_KEY", origKey);
		}
	}
});

Deno.test("handlePayInvoice - returns 200 with redirect_url and body urls", async () => {
	Deno.env.set("BAYEU_API_URL", "http://localhost:54331");
	Deno.env.set("BAYEU_ANON_KEY", "test-anon-key");
	Deno.env.set("PAYMENT_GATEWAY", "stripe");
	const getInvoiceByIdStub = stub(killBillService, "getInvoiceById", () => {
		return Promise.resolve({
			accountId: "acc-123",
			balance: 100,
			currency: "USD",
		} as unknown as KillBillInvoice);
	});
	const getAccountStub = stub(
		killBillService,
		"getAccountByExternalKey",
		() => {
			return Promise.resolve(
				{ accountId: "acc-123" } as unknown as KillBillAccount,
			);
		},
	);
	let capturedBody: string | undefined;
	const fetchStub = stub(
		globalThis,
		"fetch",
		(_url: unknown, init?: RequestInit) => {
			capturedBody = init?.body as string;
			return Promise.resolve(
				new Response(
					JSON.stringify({
						is_successful: true,
						data: {
							order_id: "order-123",
							gateway: "stripe",
							token: "tok-123",
							redirect_url: "https://pay.example.com",
						},
					}),
					{ status: 200 },
				),
			);
		},
	);
	try {
		const c = createMockContext({
			body: {
				back_url: "https://back.example.com",
				success_url: "https://success.example.com",
				failed_url: "https://failed.example.com",
			},
		});

		const res = await handlePayInvoice(c);
		assertEquals((res as unknown as MockResponse).status, 200);
		const resBody = (res as unknown as MockResponse).body as Record<
			string,
			unknown
		>;
		assertEquals(resBody.is_successful, true);
		const data = resBody.data as Record<string, unknown>;
		assertEquals(data.redirect_url, "https://pay.example.com");
		const parsedCaptured = JSON.parse(capturedBody!);
		assertEquals(parsedCaptured.back_url, "https://back.example.com");
		assertEquals(parsedCaptured.success_url, "https://success.example.com");
		assertEquals(parsedCaptured.failed_url, "https://failed.example.com");
	} finally {
		getInvoiceByIdStub.restore();
		getAccountStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handlePayInvoice - uses query urls when body urls are missing", async () => {
	Deno.env.set("BAYEU_API_URL", "http://localhost:54331");
	Deno.env.set("BAYEU_ANON_KEY", "test-anon-key");
	Deno.env.set("PAYMENT_GATEWAY", "stripe");
	const getInvoiceByIdStub = stub(killBillService, "getInvoiceById", () => {
		return Promise.resolve({
			accountId: "acc-123",
			balance: 100,
			currency: "USD",
		} as unknown as KillBillInvoice);
	});
	const getAccountStub = stub(
		killBillService,
		"getAccountByExternalKey",
		() => {
			return Promise.resolve(
				{ accountId: "acc-123" } as unknown as KillBillAccount,
			);
		},
	);
	let capturedBody: string | undefined;
	const fetchStub = stub(
		globalThis,
		"fetch",
		(_url: unknown, init?: RequestInit) => {
			capturedBody = init?.body as string;
			return Promise.resolve(
				new Response(
					JSON.stringify({ is_successful: false, data: {} }),
					{
						status: 200,
					},
				),
			);
		},
	);
	try {
		const c = createMockContext({
			body: {},
			queries: {
				back_url: "https://query-back.com",
				success_url: "https://query-success.com",
				failed_url: "https://query-failed.com",
			},
		});

		const res = await handlePayInvoice(c);
		assertEquals((res as unknown as MockResponse).status, 200);
		const parsedCaptured = JSON.parse(capturedBody!);
		assertEquals(parsedCaptured.back_url, "https://query-back.com");
		assertEquals(parsedCaptured.success_url, "https://query-success.com");
		assertEquals(parsedCaptured.failed_url, "https://query-failed.com");
	} finally {
		getInvoiceByIdStub.restore();
		getAccountStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handlePayInvoice - handles bayeu error response with parsed message", async () => {
	Deno.env.set("BAYEU_API_URL", "http://localhost:54331");
	Deno.env.set("BAYEU_ANON_KEY", "test-anon-key");
	Deno.env.set("PAYMENT_GATEWAY", "stripe");
	const getInvoiceByIdStub = stub(killBillService, "getInvoiceById", () => {
		return Promise.resolve({
			accountId: "acc-123",
			balance: 100,
			currency: "USD",
		} as unknown as KillBillInvoice);
	});
	const getAccountStub = stub(
		killBillService,
		"getAccountByExternalKey",
		() => {
			return Promise.resolve(
				{ accountId: "acc-123" } as unknown as KillBillAccount,
			);
		},
	);
	const fetchStub = stub(globalThis, "fetch", () => {
		return Promise.resolve(
			new Response(
				JSON.stringify({
					is_successful: false,
					message: "Invalid card payment",
				}),
				{ status: 422 },
			),
		);
	});
	try {
		const c = createMockContext({});
		const res = await handlePayInvoice(c);
		assertEquals((res as unknown as MockResponse).status, 422);
		const resBody = (res as unknown as MockResponse).body as Record<
			string,
			unknown
		>;
		assertEquals(resBody.code, "BAD_REQUEST");
		assertEquals(resBody.message, "Invalid card payment");
	} finally {
		getInvoiceByIdStub.restore();
		getAccountStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handlePayInvoice - handles bayeu error response without parsed json message", async () => {
	Deno.env.set("BAYEU_API_URL", "http://localhost:54331");
	Deno.env.set("BAYEU_ANON_KEY", "test-anon-key");
	Deno.env.set("PAYMENT_GATEWAY", "stripe");
	const getInvoiceByIdStub = stub(killBillService, "getInvoiceById", () => {
		return Promise.resolve({
			accountId: "acc-123",
			balance: 100,
			currency: "USD",
		} as unknown as KillBillInvoice);
	});
	const getAccountStub = stub(
		killBillService,
		"getAccountByExternalKey",
		() => {
			return Promise.resolve(
				{ accountId: "acc-123" } as unknown as KillBillAccount,
			);
		},
	);
	const fetchStub = stub(globalThis, "fetch", () => {
		return Promise.resolve(
			new Response("Internal error text", { status: 502 }),
		);
	});
	try {
		const c = createMockContext({});
		const res = await handlePayInvoice(c);
		assertEquals((res as unknown as MockResponse).status, 500);
		const resBody = (res as unknown as MockResponse).body as Record<
			string,
			unknown
		>;
		assertEquals(resBody.code, "INTERNAL_ERROR");
	} finally {
		getInvoiceByIdStub.restore();
		getAccountStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handlePayInvoice - catches unexpected exception and returns 500", async () => {
	const c = createMockContext({ paramThrows: true });
	const res = await handlePayInvoice(c);
	assertEquals((res as unknown as MockResponse).status, 500);
});
