import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { Context } from "@hono/hono";
import { handleDownloadInvoicePdf } from "../../../kuala/handlers/invoices/download-pdf.ts";
import { supabase } from "../../../_shared/supabase.ts";

// Type definitions for test responses
interface JsonResponse {
	data: Record<string, unknown>;
	status: number;
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
		if (typeof this.body === "string") {
			return Promise.resolve(this.body);
		}
		return Promise.resolve(JSON.stringify(this.body));
	}

	clone() {
		return new MockResponse(this.body, this.statusCode, this.isOk);
	}
}

// Helper function to create mock context
function createMockContext(
	invoiceId: string,
	user?: { id: string; email: string },
	url = "https://kuala-api.example.com/invoices",
) {
	const contextData = new Map();
	if (user) {
		contextData.set("user", user);
	}

	return {
		req: {
			param: (name: string) =>
				name === "invoiceId" ? invoiceId : undefined,
			header: () => "Bearer valid_token",
			url,
		},
		json: (
			data: Record<string, unknown>,
			status?: number,
		) => ({ data, status } as JsonResponse),
		redirect: (url: string, status = 302) => ({
			url,
			status,
			isRedirect: true,
		} as unknown as Response),
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

Deno.test("handleDownloadInvoicePdf - should return 400 when invoiceId is missing", async () => {
	const mockContext = createMockContext("");

	const response = await handleDownloadInvoicePdf(
		mockContext,
	) as unknown as JsonResponse;

	assertEquals(response.status, 400);
	assertEquals(response.data.code, "MISSING_INVOICE_ID");
});

Deno.test("handleDownloadInvoicePdf - should return 404 when user does not own invoice", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const envStub = setupEnvStub();

	const mockInvoice = {
		invoiceId: "inv123",
		accountId: "different-account",
		amount: 100,
		status: "COMMITTED",
	};

	const mockUserAccount = {
		accountId: "user-account",
		name: "test@example.com",
		email: "test@example.com",
		externalKey: "user123",
		currency: "USD",
	};

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

			if (
				callCount === 1 &&
				urlString.includes("/1.0/kb/invoices/inv123")
			) {
				return Promise.resolve(
					new MockResponse(
						mockInvoice,
						200,
					) as unknown as Response,
				);
			}

			if (callCount === 2 && urlString.includes("externalKey=user123")) {
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
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
		const mockContext = createMockContext("inv123", mockUser);

		const response = await handleDownloadInvoicePdf(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 404);
		assertEquals(response.data.code, "INVOICE_NOT_FOUND");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleDownloadInvoicePdf - should return 404 when Kill Bill throws INVOICE_NOT_FOUND", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const envStub = setupEnvStub();

	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;

			if (urlString.includes("/1.0/kb/invoices/nonexistent")) {
				return Promise.resolve(
					new MockResponse(
						{ error: "Not found" },
						404,
						false,
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
		const mockContext = createMockContext("nonexistent", mockUser);

		const response = await handleDownloadInvoicePdf(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 404);
		assertEquals(response.data.code, "INVOICE_NOT_FOUND");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleDownloadInvoicePdf - should return redirect to signed URL when PDF is newly generated", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const mockInvoice = {
		invoiceId: "inv123",
		accountId: "acc123",
		amount: 100,
		currency: "USD",
		status: "COMMITTED",
		invoiceDate: "2024-01-01",
		targetDate: "2024-01-01",
		balance: 100,
		items: [],
	};

	const mockUserAccount = {
		accountId: "acc123",
		name: "test@example.com",
		email: "test@example.com",
		externalKey: "user123",
		currency: "USD",
	};

	const mockHtmlContent =
		"<html><body><h1>Invoice</h1><p>Amount: $100</p></body></html>";

	const envStub = setupEnvStub();

	const storageStub = stub(supabase.storage, "from", () =>
		({
			list: () => Promise.resolve({ data: [] }), // Not found
			upload: () => Promise.resolve({ error: null }),
			createSignedUrl: () =>
				Promise.resolve({
					data: { signedUrl: "https://example.com/signed-url" },
					error: null,
				}),
		}) as unknown as ReturnType<typeof supabase.storage.from>);

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

			if (urlString.includes("/1.0/kb/invoices/inv123/html")) {
				return Promise.resolve(
					new MockResponse(
						mockHtmlContent,
						200,
					) as unknown as Response,
				);
			}

			if (urlString.includes("/1.0/kb/invoices/inv123")) {
				return Promise.resolve(
					new MockResponse(
						mockInvoice,
						200,
					) as unknown as Response,
				);
			}

			if (urlString.includes("externalKey=user123")) {
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
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
		const mockContext = createMockContext("inv123", mockUser);

		const response = await handleDownloadInvoicePdf(
			mockContext,
		) as unknown as Response & { url: string };

		assertEquals(response.status, 303);
		assertEquals(response.url, "https://example.com/signed-url");
	} finally {
		envStub.restore();
		fetchStub.restore();
		storageStub.restore();
	}
});

Deno.test("handleDownloadInvoicePdf - should return redirect to signed URL directly when PDF already exists", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const mockInvoice = {
		invoiceId: "inv123",
		accountId: "acc123",
		amount: 100,
		status: "COMMITTED",
	};

	const mockUserAccount = {
		accountId: "acc123",
		externalKey: "user123",
		currency: "USD",
	};

	const envStub = setupEnvStub();

	const storageStub = stub(supabase.storage, "from", () =>
		({
			list: () =>
				Promise.resolve({ data: [{ name: "invoice-inv123.pdf" }] }), // Found in storage!
			upload: () => Promise.reject(new Error("Should not upload")),
			createSignedUrl: () =>
				Promise.resolve({
					data: {
						signedUrl: "https://example.com/signed-url-existing",
					},
					error: null,
				}),
		}) as unknown as ReturnType<typeof supabase.storage.from>);

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

			// It should NOT call HTML generation endpoint
			if (urlString.includes("/1.0/kb/invoices/inv123/html")) {
				return Promise.reject(
					new Error("Should not fetch HTML if cached"),
				);
			}

			if (urlString.includes("/1.0/kb/invoices/inv123")) {
				return Promise.resolve(
					new MockResponse(
						mockInvoice,
						200,
					) as unknown as Response,
				);
			}

			if (urlString.includes("externalKey=user123")) {
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
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
		const mockContext = createMockContext("inv123", mockUser);

		const response = await handleDownloadInvoicePdf(
			mockContext,
		) as unknown as Response & { url: string };

		assertEquals(response.status, 303);
		assertEquals(response.url, "https://example.com/signed-url-existing");
	} finally {
		envStub.restore();
		fetchStub.restore();
		storageStub.restore();
	}
});

Deno.test("handleDownloadInvoicePdf - should handle Kill Bill service errors gracefully", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const envStub = setupEnvStub();

	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;

			if (urlString.includes("/1.0/kb/invoices/inv123")) {
				return Promise.resolve(
					new MockResponse(
						{ error: "Internal error" },
						500,
						false,
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
		const mockContext = createMockContext("inv123", mockUser);

		const response = await handleDownloadInvoicePdf(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "KILLBILL_ERROR");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleDownloadInvoicePdf - should handle network errors gracefully", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const envStub = setupEnvStub();

	const fetchStub = stub(
		globalThis,
		"fetch",
		() => {
			return Promise.reject(new Error("Network error"));
		},
	);

	try {
		const mockContext = createMockContext("inv123", mockUser);

		const response = await handleDownloadInvoicePdf(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "INTERNAL_ERROR");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleDownloadInvoicePdf - should handle storage upload errors gracefully", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const mockInvoice = {
		invoiceId: "inv123",
		accountId: "acc123",
		amount: 100,
		status: "COMMITTED",
	};

	const mockUserAccount = {
		accountId: "acc123",
		externalKey: "user123",
		currency: "USD",
	};

	const envStub = setupEnvStub();

	const storageStub = stub(supabase.storage, "from", () =>
		({
			list: () => Promise.resolve({ data: [] }), // Not found in storage
			upload: () =>
				Promise.resolve({ error: new Error("Upload failed") }),
			createSignedUrl: () =>
				Promise.resolve({ data: { signedUrl: "" }, error: null }),
		}) as unknown as ReturnType<typeof supabase.storage.from>);

	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;
			if (urlString.includes("/1.0/kb/invoices/inv123/html")) {
				return Promise.resolve(
					new MockResponse(
						"<html>Invoice</html>",
						200,
					) as unknown as Response,
				);
			}
			if (urlString.includes("/1.0/kb/invoices/inv123")) {
				return Promise.resolve(
					new MockResponse(mockInvoice, 200) as unknown as Response,
				);
			}
			if (urlString.includes("externalKey=user123")) {
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
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
		const mockContext = createMockContext("inv123", mockUser);
		const response = await handleDownloadInvoicePdf(
			mockContext,
		) as unknown as JsonResponse;
		assertEquals(response.status, 500);
		assertEquals(response.data.code, "INTERNAL_ERROR");
	} finally {
		envStub.restore();
		fetchStub.restore();
		storageStub.restore();
	}
});

Deno.test("handleDownloadInvoicePdf - should handle signed url generation errors gracefully", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const mockInvoice = {
		invoiceId: "inv123",
		accountId: "acc123",
		amount: 100,
		status: "COMMITTED",
	};

	const mockUserAccount = {
		accountId: "acc123",
		externalKey: "user123",
		currency: "USD",
	};

	const envStub = setupEnvStub();

	const storageStub = stub(supabase.storage, "from", () =>
		({
			list: () =>
				Promise.resolve({ data: [{ name: "invoice-inv123.pdf" }] }), // Found in storage
			upload: () => Promise.reject(new Error("Should not upload")),
			createSignedUrl: () =>
				Promise.resolve({
					data: null,
					error: new Error("Signed URL failed"),
				}),
		}) as unknown as ReturnType<typeof supabase.storage.from>);

	const fetchStub = stub(
		globalThis,
		"fetch",
		(url: string | URL | Request) => {
			const urlString = typeof url === "string"
				? url
				: url instanceof URL
				? url.toString()
				: url.url;
			if (urlString.includes("/1.0/kb/invoices/inv123")) {
				return Promise.resolve(
					new MockResponse(mockInvoice, 200) as unknown as Response,
				);
			}
			if (urlString.includes("externalKey=user123")) {
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
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
		const mockContext = createMockContext("inv123", mockUser);
		const response = await handleDownloadInvoicePdf(
			mockContext,
		) as unknown as JsonResponse;
		assertEquals(response.status, 500);
		assertEquals(response.data.code, "INTERNAL_ERROR");
	} finally {
		envStub.restore();
		fetchStub.restore();
		storageStub.restore();
	}
});
