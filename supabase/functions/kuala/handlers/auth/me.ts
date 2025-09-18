import { Context } from "jsr:@hono/hono";

/**
 * Kuala me endpoint handler
 * Wrapper for retrieving current authenticated user information
 */
export const handleMe = async (c: Context) => {
    try {
        // Get Authorization header
        const authorization = c.req.header("Authorization");
        if (!authorization) {
            return c.json(
                {
                    code: "MISSING_AUTHORIZATION",
                    message: "Authorization header is required",
                },
                401,
            );
        }

        // Build the Supabase user URL
        const supabaseUserUrl = new URL("/auth/v1/user", c.req.url);

        // Get apikey from environment
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
        const response = await fetch(supabaseUserUrl.toString(), {
            method: "GET",
            headers: {
                "Authorization": authorization,
                "apikey": apikey,
            },
        });

        // Forward response from Supabase
        const data = await response.json();

        if (!response.ok) {
            const status = response.status === 401 ? 401 : 500;
            return c.json(data, status);
        }

        return c.json(data, 200);
    } catch (error) {
        console.error("Error in handleMe:", error);
        return c.json(
            {
                code: "INTERNAL_ERROR",
                message: "Internal server error",
            },
            500,
        );
    }
};
