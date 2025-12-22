// Event-driven subscription creation handler
import type { Context } from "@hono/hono";
import { getUser } from "../../middleware/auth.ts";
import { createSubscriptionRequestedEvent } from "../../../_shared/types/events.ts";
import { publishEvent } from "../../../_shared/rabbitmq.ts";
import { logger } from "../../middleware/logger.ts";
import type {
	BaseResponse,
	ErrorResponse,
} from "../../../_shared/types/response.ts";
import { killBillService } from "../../../_shared/services/killbill.ts";
import { subscriptionStateManager } from "../../../_shared/services/subscription-state-management.ts";

interface CreateEventDrivenSubscriptionRequest {
	planId: string;
}

interface CreateEventDrivenSubscriptionResponse {
	correlation_id: string;
	status: "processing";
	message: string;
}

export async function handleCreateEventDrivenSubscription(c: Context) {
	const handlerName = "handleCreateEventDrivenSubscription";

	try {
		// Get authenticated user from context (auth middleware already applied)
		const user = getUser(c);
		logger.info(
			handlerName,
			"Processing event-driven subscription request",
			{
				userId: user.id,
			},
		);

		// Parse request body
		const body: CreateEventDrivenSubscriptionRequest = await c.req.json();

		if (!body.planId) {
			logger.error(handlerName, "Missing planId in request");
			const errorResponse: ErrorResponse = {
				code: "MISSING_PLAN_ID",
				message: "planId is required",
			};
			return c.json(errorResponse, 400);
		}

		// Check for existing pending subscription request in state management system
		const hasPendingRequest = await subscriptionStateManager
			.hasPendingSubscriptionRequest(user.id);

		if (hasPendingRequest) {
			const latestRequest = await subscriptionStateManager
				.getLatestSubscriptionRequest(user.id);

			logger.warn(handlerName, "User has pending subscription request", {
				userId: user.id,
				currentState: latestRequest?.current_state,
				correlationId: latestRequest?.entity_id,
				lastUpdated: latestRequest?.state_updated_at,
			});

			const errorResponse: ErrorResponse = {
				code: "PENDING_SUBSCRIPTION_REQUEST",
				message:
					`You have a pending subscription request in state: ${latestRequest?.current_state}. Please wait for it to complete or contact support.`,
			};
			return c.json(errorResponse, 409);
		}

		// Check for existing active subscription
		const activeSubscription = await killBillService.getActiveSubscription(
			user.id,
		);

		if (activeSubscription) {
			logger.warn(handlerName, "User already has active subscription", {
				subscriptionId: activeSubscription.subscriptionId,
				planName: activeSubscription.planName,
			});

			const errorResponse: ErrorResponse = {
				code: "DUPLICATE_SUBSCRIPTION",
				message:
					`Subscription already exists with id: ${activeSubscription.subscriptionId}`,
			};
			return c.json(errorResponse, 409);
		}

		// Create correlation ID for tracking
		const correlationId = crypto.randomUUID();

		// Create initial state transition
		await subscriptionStateManager.transitionState(
			"subscription_request",
			correlationId,
			"requested",
			{
				triggeredBy: "api-handler",
				eventType: "SubscriptionRequested",
				reason: "User initiated subscription request via API",
				metadata: {
					userId: user.id,
					email: user.email || "",
					name: user.user_metadata?.full_name ||
						user.user_metadata?.name || "",
					planId: body.planId,
				},
			},
		);

		// Create and publish SubscriptionRequested event
		const event = createSubscriptionRequestedEvent(
			correlationId,
			user.id,
			body.planId,
			user.email || "",
			user.user_metadata?.full_name || user.user_metadata?.name || "",
		);

		logger.info(handlerName, "Publishing SubscriptionRequested event", {
			eventId: event.eventId,
			correlationId: event.correlationId,
			userId: user.id,
			planId: body.planId,
		});

		await publishEvent("subscription.requested", event);

		// Return immediate response
		const responseData: CreateEventDrivenSubscriptionResponse = {
			correlation_id: correlationId,
			status: "processing",
			message: "Subscription request is being processed",
		};

		const successResponse: BaseResponse<
			CreateEventDrivenSubscriptionResponse
		> = {
			successful: true,
			message: "Event-driven subscription request accepted",
			data: responseData,
		};

		logger.info(handlerName, "Event-driven subscription request accepted", {
			correlationId,
		});

		return c.json(successResponse, 202);
	} catch (error: unknown) {
		logger.error(handlerName, "Event-driven subscription request failed", {
			error: error instanceof Error ? error.message : String(error),
		});

		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Failed to process event-driven subscription request",
		};

		return c.json(errorResponse, 500);
	}
}
