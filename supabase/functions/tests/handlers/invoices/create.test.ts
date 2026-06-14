import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { Context } from "@hono/hono";
import { handleCreateInvoice } from "../../../kuala/handlers/invoices/create.ts";

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
		return Promise.resolve(JSON.stringify(this.body));
	}

	clone() {
		return new MockResponse(this.body, this.statusCode, this.isOk);
	}
}

// Helper function to create mock context
function createMockContext(
	body: unknown,
	user?: { id: string; email: string },
	url = "https://kuala-api.example.com/invoices",
) {
	const contextData = new Map();
	if (user) {
		contextData.set("user", user);
	}

	return {
		req: {
			json: () => Promise.resolve(body),
			header: () => "Bearer valid_token",
			url,
		},
		json: (
			data: Record<string, unknown>,
			status?: number,
		) => ({ data, status } as JsonResponse),
		body: (
			data: unknown,
			status?: number,
		) => new Response(data as BodyInit | null, { status }),
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

Deno.test("handleCreateInvoice - should return 400 when body is invalid", async () => {
	const mockContext = {
		req: {
			json: () => Promise.reject(new Error("Invalid JSON")),
			header: () => "Bearer valid_token",
		},
		json: (data: Record<string, unknown>, status: number) => ({
			data,
			status,
		}),
	} as unknown as Context;

	const response = await handleCreateInvoice(
		mockContext,
	) as unknown as JsonResponse;

	assertEquals(response.status, 400);
	assertEquals(response.data.code, "INVALID_REQUEST");
});

Deno.test("handleCreateInvoice - should return 400 when accountId is missing", async () => {
	const mockContext = createMockContext({ targetDate: "2024-01-01" });

	const response = await handleCreateInvoice(
		mockContext,
	) as unknown as JsonResponse;

	assertEquals(response.status, 400);
	assertEquals(response.data.code, "MISSING_ACCOUNT_ID");
});

Deno.test("handleCreateInvoice - should return 404 when user does not own account", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const envStub = setupEnvStub();

	const fetchStub = stub(
		globalThis,
		"fetch",
		() => {
			// Mock getting account by external key (user not found or different account)
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
		const mockContext = createMockContext(
			{ accountId: "acc123" },
			mockUser,
		);

		const response = await handleCreateInvoice(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 404);
		assertEquals(response.data.code, "ACCOUNT_NOT_FOUND");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleCreateInvoice - should return 404 when nothing to invoice", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const mockUserAccount = {
		accountId: "acc123",
		name: "test@example.com",
		email: "test@example.com",
		externalKey: "user123",
		currency: "USD",
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

			if (urlString.includes("externalKey=user123")) {
				// Get user's account
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
						200,
					) as unknown as Response,
				);
			}

			if (urlString.includes("/1.0/kb/invoices")) {
				// trigger invoice run -> returns 404 meaning nothing to invoice
				return Promise.resolve(
					new MockResponse(
						{ error: "Nothing to invoice" },
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
		const mockContext = createMockContext(
			{ accountId: "acc123" },
			mockUser,
		);

		const response = await handleCreateInvoice(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 404);
		assertEquals(response.data.code, "NOTHING_TO_INVOICE");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleCreateInvoice - should return 201 when invoice is created", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const mockUserAccount = {
		accountId: "acc123",
		name: "test@example.com",
		email: "test@example.com",
		externalKey: "user123",
		currency: "USD",
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

			if (urlString.includes("externalKey=user123")) {
				// Get user's account
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
						200,
					) as unknown as Response,
				);
			}

			if (urlString.includes("/1.0/kb/invoices")) {
				// trigger invoice run -> returns 201
				const resp = new MockResponse(
					null,
					201,
				) as unknown as Response;
				resp.headers.set(
					"Location",
					"http://localhost:8080/1.0/kb/invoices/inv123",
				);
				return Promise.resolve(resp);
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
		const mockContext = createMockContext({
			accountId: "acc123",
			targetDate: "2024-02-01",
		}, mockUser);

		const response = await handleCreateInvoice(
			mockContext,
		) as unknown as Response;

		assertEquals(response.status, 201);
		// body should be null per our implementation
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});

Deno.test("handleCreateInvoice - should return 500 when Kill Bill throws an error", async () => {
	const mockUser = {
		id: "user123",
		email: "test@example.com",
	};

	const mockUserAccount = {
		accountId: "acc123",
		name: "test@example.com",
		email: "test@example.com",
		externalKey: "user123",
		currency: "USD",
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

			if (urlString.includes("externalKey=user123")) {
				// Get user's account
				return Promise.resolve(
					new MockResponse(
						mockUserAccount,
						200,
					) as unknown as Response,
				);
			}

			if (urlString.includes("/1.0/kb/invoices")) {
				return Promise.reject(new Error("Network error"));
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
		const mockContext = createMockContext(
			{ accountId: "acc123" },
			mockUser,
		);

		const response = await handleCreateInvoice(
			mockContext,
		) as unknown as JsonResponse;

		assertEquals(response.status, 500);
		assertEquals(response.data.code, "INTERNAL_ERROR");
	} finally {
		envStub.restore();
		fetchStub.restore();
	}
});
