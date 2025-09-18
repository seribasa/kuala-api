import { Context } from "jsr:@hono/hono";

/**
 * Kuala logout endpoint handler
 * Wrapper for user logout that revokes refresh token
 */
export const handleLogout = async (c: Context) => {
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

        // Build the Supabase logout URL
        const supabaseLogoutUrl = new URL("/auth/v1/logout", c.req.url);

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
        const response = await fetch(supabaseLogoutUrl.toString(), {
            method: "POST",
            headers: {
                "Authorization": authorization,
                "apikey": apikey,
            },
        });

        // Handle Supabase response
        if (!response.ok) {
            const data = await response.json();
            const status = response.status === 401 ? 401 : 500;
            return c.json(data, status);
        }

        // Return 204 No Content for successful logout
        return c.body(null, 204);
    } catch (error) {
        console.error("Error in handleLogout:", error);
        return c.json(
            {
                code: "INTERNAL_ERROR",
                message: "Internal server error",
            },
            500,
        );
    }
};
