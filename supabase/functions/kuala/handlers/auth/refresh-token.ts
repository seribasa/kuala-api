import { Context } from "jsr:@hono/hono";

/**
 * Kuala refresh-token endpoint handler
 * Wrapper for refreshing access tokens using refresh token
 */
export const handleRefreshToken = async (c: Context) => {
    try {
        // Parse request body
        const body = await c.req.json();
        const { refresh_token } = body;

        // Validate required parameters
        if (!refresh_token) {
            return c.json(
                {
                    code: "MISSING_REFRESH_TOKEN",
                    message: "refresh_token is required",
                },
                400,
            );
        }

        // Build the Supabase token refresh URL
        const supabaseTokenUrl = new URL("/auth/v1/token", c.req.url);
        supabaseTokenUrl.searchParams.set("grant_type", "refresh_token");

        // Prepare request body for Supabase
        const supabaseRequestBody = {
            refresh_token,
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
            const status = response.status === 400
                ? 400
                : response.status === 401
                ? 401
                : 500;
            return c.json(data, status);
        }

        return c.json(data, 200);
    } catch (error) {
        console.error("Error in handleRefreshToken:", error);
        return c.json(
            {
                code: "INTERNAL_ERROR",
                message: "Internal server error",
            },
            500,
        );
    }
};
