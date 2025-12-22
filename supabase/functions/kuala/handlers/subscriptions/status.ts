// Event-driven subscription status tracking handler
import type { Context } from "@hono/hono";
import { getUser } from "../../middleware/auth.ts";
import { logger } from "../../middleware/logger.ts";
import type {
	BaseResponse,
	ErrorResponse,
} from "../../../_shared/types/response.ts";

interface SubscriptionStatusResponse {
	correlation_id: string;
	status: "processing" | "completed" | "failed";
	last_event?: string;
	total_events: number;
	events: Array<{
		event_id: string;
		event_type: string;
		timestamp: string;
		status: string;
	}>;
}

// Mock status tracking - replace with actual Redis/database implementation
// TODO: Implement actual storage and retrieval of saga state
function getSubscriptionStatus(
	correlationId: string,
	userId: string,
): Promise<SubscriptionStatusResponse | null> {
	// In real implementation, this would query Redis or database for saga state
	// For now, return mock data based on correlation ID

	logger.info("getSubscriptionStatus", "Fetching subscription status", {
		correlationId,
		userId,
	});

	// Simulate different states based on correlation ID patterns
	const statusStates = ["processing", "completed", "failed"] as const;
	const randomState =
		statusStates[Math.floor(Math.random() * statusStates.length)];

	const mockEvents = [
		{
			event_id: crypto.randomUUID(),
			event_type: "SubscriptionRequested",
			timestamp: new Date().toISOString(),
			status: "completed",
		},
		{
			event_id: crypto.randomUUID(),
			event_type: "AccountReady",
			timestamp: new Date().toISOString(),
			status: randomState === "processing" ? "processing" : "completed",
		},
	];

	if (randomState === "completed") {
		mockEvents.push(
			{
				event_id: crypto.randomUUID(),
				event_type: "SubscriptionCreated",
				timestamp: new Date().toISOString(),
				status: "completed",
			},
			{
				event_id: crypto.randomUUID(),
				event_type: "InvoiceGenerated",
				timestamp: new Date().toISOString(),
				status: "completed",
			},
		);
	}

	return Promise.resolve({
		correlation_id: correlationId,
		status: randomState,
		last_event: mockEvents[mockEvents.length - 1]?.event_type,
		total_events: mockEvents.length,
		events: mockEvents,
	});
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

		// Get subscription status
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
