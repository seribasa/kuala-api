// Event-driven subscription status tracking handler
import type { Context } from "@hono/hono";
import { getUser } from "../../middleware/auth.ts";
import { logger } from "../../middleware/logger.ts";
import type {
	BaseResponse,
	ErrorResponse,
} from "../../../_shared/types/response.ts";
import { subscriptionStateManager } from "../../../_shared/services/subscription-state-management.ts";

// Ordered steps in the subscription saga
const SAGA_STEPS = [
	"requested",
	"account_ready",
	"creating_subscription",
	"subscription_created",
	"generating_invoice",
	"completed",
] as const;

const TOTAL_STEPS = 4; // The 4 user-facing milestones

// Map internal state to user-facing step number (1-based)
function getCompletedSteps(state: string): number {
	switch (state) {
		case "requested":
			return 0;
		case "account_ready":
			return 1;
		case "creating_subscription":
			return 1;
		case "subscription_created":
			return 2;
		case "generating_invoice":
			return 3;
		case "completed":
			return 4;
		case "failed":
			return 0; // failed doesn't have a meaningful step count
		default:
			return 0;
	}
}

// Map state to human-readable message
function getStatusMessage(state: string): string {
	switch (state) {
		case "requested":
			return "Subscription request received. Setting up your account...";
		case "account_ready":
			return "Account is ready. Creating your subscription...";
		case "creating_subscription":
			return "Creating your subscription in the billing system...";
		case "subscription_created":
			return "Subscription created. Generating invoice...";
		case "generating_invoice":
			return "Generating your first invoice...";
		case "completed":
			return "Subscription setup completed successfully!";
		case "failed":
			return "Subscription setup failed. Please contact support or try again.";
		default:
			return "Processing your subscription request...";
	}
}

interface SubscriptionStatusResponse {
	correlation_id: string;
	status: "processing" | "completed" | "failed";
	current_state: string;
	message: string;
	progress: {
		totalSteps: number;
		completedSteps: number;
		percentage: number;
	};
	events: Array<{
		event_id: string;
		event_type: string;
		from_state: string | null;
		to_state: string;
		timestamp: string;
		triggered_by: string;
		reason?: string;
	}>;
	data: {
		accountId?: string;
		subscriptionId?: string;
		invoiceId?: string;
	};
}

/**
 * Extract saga data (accountId, subscriptionId, invoiceId) from transition history metadata.
 */
// deno-lint-ignore no-explicit-any
function extractSagaData(transitions: any[]): {
	accountId?: string;
	subscriptionId?: string;
	invoiceId?: string;
} {
	const data: {
		accountId?: string;
		subscriptionId?: string;
		invoiceId?: string;
	} = {};

	for (const t of transitions) {
		const meta = t.metadata;
		if (!meta) continue;
		if (meta.accountId) data.accountId = meta.accountId;
		if (meta.subscriptionId) data.subscriptionId = meta.subscriptionId;
		if (meta.invoiceId) data.invoiceId = meta.invoiceId;
	}

	return data;
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

		// Authorization check: verify the saga belongs to the requesting user
		// The userId is stored in last_metadata when the saga is created
		const history = await subscriptionStateManager.getHistory(
			correlationId,
		);

		// Check ownership from the first transition's metadata
		if (history.length > 0) {
			const firstTransition = history[0];
			const sagaUserId = firstTransition.metadata?.userId;
			if (sagaUserId && sagaUserId !== userId) {
				logger.warn(
					"getSubscriptionStatus",
					"User attempting to access another user's saga",
					{
						correlationId,
						requestUserId: userId,
						sagaUserId,
					},
				);
				return null; // Return null so it appears as 404 (don't leak existence)
			}
		}

		// Map state to status
		let status: "processing" | "completed" | "failed";
		if (currentState.current_state === "completed") {
			status = "completed";
		} else if (currentState.current_state === "failed") {
			status = "failed";
		} else {
			status = "processing";
		}

		// Calculate progress
		const completedSteps = getCompletedSteps(currentState.current_state);
		const percentage = Math.round((completedSteps / TOTAL_STEPS) * 100);

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

		// Extract data from saga transitions
		const sagaData = extractSagaData(history);

		return {
			correlation_id: correlationId,
			status,
			current_state: currentState.current_state,
			message: getStatusMessage(currentState.current_state),
			progress: {
				totalSteps: TOTAL_STEPS,
				completedSteps,
				percentage,
			},
			events,
			data: sagaData,
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

		// Get subscription status from state management (includes auth check)
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
			progress: status.progress.percentage,
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
