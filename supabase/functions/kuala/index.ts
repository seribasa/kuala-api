import { type Context, Hono } from "@hono/hono";
import { logger } from "@hono/hono/logger";
import { handleAuthorize } from "./handlers/auth/authorize.ts";
import { handleExchangeToken } from "./handlers/auth/exchange-token.ts";
import { handleRefreshToken } from "./handlers/auth/refresh-token.ts";
import { handleLogout } from "./handlers/auth/logout.ts";
import { handleMe } from "./handlers/auth/me.ts";
import { handlePlans } from "./handlers/plans/index.ts";
import {
	handleCreateSubscription,
	handleGetSubscription,
	handleGetSubscriptionById,
} from "./handlers/subscriptions/index.ts";
import { handleCreateEventDrivenSubscription } from "./handlers/subscriptions/create-event-driven.ts";
import { handleGetSubscriptionStatus } from "./handlers/subscriptions/status.ts";
import {
	handleCreateInvoice,
	handleDownloadInvoicePdf,
	handleGetInvoiceById,
	handleListInvoices,
	handlePayInvoice,
} from "./handlers/invoices/index.ts";
import { handleBayeuWebhook } from "./handlers/webhooks/bayeu.ts";
import { ErrorResponse } from "../_shared/types/response.ts";
import { customLogger } from "./middleware/logger.ts";
import { corsMiddleware } from "./middleware/cors.ts";
import { authMiddleware } from "./middleware/auth.ts";

const publicRoutes = new Hono().basePath("/");
publicRoutes.get("/plans", handlePlans);

const authRoutes = new Hono().basePath("/auth");
authRoutes.get("/authorize", handleAuthorize);
authRoutes.post("/exchange-token", handleExchangeToken);
authRoutes.post("/refresh-token", handleRefreshToken);
authRoutes.post("/logout", handleLogout);
authRoutes.get("/me", handleMe);

const subscriptionRoutes = new Hono().basePath("/subscriptions");
subscriptionRoutes.use(authMiddleware);
// Deprecated endpoints for subscriptions, but still supported for backward compatibility
subscriptionRoutes.post("/", handleCreateSubscription);
subscriptionRoutes.post("/v2", handleCreateEventDrivenSubscription);
// "/subscriptions/event-driven" redirect to"/subscriptions/v2"
subscriptionRoutes.post("/event-driven", (c) => {
	// 308 preserves the HTTP method (POST) and payload
	return c.redirect("/v2", 308);
});
subscriptionRoutes.get("/", handleGetSubscription);
subscriptionRoutes.get("/:subscriptionId", handleGetSubscriptionById);
subscriptionRoutes.get(
	"/status/:correlationId",
	handleGetSubscriptionStatus,
);

const invoiceRoutes = new Hono().basePath("/invoices");
invoiceRoutes.use(authMiddleware);
invoiceRoutes.post("/", handleCreateInvoice);
invoiceRoutes.get("/", handleListInvoices);
invoiceRoutes.get("/:invoiceId/pdf", handleDownloadInvoicePdf);
invoiceRoutes.get("/:invoiceId", handleGetInvoiceById);
invoiceRoutes.post("/:id/pay", handlePayInvoice);

const webhookRoutes = new Hono().basePath("/webhooks");
webhookRoutes.post("/bayeu", handleBayeuWebhook);

export const app = new Hono().basePath("/kuala");
// Use custom logger that follows Hono's PrintFunc pattern
app.use(logger(customLogger));
app.use("*", corsMiddleware);
app.route("/", publicRoutes);
app.route("/", authRoutes);
app.route("/", subscriptionRoutes);
app.route("/", invoiceRoutes);
app.route("/", webhookRoutes);

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
