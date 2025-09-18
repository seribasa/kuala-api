import { Context } from "jsr:@hono/hono";
import { ErrorResponse } from "../../../_shared/types/baseResponse.ts";

/**
 * Kuala me endpoint handler
 * Wrapper for retrieving current authenticated user information
 */
export const handleMe = async (c: Context) => {
    try {
        // Get Authorization header
        const authorization = c.req.header("Authorization");
        if (!authorization) {
            const errorResponse: ErrorResponse = {
                code: "MISSING_AUTHORIZATION",
                message: "Authorization header is required",
            };
            return c.json(errorResponse, 401);
        }

        // Build the Supabase user URL
        const supabaseBaseUrl = Deno.env.get("SUPABASE_URL") || c.req.url;
        const supabaseUserUrl = new URL("/auth/v1/user", supabaseBaseUrl);

        // Get apikey from environment
        const apikey = Deno.env.get("SUPABASE_ANON_KEY");
        if (!apikey) {
            const errorResponse: ErrorResponse = {
                code: "MISSING_API_KEY",
                message: "Supabase API key not configured",
            };
            return c.json(errorResponse, 500);
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
        const errorResponse: ErrorResponse = {
            code: "INTERNAL_ERROR",
            message: "Internal server error",
        };
        return c.json(errorResponse, 500);
    }
};
