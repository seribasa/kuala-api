import { Hono } from "@hono/hono";
import {
	handleCreateSubscription,
	handleGetSubscription,
	handleGetSubscriptionById,
} from "../handlers/subscriptions/index.ts";
import { handleCreateEventDrivenSubscription } from "../handlers/subscriptions/create-event-driven.ts";
import { handleGetSubscriptionStatus } from "../handlers/subscriptions/status.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { validateJson, validateParam } from "../validators/core.ts";
import {
	createSubscriptionSchema,
	getSubscriptionByIdParamSchema,
	getSubscriptionStatusParamSchema,
} from "../validators/schemas.ts";

export const subscriptionRoutes = new Hono().basePath("/subscriptions");
subscriptionRoutes.use(authMiddleware);

// Deprecated endpoints for subscriptions, but still supported for backward compatibility
subscriptionRoutes.post(
	"/",
	validateJson(createSubscriptionSchema),
	handleCreateSubscription,
);

subscriptionRoutes.post(
	"/v2",
	validateJson(createSubscriptionSchema),
	handleCreateEventDrivenSubscription,
);

// "/subscriptions/event-driven" redirect to"/subscriptions/v2"
subscriptionRoutes.post(
	"/event-driven", 
	validateJson(createSubscriptionSchema),
	handleCreateEventDrivenSubscription,
)

subscriptionRoutes.get("/", handleGetSubscription);

subscriptionRoutes.get(
	"/:subscriptionId",
	validateParam(getSubscriptionByIdParamSchema),
	handleGetSubscriptionById,
);

subscriptionRoutes.get(
	"/status/:correlationId",
	validateParam(getSubscriptionStatusParamSchema),
	handleGetSubscriptionStatus,
);
