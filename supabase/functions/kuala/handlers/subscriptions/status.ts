// Event-driven subscription status tracking handler
import type { Context } from "@hono/hono";
import { getUser } from "../../middleware/auth.ts";
import { logger } from "../../middleware/logger.ts";
import type {
	BaseResponse,
	ErrorResponse,
} from "../../../_shared/types/response.ts";
import { subscriptionStateManager } from "../../../_shared/services/subscription-state-management.ts";

interface SubscriptionStatusResponse {
	correlation_id: string;
	status: "processing" | "completed" | "failed";
	current_state: string;
	last_event?: string;
	last_updated: string;
	total_events: number;
	events: Array<{
		event_id: string;
		event_type: string;
		from_state: string | null;
		to_state: string;
		timestamp: string;
		triggered_by: string;
		reason?: string;
	}>;
}

/**
 * Get real subscription status from state management system
 */
async function getSubscriptionStatus(
	correlationId: string,
	userId: string,
): Promise<SubscriptionStatusResponse | null> {
	logger.info("getSubscriptionStatus", "Fetching subscription status", {
		correlationId,
		userId,
	});

	try {
		// Get current state
		const currentState = await subscriptionStateManager.getCurrentState(
			correlationId,
		);

		if (!currentState) {
			logger.warn(
				"getSubscriptionStatus",
				"No state found for correlation ID",
				{
					correlationId,
				},
			);
			return null;
		}

		// Get state history
		const history = await subscriptionStateManager.getHistory(
			correlationId,
		);

		// Map state to status
		let status: "processing" | "completed" | "failed";
		if (currentState.current_state === "completed") {
			status = "completed";
		} else if (currentState.current_state === "failed") {
			status = "failed";
		} else {
			status = "processing";
		}

		// Map history to events
		const events = history.map((transition) => ({
			event_id: transition.id,
			event_type: transition.event_type || transition.to_state,
			from_state: transition.from_state,
			to_state: transition.to_state,
			timestamp: transition.created_at,
			triggered_by: transition.triggered_by,
			reason: transition.transition_reason,
		}));

		return {
			correlation_id: correlationId,
			status,
			current_state: currentState.current_state,
			last_event: currentState.last_event_type,
			last_updated: currentState.state_updated_at,
			total_events: events.length,
			events,
		};
	} catch (error) {
		logger.error(
			"getSubscriptionStatus",
			"Failed to fetch status from state management",
			{
				correlationId,
				error: error instanceof Error ? error.message : String(error),
			},
		);
		throw error;
	}
}

export async function handleGetSubscriptionStatus(c: Context) {
	const handlerName = "handleGetSubscriptionStatus";

	try {
		// Get authenticated user from context
		const user = getUser(c);

		// Get correlation ID from URL params
		const correlationId = c.req.param("correlationId");

		if (!correlationId) {
			logger.error(handlerName, "Missing correlation ID in request");
			const errorResponse: ErrorResponse = {
				code: "MISSING_CORRELATION_ID",
				message: "Correlation ID is required",
			};
			return c.json(errorResponse, 400);
		}

		logger.info(handlerName, "Getting subscription status", {
			correlationId,
			userId: user.id,
		});

		// Get subscription status from state management
		const status = await getSubscriptionStatus(correlationId, user.id);

		if (!status) {
			logger.error(handlerName, "Subscription status not found", {
				correlationId,
				userId: user.id,
			});
			const errorResponse: ErrorResponse = {
				code: "SUBSCRIPTION_NOT_FOUND",
				message:
					"Subscription status not found for the given correlation ID",
			};
			return c.json(errorResponse, 404);
		}

		const successResponse: BaseResponse<SubscriptionStatusResponse> = {
			successful: true,
			message: "Subscription status retrieved successfully",
			data: status,
		};

		logger.info(handlerName, "Subscription status retrieved", {
			correlationId,
			status: status.status,
			currentState: status.current_state,
			totalEvents: status.total_events,
		});

		return c.json(successResponse, 200);
	} catch (error: unknown) {
		logger.error(handlerName, "Failed to get subscription status", {
			error: error instanceof Error ? error.message : String(error),
		});

		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Failed to retrieve subscription status",
		};

		return c.json(errorResponse, 500);
	}
}
