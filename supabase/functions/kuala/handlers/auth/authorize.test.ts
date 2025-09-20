import { assertEquals } from "jsr:@std/assert";
import { stub } from "jsr:@std/testing/mock";
import { Context } from "jsr:@hono/hono";
import { handleAuthorize } from "./authorize.ts";

// Type definitions for test responses
interface JsonResponse {
    data: {
        code: string;
        message: string;
    };
    status: number;
}

interface RedirectResponse {
    redirectUrl: string;
    status: number;
}

// Helper function to create mock context
function createMockContext(
    queryParams: Record<string, string> = {},
    url = "https://kuala-api.example.com/auth/authorize",
) {
    return {
        req: {
            query: (key: string) => queryParams[key],
            url,
        },
        json: (
            data: { code: string; message: string },
            status?: number,
        ) => ({ data, status } as JsonResponse),
        redirect: (
            url: string,
            status?: number,
        ) => ({ redirectUrl: url, status } as RedirectResponse),
    } as unknown as Context;
}

Deno.test("handleAuthorize - should return 400 when redirect_to is missing", async () => {
    const mockContext = createMockContext({
        code_challenge: "test_challenge",
    });

    const response = await handleAuthorize(mockContext) as unknown as JsonResponse;

    assertEquals(response.status, 400);
    assertEquals(response.data.code, "MISSING_REDIRECT_TO");
    assertEquals(response.data.message, "redirect_to parameter is required");
});

Deno.test("handleAuthorize - should return 400 when code_challenge is missing", async () => {
    const mockContext = createMockContext({
        redirect_to: "https://example.com/callback",
    });

    const response = await handleAuthorize(mockContext) as unknown as JsonResponse;

    assertEquals(response.status, 400);
    assertEquals(response.data.code, "MISSING_CODE_CHALLENGE");
    assertEquals(response.data.message, "code_challenge parameter is required");
});

Deno.test("handleAuthorize - should return 400 when redirect_to is invalid URL", async () => {
    const mockContext = createMockContext({
        redirect_to: "invalid-url",
        code_challenge: "test_challenge",
    });

    const response = await handleAuthorize(mockContext) as unknown as JsonResponse;

    assertEquals(response.status, 400);
    assertEquals(response.data.code, "INVALID_REDIRECT_TO");
    assertEquals(response.data.message, "redirect_to must be a valid URL");
});

Deno.test("handleAuthorize - should redirect with correct parameters when all inputs are valid", async () => {
    // Mock environment variable
    const envStub = stub(Deno.env, "get", (key: string) => {
        if (key === "AUTH_BASE_URL") return "https://test.supabase.co";
        return undefined;
    });

    // Mock fetch to simulate Supabase redirect response
    const fetchStub = stub(globalThis, "fetch", () => {
        return Promise.resolve(new Response(null, {
            status: 302,
            headers: {
                location: "https://keycloak.example.com/auth?redirect=test"
            }
        }));
    });

    try {
        const redirectTo = "https://example.com/callback";
        const codeChallenge = "test_challenge_123";

        const mockContext = createMockContext({
            redirect_to: redirectTo,
            code_challenge: codeChallenge,
        });

        const response = await handleAuthorize(
            mockContext,
        ) as unknown as RedirectResponse;

        assertEquals(response.status, 302);
        assertEquals(response.redirectUrl, "https://keycloak.example.com/auth?redirect=test");
    } finally {
        envStub.restore();
        fetchStub.restore();
    }
});

Deno.test("handleAuthorize - should handle URL constructor error gracefully", async () => {
    // Create a stub that makes URL constructor throw
    const originalURL = globalThis.URL;
    let constructorCallCount = 0;

    globalThis.URL = class extends URL {
        constructor(url: string | URL, base?: string | URL) {
            constructorCallCount++;
            if (constructorCallCount === 1) {
                // First call is for validation - throw error
                throw new Error("Invalid URL");
            }
            // Second call is for building supabase URL - allow it
            super(url, base);
        }
    } as typeof URL;

    try {
        const mockContext = createMockContext({
            redirect_to: "https://example.com/callback",
            code_challenge: "test_challenge",
        });

        const response = await handleAuthorize(
            mockContext,
        ) as unknown as JsonResponse;

        assertEquals(response.status, 400);
        assertEquals(response.data.code, "INVALID_REDIRECT_TO");
        assertEquals(response.data.message, "redirect_to must be a valid URL");
    } finally {
        globalThis.URL = originalURL;
    }
});

Deno.test("handleAuthorize - should handle unexpected errors", async () => {
    // Mock context that will cause an error when accessing req.query
    const mockContext = {
        req: {
            query: () => {
                throw new Error("Unexpected error");
            },
            url: "https://kuala-api.example.com/auth/authorize",
        },
        json: (
            data: { code: string; message: string },
            status?: number,
        ) => ({ data, status } as JsonResponse),
    } as unknown as Context;

    // Stub console.error to avoid noise in test output
    const consoleStub = stub(console, "error");

    try {
        const response = await handleAuthorize(
            mockContext,
        ) as unknown as JsonResponse;

        assertEquals(response.status, 500);
        assertEquals(response.data.code, "INTERNAL_ERROR");
        assertEquals(response.data.message, "Internal server error");
    } finally {
        consoleStub.restore();
    }
});
