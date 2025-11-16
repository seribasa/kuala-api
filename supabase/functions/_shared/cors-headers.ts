const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers":
		"authorization, x-client-info, apikey, content-type",
	"Access-Control-Allow-Methods": "GET,POST,PUT,DELETE",
};

/**
 * Get CORS configuration from environment variables
 *
 * Environment Variables:
 * - CORS_ENABLED: Enable/disable CORS middleware (default: "true")
 * - CORS_ORIGIN: Allowed origins, comma-separated (default: "*")
 *   Examples:
 *   - "*" (allow all)
 *   - "http://localhost:4200"
 *   - "http://localhost:4200,https://kuala-staging.seribasa.digital,https://kuala.seribasa.digital"
 */
function getCorsConfig() {
	const corsEnabled = Deno.env.get("CORS_ENABLED")?.toLowerCase() !== "false";
	const corsOrigin = Deno.env.get("CORS_ORIGIN") || "*";

	return {
		enabled: corsEnabled,
		origin: corsOrigin,
	};
}

/**
 * Determine allowed origin based on request origin and configured origins
 *
 * @param requestOrigin - Origin from request header
 * @param configuredOrigin - Configured allowed origins (can be "*" or comma-separated list)
 * @returns Allowed origin or null if not allowed
 */
function getAllowedOrigin(
	requestOrigin: string | undefined,
	configuredOrigin: string,
): string | null {
	// If wildcard, allow all origins
	if (configuredOrigin === "*") {
		return "*";
	}

	// If no origin in request, don't set CORS headers
	if (!requestOrigin) {
		return null;
	}

	// Check if request origin is in the allowed list
	const allowedOrigins = configuredOrigin.split(",").map((o) => o.trim());

	if (allowedOrigins.includes(requestOrigin)) {
		return requestOrigin;
	}

	// Origin not allowed
	return null;
}

export { corsHeaders, getAllowedOrigin, getCorsConfig };
