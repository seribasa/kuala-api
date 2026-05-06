import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { authLogger, logger } from "../../middleware/logger.ts";
import { getUser } from "../../middleware/auth.ts";
import { killBillService } from "@shared/services/killbill.ts";
import { subscriptionStateManager } from "../../../_shared/services/subscription-state-management.ts";

interface SubscriptionAccountInfo {
	name: string;
	email: string;
	currency: string;
}

interface SubscriptionItem {
	id: string;
	bundleId: string;
	accountId: string;
	userId: string;
	planName: string;
	productName: string;
	billingPeriod: string;
	state: string;
	billingStartDate: string;
	billingEndDate: string | null;
	chargedThroughDate: string;
	account: SubscriptionAccountInfo;
}

interface GetSubscriptionsResponse {
	subscriptions: SubscriptionItem[];
	message?: string;
}

/**
 * Get subscriptions for current authenticated user
 * GET /subscriptions
 *
 * Returns all subscriptions with account enrichment.
 * If the user has a pending subscription request (saga in progress),
 * returns 409 with correlation info so the client can poll status.
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

		const returnMessage = "Subscriptions retrieved successfully";
		const subscriptions: SubscriptionItem[] = [];

		// Get user's Kill Bill account
		let account;
		try {
			account = await killBillService.getAccountByExternalKey(userId);
		} catch (error) {
			logger.error(
				handlerName,
				"Failed to fetch Kill Bill account",
				{
					userId,
					error: error instanceof Error
						? error.message
						: String(error),
				},
			);
			const errorResponse: ErrorResponse = {
				code: "UPSTREAM_ERROR",
				message:
					"Failed to fetch subscription account. Please try again later.",
			};
			return c.json(errorResponse, 502);
		}

		if (!account) {
			authLogger.success(handlerName, "No account found for user", {
				userId: userId.substring(0, 8) + "...",
			});
			const response: GetSubscriptionsResponse = {
				subscriptions: [],
				message: "No subscription account found for this user.",
			};
			return c.json(response, 200);
		}

		authLogger.validation(handlerName, "Account found", {
			accountId: account.accountId.substring(0, 8) + "...",
		});

		// Get subscription for this account
		try {
			const kbSubscription = await killBillService
				.getSubscriptionByExternalId(userId);

			if (kbSubscription) {
				authLogger.validation(
					handlerName,
					"Active subscription found",
					{
						subscriptionId:
							kbSubscription.subscriptionId?.substring(0, 8) +
							"...",
						planName: kbSubscription.planName,
						state: kbSubscription.state,
					},
				);

				subscriptions.push({
					id: kbSubscription.subscriptionId,
					bundleId: kbSubscription.bundleId,
					accountId: account.accountId,
					userId: userId,
					planName: kbSubscription.planName,
					productName: kbSubscription.productName,
					billingPeriod: kbSubscription.billingPeriod,
					state: kbSubscription.state,
					billingStartDate: kbSubscription.billingStartDate,
					billingEndDate: kbSubscription.billingEndDate || null,
					chargedThroughDate: kbSubscription.chargedThroughDate,
					account: {
						name: account.name,
						email: account.email,
						currency: account.currency,
					},
				});
			}
		} catch (error) {
			logger.error(
				handlerName,
				"Failed to fetch subscription details",
				{
					accountId: account.accountId,
					error: error instanceof Error
						? error.message
						: String(error),
				},
			);
			const errorResponse: ErrorResponse = {
				code: "UPSTREAM_ERROR",
				message:
					"Failed to fetch subscription details. Please try again later.",
			};
			return c.json(errorResponse, 502);
		}

		authLogger.success(
			handlerName,
			"Subscriptions retrieved successfully",
			{
				count: subscriptions.length,
				message: returnMessage,
			},
		);

		const response: GetSubscriptionsResponse = {
			subscriptions,
			message: returnMessage,
		};
		return c.json(response, 200);
	} catch (error) {
		authLogger.exception(handlerName, error as Error);

		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Internal server error",
		};
		return c.json(errorResponse, 500);
	}
};
