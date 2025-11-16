import { type Context, Hono } from "@hono/hono";
import { logger } from "@hono/hono/logger";
import { handleAuthorize } from "./handlers/auth/authorize.ts";
import { handleExchangeToken } from "./handlers/auth/exchange-token.ts";
import { handleRefreshToken } from "./handlers/auth/refresh-token.ts";
import { handleLogout } from "./handlers/auth/logout.ts";
import { handleMe } from "./handlers/auth/me.ts";
import { handlePlans } from "./handlers/plans/index.ts";
import { ErrorResponse } from "../_shared/types/response.ts";
import { customLogger } from "./middleware/logger.ts";
import { corsMiddleware } from "./middleware/cors.ts";

const auth = new Hono().basePath("/auth");
auth.get("/authorize", handleAuthorize);
auth.post("/exchange-token", handleExchangeToken);
auth.post("/refresh-token", handleRefreshToken);
auth.post("/logout", handleLogout);
auth.get("/me", handleMe);

export const app = new Hono().basePath("/kuala");
// Use custom logger that follows Hono's PrintFunc pattern
app.use(logger(customLogger));
app.use("*", corsMiddleware);
app.route("/", auth);
app.get("/plans", handlePlans);

// HANDLE 404
const errorResponse: ErrorResponse = {
	code: "NOT_FOUND",
	message: "Not Found",
};
app.notFound((c: Context) => {
	return c.json(
		errorResponse,
		404,
	);
});

export default app.fetch;

if (import.meta.main) {
	Deno.serve(app.fetch);
}
