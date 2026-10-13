import { type Context, Hono } from "@hono/hono";
import { logger } from "@hono/hono/logger";
import { ErrorResponse } from "../_shared/types/response.ts";
import { customLogger } from "./middleware/logger.ts";
import { corsMiddleware } from "./middleware/cors.ts";
import { appRoutes } from "./routes/index.ts";

export const app = new Hono({ strict: false }).basePath("/kuala");
app.use(logger(customLogger));
app.use("*", corsMiddleware);
app.route("/", appRoutes);

// HANDLE 404
app.notFound((c: Context) => {
	const errorResponse: ErrorResponse = {
		code: "NOT_FOUND",
		message: "Not Found",
	};
	return c.json(
		errorResponse,
		404,
	);
});
// HANDLE ERRORS
app.onError((err: Error, c: Context) => {
	const errorResponse: ErrorResponse = {
		code: "INTERNAL_ERROR",
		message: err.message || "Internal Server Error",
	};
	return c.json(
		errorResponse,
		500,
	);
});

export default app.fetch;

if (import.meta.main) {
	Deno.serve(app.fetch);
}
