import { assertEquals } from "@std/assert";
import { handlePayInvoice } from "../../../kuala/handlers/invoices/pay.ts";
import { Context } from "@hono/hono";
import { stub } from "@std/testing/mock";
import { killBillService } from "../../../_shared/services/killbill.ts";
import { KillBillInvoice } from "../../../_shared/types/index.ts";

type MockResponse = { status: number; body: unknown };

Deno.test("handlePayInvoice - missing auth header returns 401", async () => {
	const req = new Request("http://localhost/invoices/inv-123/pay", {
		method: "POST",
	});
	const c = {
		req: {
			header: (k: string) => null,
		},
		json: (body: unknown, status: number) => ({ body, status }),
	} as unknown as Context;

	const res = await handlePayInvoice(c);
	assertEquals((res as unknown as MockResponse).status, 401);
});

Deno.test("handlePayInvoice - user not in context returns 500 because getUser throws", async () => {
	const req = new Request("http://localhost/invoices/inv-123/pay", {
		method: "POST",
		headers: { "Authorization": "Bearer token" },
	});
	const c = {
		req: {
			header: (k: string) => req.headers.get(k),
		},
		get: (k: string) => null, // No user
		json: (body: unknown, status: number) => ({ body, status }),
	} as unknown as Context;

	const res = await handlePayInvoice(c);
	assertEquals((res as unknown as MockResponse).status, 500);
});

Deno.test("handlePayInvoice - returns 400 if invoice id missing", async () => {
	const req = new Request("http://localhost/invoices//pay", {
		method: "POST",
		headers: { "Authorization": "Bearer token" },
	});
	const c = {
		req: {
			header: (k: string) => req.headers.get(k),
			param: (k: string) => null, // No invoice ID
		},
		get: (k: string) => ({ id: "123", email: "test@example.com" }),
		json: (body: unknown, status: number) => ({ body, status }),
	} as unknown as Context;

	const res = await handlePayInvoice(c);
	assertEquals((res as unknown as MockResponse).status, 400);
});

Deno.test("handlePayInvoice - returns 500 if invoice fetch fails", async () => {
	const getInvoiceByIdStub = stub(killBillService, "getInvoiceById", () => {
		throw new Error("Failed to fetch");
	});
	try {
		const req = new Request("http://localhost/invoices/inv-123/pay", {
			method: "POST",
			headers: { "Authorization": "Bearer token" },
		});
		const c = {
			req: {
				header: (k: string) => req.headers.get(k),
				param: (k: string) => "inv-123",
			},
			get: (k: string) => ({ id: "123", email: "test@example.com" }),
			json: (body: unknown, status?: number) => ({ body, status }),
		} as unknown as Context;

		const res = await handlePayInvoice(c);
		assertEquals((res as unknown as MockResponse).status, 500);
	} finally {
		getInvoiceByIdStub.restore();
	}
});

Deno.test("handlePayInvoice - returns 400 if invoice balance is zero", async () => {
	const getInvoiceByIdStub = stub(killBillService, "getInvoiceById", () => {
		return Promise.resolve(
			{ balance: 0, currency: "USD" } as unknown as KillBillInvoice,
		);
	});
	try {
		const req = new Request("http://localhost/invoices/inv-123/pay", {
			method: "POST",
			headers: { "Authorization": "Bearer token" },
		});
		const c = {
			req: {
				header: (k: string) => req.headers.get(k),
				param: (k: string) => "inv-123",
			},
			get: (k: string) => ({ id: "123", email: "test@example.com" }),
			json: (body: unknown, status?: number) => ({ body, status }),
		} as unknown as Context;

		const res = await handlePayInvoice(c);
		assertEquals((res as unknown as MockResponse).status, 400);
	} finally {
		getInvoiceByIdStub.restore();
	}
});

Deno.test("handlePayInvoice - returns 500 if bayeu initiate fails", async () => {
	const getInvoiceByIdStub = stub(killBillService, "getInvoiceById", () => {
		return Promise.resolve(
			{ balance: 100, currency: "USD" } as unknown as KillBillInvoice,
		);
	});
	const fetchStub = stub(globalThis, "fetch", () => {
		return Promise.resolve(new Response("Error", { status: 500 }));
	});
	try {
		const req = new Request("http://localhost/invoices/inv-123/pay", {
			method: "POST",
			headers: { "Authorization": "Bearer token" },
		});
		const c = {
			req: {
				header: (k: string) => req.headers.get(k),
				param: (k: string) => "inv-123",
			},
			get: (k: string) => ({ id: "123", email: "test@example.com" }),
			json: (body: unknown, status?: number) => ({ body, status }),
		} as unknown as Context;

		const res = await handlePayInvoice(c);
		assertEquals((res as unknown as MockResponse).status, 500);
	} finally {
		getInvoiceByIdStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handlePayInvoice - returns 200 on success", async () => {
	const getInvoiceByIdStub = stub(killBillService, "getInvoiceById", () => {
		return Promise.resolve(
			{ balance: 100, currency: "USD" } as unknown as KillBillInvoice,
		);
	});
	const fetchStub = stub(globalThis, "fetch", () => {
		return Promise.resolve(
			new Response(JSON.stringify({ success: true }), { status: 200 }),
		);
	});
	try {
		const req = new Request("http://localhost/invoices/inv-123/pay", {
			method: "POST",
			headers: { "Authorization": "Bearer token" },
		});
		const c = {
			req: {
				header: (k: string) => req.headers.get(k),
				param: (k: string) => "inv-123",
			},
			get: (k: string) => ({ id: "123", email: "test@example.com" }),
			json: (body: unknown, status?: number) => ({ body, status }),
		} as unknown as Context;

		const res = await handlePayInvoice(c);
		assertEquals((res as unknown as MockResponse).status, undefined);
	} finally {
		getInvoiceByIdStub.restore();
		fetchStub.restore();
	}
});
