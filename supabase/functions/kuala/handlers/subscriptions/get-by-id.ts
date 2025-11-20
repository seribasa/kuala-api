import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { authLogger } from "../../middleware/logger.ts";
import {
KillBillAccount,
	KillBillSubscription,
	Subscription,
} from "../../../_shared/types/index.ts";
import { getUser } from "../../middleware/auth.ts";
import { killBillConfig as getKillBillConfig } from "../../../_shared/config/killbill-config.ts";

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

		// Get Kill Bill configuration
		const killBillConfig = getKillBillConfig();

		// Get specific subscription from Kill Bill
		const subscriptionUrl = new URL(
			`/1.0/kb/subscriptions/${subscriptionId}`,
			killBillConfig.baseUrl,
		);

		authLogger.apiCall(
			handlerName,
			"Fetching subscription from Kill Bill",
			{
				url: subscriptionUrl.toString(),
				subscriptionId: subscriptionId.substring(0, 8) + "...",
			},
		);

		const subscriptionResponse = await fetch(subscriptionUrl.toString(), {
			method: "GET",
			headers: {
				"X-Killbill-ApiKey": killBillConfig.apiKey,
				"X-Killbill-ApiSecret": killBillConfig.apiSecret,
				"X-Killbill-CreatedBy": "kuala-api",
				"Content-Type": "application/json",
			},
		});

		authLogger.apiCall(handlerName, "Kill Bill subscription response", {
			status: subscriptionResponse.status,
			isOk: subscriptionResponse.ok,
		});

		if (!subscriptionResponse.ok) {
			if (subscriptionResponse.status === 404) {
				authLogger.success(handlerName, "Subscription not found", {
					subscriptionId: subscriptionId.substring(0, 8) + "...",
				});
				const errorResponse: ErrorResponse = {
					code: "SUBSCRIPTION_NOT_FOUND",
					message: "Subscription not found",
				};
				return c.json(errorResponse, 404);
			}

			authLogger.error(
				handlerName,
				"Kill Bill subscription fetch failed",
				{
					status: subscriptionResponse.status,
					statusText: subscriptionResponse.statusText,
				},
			);
			const errorResponse: ErrorResponse = {
				code: "KILLBILL_ERROR",
				message: "Failed to fetch subscription",
			};
			return c.json(errorResponse, 500);
		}

		const killBillSubscription: KillBillSubscription =
			await subscriptionResponse.json();

		authLogger.validation(handlerName, "Subscription fetched", {
			subscriptionId:
				killBillSubscription.subscriptionId?.substring(0, 8) + "...",
			accountId: killBillSubscription.accountId?.substring(0, 8) + "...",
			planName: killBillSubscription.planName,
			state: killBillSubscription.state,
		});

		// Verify that this subscription belongs to the authenticated user
		// We need to check if the account ID from the subscription matches the user's account
		const getAccountUrl = new URL(
			`/1.0/kb/accounts?externalKey=${userId}&accountWithBalance=false&accountWithBalanceAndCBA=false`,
			killBillConfig.baseUrl,
		);
		const credentials = btoa(
			`${killBillConfig.username}:${killBillConfig.password}`,
		);

		authLogger.apiCall(handlerName, "Verifying user account ownership", {
			url: getAccountUrl.toString(),
			userId: userId.substring(0, 8) + "...",
		});
		const accountResponse = await fetch(getAccountUrl.toString(), {
			method: "GET",
			headers: {
				"Authorization": `Basic ${credentials}`,
				"X-Killbill-ApiKey": killBillConfig.apiKey,
				"X-Killbill-ApiSecret": killBillConfig.apiSecret,
				"X-Killbill-CreatedBy": "kuala-api",
				"Content-Type": "application/json",
			},
		});

		authLogger.apiCall(handlerName, "Kill Bill account search response", {
			status: accountResponse.status,
			isOk: accountResponse.ok,
		});

		if (!accountResponse.ok) {
			authLogger.error(handlerName, "Failed to verify user account", {
				status: accountResponse.status,
				statusText: accountResponse.statusText,
			});
			const errorResponse: ErrorResponse = {
				code: "KILLBILL_ERROR",
				message: "Failed to verify user access to subscription",
			};
			return c.json(errorResponse, 500);
		}

		const account: KillBillAccount = await accountResponse.json();
		if (
			!account ||
			account.accountId !== killBillSubscription.accountId
		) {
			authLogger.error(
				handlerName,
				"User does not own this subscription",
				{
					userId: userId.substring(0, 8) + "...",
					userAccountId: account?.accountId?.substring(0, 8) +
						"...",
					subscriptionAccountId:
						killBillSubscription.accountId?.substring(0, 8) + "...",
				},
			);
			const errorResponse: ErrorResponse = {
				code: "SUBSCRIPTION_NOT_FOUND",
				message: "Subscription not found",
			};
			return c.json(errorResponse, 404);
		}

		// Map Kill Bill subscription to our format
		const subscription: Subscription = {
			id: killBillSubscription.subscriptionId,
			userId: userId,
			planId: killBillSubscription.planName || "unknown",
			interval: killBillSubscription.billingPeriod === "ANNUAL"
				? "year"
				: "month",
			status: mapKillBillStatus(killBillSubscription.state),
			startDate: killBillSubscription.startDate,
			currentPeriodStart: killBillSubscription.chargedThroughDate ||
				killBillSubscription.startDate,
			currentPeriodEnd: killBillSubscription.billingEndDate ||
				killBillSubscription.chargedThroughDate ||
				killBillSubscription.startDate,
			billing: {
				accountId: killBillSubscription.accountId,
				subscriptionId: killBillSubscription.subscriptionId,
				bundleId: killBillSubscription.bundleId,
			},
		};

		authLogger.success(handlerName, "Subscription retrieved successfully", {
			subscriptionId: subscription.id.substring(0, 8) + "...",
			planId: subscription.planId,
			status: subscription.status,
			userId: userId.substring(0, 8) + "...",
		});

		return c.json(subscription, 200);
	} catch (error) {
		authLogger.exception(handlerName, error as Error);
		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Internal server error",
		};
		return c.json(errorResponse, 500);
	}
};

/**
 * Map Kill Bill subscription status to our status
 */
function mapKillBillStatus(killBillStatus: string): Subscription["status"] {
	switch (killBillStatus?.toUpperCase()) {
		case "ACTIVE":
			return "active";
		case "TRIAL":
			return "trialing";
		case "PAUSED":
			return "paused";
		case "CANCELLED":
			return "canceled";
		case "PAST_DUE":
			return "past_due";
		default:
			return "active"; // Default fallback
	}
}
