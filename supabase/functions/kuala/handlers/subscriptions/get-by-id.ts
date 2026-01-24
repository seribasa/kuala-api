import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { authLogger, logger } from "../../middleware/logger.ts";
import { getUser } from "../../middleware/auth.ts";
import { mapKillBillSubscriptionToSubscription } from "../../utils/subscription-mapper.ts";
import { killBillService } from "@shared/services/killbill.ts";
import { subscriptionStateManager } from "../../../_shared/services/subscription-state-management.ts";

/**
 * Get subscription by ID
 * GET /subscriptions/{subscriptionId}
 */
export const handleGetSubscriptionById = async (c: Context) => {
	const handlerName = "get-subscription-by-id";
	authLogger.start(handlerName);

	try {
		// Get Authorization header
		const authorization = c.req.header("Authorization");
		const subscriptionId = c.req.param("subscriptionId");

		authLogger.validation(handlerName, "Request validation", {
			hasAuthorization: !!authorization,
			hasSubscriptionId: !!subscriptionId,
			subscriptionId: subscriptionId?.substring(0, 8) + "...",
		});

		if (!subscriptionId) {
			authLogger.error(handlerName, "Missing subscription ID parameter");
			const errorResponse: ErrorResponse = {
				code: "MISSING_SUBSCRIPTION_ID",
				message: "Subscription ID is required",
			};
			return c.json(errorResponse, 400);
		}

		// Get authenticated user from context (set by authMiddleware)
		const user = getUser(c);
		const userId = user.id;

		authLogger.validation(handlerName, "Authenticated user", {
			userId: userId.substring(0, 8) + "...",
		});

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

		// Get subscription from Kill Bill and verify ownership
		const isOwner = await killBillService.verifySubscriptionOwnership(
			subscriptionId,
			userId,
		);
		if (!isOwner) {
			authLogger.error(
				handlerName,
				"User does not own this subscription",
				{
					userId: userId.substring(0, 8) + "...",
					subscriptionId: subscriptionId.substring(0, 8) + "...",
				},
			);
			const errorResponse: ErrorResponse = {
				code: "SUBSCRIPTION_NOT_FOUND",
				message: "Subscription not found",
			};
			return c.json(errorResponse, 404);
		}

		// Get the subscription details
		const killBillSubscription = await killBillService.getSubscriptionById(
			subscriptionId,
		);

		authLogger.validation(handlerName, "Subscription fetched", {
			subscriptionId:
				killBillSubscription.subscriptionId?.substring(0, 8) + "...",
			accountId: killBillSubscription.accountId?.substring(0, 8) + "...",
			planName: killBillSubscription.planName,
			state: killBillSubscription.state,
		});

		// Map Kill Bill subscription to our format
		const subscription = mapKillBillSubscriptionToSubscription(
			killBillSubscription,
			userId,
		);

		authLogger.success(handlerName, "Subscription retrieved successfully", {
			subscriptionId: subscription.id.substring(0, 8) + "...",
			planId: subscription.planId,
			status: subscription.status,
			userId: userId.substring(0, 8) + "...",
		});

		return c.json(subscription, 200);
	} catch (error) {
		authLogger.exception(handlerName, error as Error);

		// Handle specific Kill Bill errors
		if (error instanceof Error) {
			if (error.message === "SUBSCRIPTION_NOT_FOUND") {
				const errorResponse: ErrorResponse = {
					code: "SUBSCRIPTION_NOT_FOUND",
					message: "Subscription not found",
				};
				return c.json(errorResponse, 404);
			}

			if (error.message.includes("Failed to get")) {
				const errorResponse: ErrorResponse = {
					code: "KILLBILL_ERROR",
					message: "Failed to fetch subscription",
				};
				return c.json(errorResponse, 500);
			}
		}

		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Internal server error",
		};
		return c.json(errorResponse, 500);
	}
};
