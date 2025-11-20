import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { authLogger } from "../../middleware/logger.ts";
import { KillBillAccount, KillBillSubscription, Subscription } from "../../../_shared/types/index.ts";
import { getUser } from "../../middleware/auth.ts";
import { killBillConfig as getKillBillConfig } from "../../../_shared/config/killbill-config.ts";

/**
 * Get subscription for current authenticated user
 * GET /subscriptions
 */
export const handleGetSubscription = async (c: Context) => {
	const handlerName = "get-subscription";
	authLogger.start(handlerName);

	try {
		// Get Authorization header
		const user = getUser(c);
		const userId = user.id;

		authLogger.validation(handlerName, "Authenticated user", {
			userId: userId.substring(0, 8) + "...",
		});

		// Get Kill Bill configuration
		const killBillConfig = getKillBillConfig();

		// Find Kill Bill account for this user
		const getAccountUrl = new URL(
			`/1.0/kb/accounts?externalKey=${userId}&accountWithBalance=false&accountWithBalanceAndCBA=false`,
			killBillConfig.baseUrl,
		);
		const credentials = btoa(
			`${killBillConfig.username}:${killBillConfig.password}`,
		);

		authLogger.apiCall(handlerName, "Searching Kill Bill account", {
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
			if (accountResponse.status === 404) {
				// No account found, which means no subscription
				authLogger.success(
					handlerName,
					"No subscription found for user",
					{
						userId: userId.substring(0, 8) + "...",
					},
				);
				const errorResponse: ErrorResponse = {
					code: "SUBSCRIPTION_NOT_FOUND",
					message: "No subscription found for this user",
				};
				return c.json(errorResponse, 404);
			}

			authLogger.error(handlerName, "Kill Bill account search failed", {
				status: accountResponse.status,
				statusText: accountResponse.statusText,
			});
			const errorResponse: ErrorResponse = {
				code: "KILLBILL_ERROR",
				message: "Failed to search for user account",
			};
			return c.json(errorResponse, 500);
		}

		const account: KillBillAccount = await accountResponse.json();

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
		const accountId = account.accountId;

		authLogger.validation(handlerName, "Account found", {
			accountId: accountId.substring(0, 8) + "...",
			hasAccount: !!account,
		});

		// Get subscriptions for this account
		const subscriptionsUrl = new URL(
			`/1.0/kb/accounts/${accountId}/subscriptions`,
			killBillConfig.baseUrl,
		);

		authLogger.apiCall(handlerName, "Fetching subscriptions", {
			url: subscriptionsUrl.toString(),
			accountId: accountId.substring(0, 8) + "...",
		});

		const subscriptionsResponse = await fetch(subscriptionsUrl.toString(), {
			method: "GET",
			headers: {
				"X-Killbill-ApiKey": killBillConfig.apiKey,
				"X-Killbill-ApiSecret": killBillConfig.apiSecret,
				"X-Killbill-CreatedBy": "kuala-api",
				"Content-Type": "application/json",
			},
		});

		authLogger.apiCall(handlerName, "Kill Bill subscriptions response", {
			status: subscriptionsResponse.status,
			isOk: subscriptionsResponse.ok,
		});

		if (!subscriptionsResponse.ok) {
			authLogger.error(handlerName, "Failed to fetch subscriptions", {
				status: subscriptionsResponse.status,
				statusText: subscriptionsResponse.statusText,
			});
			const errorResponse: ErrorResponse = {
				code: "KILLBILL_ERROR",
				message: "Failed to fetch subscriptions",
			};
			return c.json(errorResponse, 500);
		}

		const killBillSubscriptions = await subscriptionsResponse.json();

		if (!killBillSubscriptions || killBillSubscriptions.length === 0) {
			authLogger.success(handlerName, "No active subscriptions found", {
				accountId: accountId.substring(0, 8) + "...",
			});
			const errorResponse: ErrorResponse = {
				code: "SUBSCRIPTION_NOT_FOUND",
				message: "No subscription found for this user",
			};
			return c.json(errorResponse, 404);
		}

		// Get the most recent active subscription
		const activeSubscription = killBillSubscriptions
			.filter((sub: KillBillSubscription) => sub.state === "ACTIVE")
			.sort((a: KillBillSubscription, b: KillBillSubscription) =>
				new Date(b.startDate).getTime() -
				new Date(a.startDate).getTime()
			)[0];

		if (!activeSubscription) {
			authLogger.success(handlerName, "No active subscriptions found", {
				accountId: accountId.substring(0, 8) + "...",
				totalSubscriptions: killBillSubscriptions.length,
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
		const subscription: Subscription = {
			id: activeSubscription.subscriptionId,
			userId: userId,
			planId: activeSubscription.planName || "unknown",
			interval: activeSubscription.billingPeriod === "ANNUAL"
				? "year"
				: "month",
			status: mapKillBillStatus(activeSubscription.state),
			startDate: activeSubscription.startDate,
			currentPeriodStart: activeSubscription.chargedThroughDate ||
				activeSubscription.startDate,
			currentPeriodEnd: activeSubscription.billingEndDate ||
				activeSubscription.chargedThroughDate ||
				activeSubscription.startDate,
			billing: {
				accountId: accountId,
				subscriptionId: activeSubscription.subscriptionId,
				bundleId: activeSubscription.bundleId,
			},
		};

		authLogger.success(handlerName, "Subscription retrieved successfully", {
			subscriptionId: subscription.id.substring(0, 8) + "...",
			planId: subscription.planId,
			status: subscription.status,
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
