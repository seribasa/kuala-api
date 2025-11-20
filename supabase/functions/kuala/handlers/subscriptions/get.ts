import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { authLogger } from "../../middleware/logger.ts";
import { getUser } from "../../middleware/auth.ts";
import { killBillService } from "../../services/killbill.ts";
import { mapKillBillSubscriptionToSubscription } from "../../utils/subscription-mapper.ts";

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
		const activeSubscription = await killBillService.getActiveSubscription(
			account.accountId,
		);
		if (!activeSubscription) {
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
			subscriptionId: activeSubscription.subscriptionId?.substring(0, 8) +
				"...",
			planName: activeSubscription.planName,
			state: activeSubscription.state,
		});

		// Map Kill Bill subscription to our format
		const subscription = mapKillBillSubscriptionToSubscription(
			activeSubscription,
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
