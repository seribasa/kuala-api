import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { Context } from "@hono/hono";
import { handleListInvoices } from "../../../kuala/handlers/invoices/list.ts";

// Type definitions for test responses
interface JsonResponse {
	data?: Record<string, unknown>;
	invoices?: Record<string, unknown>[];
	code?: string;
	message?: string;
	status?: number;
}

// Mock fetch response
class MockResponse {
	headers = new Headers();
	constructor(
		private body: unknown,
		private statusCode: number,
		private isOk: boolean = true,
	) {}

	get ok() {
		return this.isOk;
	}

	get status() {
		return this.statusCode;
	}

	json() {
		return Promise.resolve(this.body);
	}

	text() {
		return Promise.resolve(JSON.stringify(this.body));
	}

	clone() {
		return new MockResponse(this.body, this.statusCode, this.isOk);
	}
}

// Helper function to create mock context
function createMockContext(
	user?: { id: string; email: string },
	query: Record<string, string> = {},
) {
	const contextData = new Map();
	if (user) {
		contextData.set("user", user);
	}

	return {
		req: {
			query: (name: string) => query[name],
			header: () => "Bearer valid_token",
			url: "https://kuala-api.example.com/invoices",
		},
		json: (
			data: Record<string, unknown>,
			status?: number,
		) => ({ ...data, status } as JsonResponse),
		get: (key: string) => contextData.get(key),
		set: (key: string, value: unknown) => contextData.set(key, value),
	} as unknown as Context;
}

// Setup common env stub
function setupEnvStub() {
	return stub(Deno.env, "get", (key: string) => {
		if (key === "KILLBILL_BASE_URL") return "http://localhost:8080";
		if (key === "KILLBILL_API_KEY") return "test_key";
		if (key === "KILLBILL_API_SECRET") return "test_secret";
		if (key === "KILLBILL_USERNAME") return "admin";
		if (key === "KILLBILL_PASSWORD") return "password";
		if (key === "KILLBILL_DEFAULT_CURRENCY") return "USD";
		return undefined;
	});
}

const mockUserAccount = {
	accountId: "acc123",
	name: "test@example.com",
	email: "test@example.com",
	externalKey: "user123",
	currency: "USD",
};

const mockInvoices = [
	{ invoiceId: "inv1", accountId: "acc123", amount: 100 },
	{ invoiceId: "inv2", accountId: "acc123", amount: 200 },
	{ invoiceId: "inv3", accountId: "acc456", amount: 300 }, // Different account
];

Deno.test("handleListInvoices - should return 404 when user account not found", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const envStub = setupEnvStub();

	const fetchStub = stub(
		globalThis,
		"fetch",
		() => {
			return Promise.resolve(
				new MockResponse(
					{ error: "Not found" },
					404,
					false,
				) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext(mockUser);
		const response = await handleListInvoices(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 404);
		assertEquals(response.code, "ACCOUNT_NOT_FOUND");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleListInvoices - should list account invoices with pagination", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const envStub = setupEnvStub();

	let callCount = 0;
	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			callCount++;
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;

			if (callCount === 1 && urlString.includes("externalKey=user123")) {
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
						200,
					) as unknown as Response,
				);
			}

			if (urlString.includes("/1.0/kb/accounts/acc123/invoices")) {
				// return only the invoices for this account
				return Promise.resolve(
					new MockResponse(
						mockInvoices.filter((i) => i.accountId === "acc123"),
						200,
					) as unknown as Response,
				);
			}

			return Promise.resolve(
				new MockResponse(
					{ error: "Unexpected call" },
					500,
					false,
				) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext(mockUser, {
			offset: "0",
			limit: "1",
		});
		const response = await handleListInvoices(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, undefined); // 200 default
		assertEquals(response.invoices?.length, 1);
		assertEquals(response.invoices?.[0].invoiceId, "inv1");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleListInvoices - should search invoices and filter by account", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const envStub = setupEnvStub();

	let callCount = 0;
	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			callCount++;
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;

			if (callCount === 1 && urlString.includes("externalKey=user123")) {
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
						200,
					) as unknown as Response,
				);
			}

			if (urlString.includes("/1.0/kb/invoices/search/DRAFT")) {
				// Return all invoices, handler should filter
				return Promise.resolve(
					new MockResponse(mockInvoices, 200) as unknown as Response,
				);
			}

			return Promise.resolve(
				new MockResponse(
					{ error: "Unexpected call" },
					500,
					false,
				) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext(mockUser, { searchKey: "DRAFT" });
		const response = await handleListInvoices(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, undefined);
		assertEquals(response.invoices?.length, 2); // Should filter out the one with acc456
		assertEquals(response.invoices?.[0].invoiceId, "inv1");
		assertEquals(response.invoices?.[1].invoiceId, "inv2");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleListInvoices - should handle network errors gracefully", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const envStub = setupEnvStub();

	let callCount = 0;
	const fetchStub = stub(
		globalThis,
		"fetch",
		() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
						200,
					) as unknown as Response,
				);
			}
			return Promise.reject(new Error("Network error"));
		},
	);

	try {
		const mockContext = createMockContext(mockUser);
		const response = await handleListInvoices(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.code, "INTERNAL_ERROR");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleListInvoices - should handle killbill errors gracefully", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const envStub = setupEnvStub();

	let callCount = 0;
	const fetchStub = stub(
		globalThis,
		"fetch",
		(_url: string | URL | Request) => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
						200,
					) as unknown as Response,
				);
			}
			return Promise.resolve(
				new MockResponse(
					{ error: "Internal Error" },
					500,
					false,
				) as unknown as Response,
			);
		},
	);

	try {
		const mockContext = createMockContext(mockUser, { searchKey: "test" });
		const response = await handleListInvoices(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.code, "KILLBILL_ERROR");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});
