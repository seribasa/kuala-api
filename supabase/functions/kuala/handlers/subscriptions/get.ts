import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { authLogger, logger } from "../../middleware/logger.ts";
import { getUser } from "../../middleware/auth.ts";
import { mapKillBillSubscriptionToSubscription } from "../../utils/subscription-mapper.ts";
import { killBillService } from "../../../_shared/services/killbill.ts";
import { subscriptionStateManager } from "../../../_shared/services/subscription-state-management.ts";

/**
 * Get subscription for current authenticated user
 * GET /subscriptions
 */
export const handleGetSubscription = async (c: Context) => {
	const handlerName = "get-subscription";
	authLogger.start(handlerName);

	try {
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

		// Get user's Kill Bill account
		const account = await killBillService.getAccountByExternalKey(userId);
		if (!account) {
			authLogger.success(handlerName, "No account found for user", {
				userId: userId.substring(0, 8) + "...",
			});
			const errorResponse: ErrorResponse = {
				code: "SUBSCRIPTION_NOT_FOUND",
				message: "No subscription found for this user",
			};
			return c.json(errorResponse, 404);
		}

		authLogger.validation(handlerName, "Account found", {
			accountId: account.accountId.substring(0, 8) + "...",
		});

		// Get active subscription for this account
		const kbSubscription = await killBillService
			.getSubscriptionByExternalId(
				userId,
			);
		if (!kbSubscription) {
			authLogger.success(handlerName, "No active subscription found", {
				accountId: account.accountId.substring(0, 8) + "...",
			});
			const errorResponse: ErrorResponse = {
				code: "SUBSCRIPTION_NOT_FOUND",
				message: "No active subscription found for this user",
			};
			return c.json(errorResponse, 404);
		}

		authLogger.validation(handlerName, "Active subscription found", {
			subscriptionId: kbSubscription.subscriptionId?.substring(0, 8) +
				"...",
			planName: kbSubscription.planName,
			state: kbSubscription.state,
		});

		// Map Kill Bill subscription to our format
		const subscription = mapKillBillSubscriptionToSubscription(
			kbSubscription,
			userId,
			account.accountId,
		);

		authLogger.success(handlerName, "Subscription retrieved successfully", {
			subscriptionId: subscription.id.substring(0, 8) + "...",
			planId: subscription.planId,
			status: subscription.status,
		});

		return c.json(subscription, 200);
	} catch (error) {
		authLogger.exception(handlerName, error as Error);

		// Handle specific Kill Bill errors
		if (error instanceof Error) {
			if (error.message === "SUBSCRIPTION_NOT_FOUND") {
				const errorResponse: ErrorResponse = {
					code: "SUBSCRIPTION_NOT_FOUND",
					message: "No subscription found for this user",
				};
				return c.json(errorResponse, 404);
			}

			if (error.message.includes("Failed to get")) {
				const errorResponse: ErrorResponse = {
					code: "KILLBILL_ERROR",
					message: "Failed to fetch subscription data",
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
