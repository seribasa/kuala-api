import {
	KillBillSubscription,
	Subscription,
} from "../../_shared/types/index.ts";

/**
 * Map Kill Bill subscription status to our API status
 */
export function mapKillBillStatus(
	killBillStatus: string,
): Subscription["status"] {
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

/**
 * Map Kill Bill subscription to our API format
 */
export function mapKillBillSubscriptionToSubscription(
	killBillSubscription: KillBillSubscription,
	userId: string,
	accountId?: string,
): Subscription {
	return {
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
			accountId: accountId || killBillSubscription.accountId,
			subscriptionId: killBillSubscription.subscriptionId,
			bundleId: killBillSubscription.bundleId,
		},
	};
}
