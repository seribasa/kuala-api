import { Hono } from "@hono/hono";
import {
	handleCreateSubscription,
	handleGetSubscription,
	handleGetSubscriptionById,
} from "../handlers/subscriptions/index.ts";
import { handleCreateEventDrivenSubscription } from "../handlers/subscriptions/create-event-driven.ts";
import { handleGetSubscriptionStatus } from "../handlers/subscriptions/status.ts";
import { authMiddleware } from "../middleware/auth.ts";

export const subscriptionRoutes = new Hono().basePath("/subscriptions");
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
