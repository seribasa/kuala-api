import { Context } from "jsr:@hono/hono";

/**
 * Kuala exchange-token endpoint handler
 * Wrapper for exchanging OAuth authorization code for access tokens
 */
export const handleExchangeToken = async (c: Context) => {
    try {
        // Parse request body
        const body = await c.req.json();
        const { auth_code, code_verifier } = body;

        // Validate required parameters
        if (!auth_code) {
            return c.json(
                {
                    code: "MISSING_AUTH_CODE",
                    message: "auth_code is required",
                },
                400,
            );
        }

        if (!code_verifier) {
            return c.json(
                {
                    code: "MISSING_CODE_VERIFIER",
                    message: "code_verifier is required",
                },
                400,
            );
        }

        // Build the Supabase token exchange URL
        const supabaseTokenUrl = new URL("/auth/v1/token", c.req.url);
        supabaseTokenUrl.searchParams.set("grant_type", "pkce");

        // Prepare request body for Supabase
        const supabaseRequestBody = {
            auth_code,
            code_verifier,
        };

        // Get apikey from environment or request
        const apikey = Deno.env.get("SUPABASE_ANON_KEY");
        if (!apikey) {
            return c.json(
                {
                    code: "MISSING_API_KEY",
                    message: "Supabase API key not configured",
                },
                500,
            );
        }

        // Forward request to Supabase
        const response = await fetch(supabaseTokenUrl.toString(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": apikey,
            },
            body: JSON.stringify(supabaseRequestBody),
        });

        // Forward response from Supabase
        const data = await response.json();

        if (!response.ok) {
            const status = response.status === 400 ? 400 : 500;
            return c.json(data, status);
        }

        return c.json(data, 200);
    } catch (error) {
        console.error("Error in handleExchangeToken:", error);
        return c.json(
            {
                code: "INTERNAL_ERROR",
                message: "Internal server error",
            },
            500,
        );
    }
};
