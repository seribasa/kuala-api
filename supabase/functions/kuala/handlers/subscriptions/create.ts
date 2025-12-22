import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { CreateSubscriptionRequest } from "../../../_shared/types/index.ts";
import { logger } from "../../middleware/logger.ts";
import { getUser } from "../../middleware/auth.ts";
import { killBillService } from "../../../_shared/services/killbill.ts";
/**
 * Handler for POST /subscriptions
 * Creates a subscription for the authenticated user
 * Note: Requires authMiddleware to be applied
 */
export async function handleCreateSubscription(c: Context) {
	const handlerName = "createSubscription";
	logger.info(handlerName, "Starting subscription creation");

	try {
		// 1. Get authenticated user from context (set by authMiddleware)
		const user = getUser(c);

		// 2. Parse and validate request body
		const body = await c.req.json() as CreateSubscriptionRequest;
		const { planId } = body;

		logger.info(handlerName, "Request validated", {
			userId: user.id,
			planId,
		});

		if (!planId) {
			logger.error(handlerName, "Missing planId");
			const errorResponse: ErrorResponse = {
				code: "MISSING_PLAN_ID",
				message: "planId is required",
			};
			return c.json(errorResponse, 400);
		}

		// 3. Get or create Kill Bill account
		const accountResponse = await killBillService.getOrCreateAccount(
			user.id,
			user.email || "",
		);

		// 4. Check for existing active subscription
		const { hasActive, subscription: existingSubscription } =
			await killBillService.hasActiveSubscription(
				accountResponse.account.accountId,
			);

		if (hasActive && existingSubscription) {
			logger.warn(handlerName, "User already has active subscription", {
				subscriptionId: existingSubscription.subscriptionId,
				planName: existingSubscription.planName,
			});

			const errorResponse: ErrorResponse = {
				code: "ALREADY_SUBSCRIBED",
				message: "Already subscribed to a non-cancellable plan",
			};
			return c.json(errorResponse, 409);
		}

		// 5. Create subscription in Kill Bill
		let subscriptionId: string;
		try {
			subscriptionId = await killBillService.createSubscription(
				user.id,
				accountResponse.account.accountId,
				planId,
			);
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.includes("DUPLICATE_SUBSCRIPTION")
			) {
				logger.error(
					handlerName,
					"Duplicate subscription detected",
				);
				const errorResponse: ErrorResponse = {
					code: "DUPLICATE_SUBSCRIPTION",
					message: "Subscription already exists",
				};
				return c.json(errorResponse, 409);
			}
			const errorResponse: ErrorResponse = {
				code: "SUBSCRIPTION_CREATION_FAILED",
				message: "Failed to create subscription",
			};
			return c.json(errorResponse, 500);
		}

		const baseUrl = new URL(c.req.url).origin;
		c.res.headers.set(
			"Location",
			`${baseUrl}/subscriptions/${subscriptionId}`,
		);

		return c.json(null, 201);
	} catch (error) {
		logger.error(handlerName, "Unexpected error", {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});

		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Failed to create subscription",
		};
		return c.json(errorResponse, 500);
	}
}
