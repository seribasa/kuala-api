// Event-driven subscription creation handler with comprehensive error handling
import type { Context } from "@hono/hono";
import { getUser } from "../../middleware/auth.ts";
import { createSubscriptionRequestedEvent } from "../../../_shared/types/events.ts";
import { publishEvent } from "../../../_shared/rabbitmq.ts";
import { logger } from "../../middleware/logger.ts";
import type {
	BaseResponse,
	ErrorResponse,
} from "../../../_shared/types/response.ts";
import { killBillService } from "@shared/services/killbill.ts";
import { subscriptionStateManager } from "../../../_shared/services/subscription-state-management.ts";
import {
	classifyError,
	ErrorCodes,
	getErrorCode,
	withRetry,
} from "../../../_shared/errors/index.ts";

interface CreateEventDrivenSubscriptionRequest {
	planId: string;
}

interface CreateEventDrivenSubscriptionResponse {
	correlation_id: string;
	status: "processing" | "failed";
	message: string;
}

interface CreateEventDrivenSubscriptionErrorResponse extends ErrorResponse {
	correlation_id?: string;
}

export async function handleCreateEventDrivenSubscription(c: Context) {
	const handlerName = "handleCreateEventDrivenSubscription";
	let correlationId: string | undefined;

	try {
		// Get authenticated user from context (auth middleware already applied)
		const user = getUser(c);
		logger.info(
			handlerName,
			"Processing event-driven subscription request",
			{
				userId: user.id,
			},
		);

		// Parse request body with validation
		let body: CreateEventDrivenSubscriptionRequest;
		try {
			body = await c.req.json();
		} catch (_parseError) {
			logger.error(handlerName, "Invalid JSON in request body");
			const errorResponse: CreateEventDrivenSubscriptionErrorResponse = {
				code: ErrorCodes.INVALID_EVENT_STRUCTURE,
				message: "Invalid JSON in request body",
			};
			return c.json(errorResponse, 400);
		}

		if (!body.planId) {
			logger.error(handlerName, "Missing planId in request");
			const errorResponse: CreateEventDrivenSubscriptionErrorResponse = {
				code: ErrorCodes.MISSING_PLAN_ID,
				message: "planId is required",
			};
			return c.json(errorResponse, 400);
		}

		// Validate planId format (basic validation)
		if (
			typeof body.planId !== "string" || body.planId.trim().length === 0
		) {
			logger.error(handlerName, "Invalid planId format");
			const errorResponse: CreateEventDrivenSubscriptionErrorResponse = {
				code: ErrorCodes.MISSING_PLAN_ID,
				message: "planId must be a non-empty string",
			};
			return c.json(errorResponse, 400);
		}

		// Check for existing pending subscription request using database lock table
		// This is more reliable than querying state as it uses atomic operations
		const existingRequest = await subscriptionStateManager.getActiveRequest(
			user.id,
		);

		if (existingRequest) {
			const latestRequest = await subscriptionStateManager
				.getLatestSubscriptionRequest(user.id);

			logger.warn(handlerName, "User has pending subscription request", {
				userId: user.id,
				currentState: latestRequest?.current_state,
				correlationId: existingRequest.correlation_id,
				lastUpdated: existingRequest.created_at,
			});

			const errorResponse: CreateEventDrivenSubscriptionErrorResponse = {
				code: ErrorCodes.PENDING_SUBSCRIPTION_REQUEST,
				message: `You have a pending subscription request in state: ${
					latestRequest?.current_state || "processing"
				}. Please wait for it to complete or contact support.`,
				correlation_id: existingRequest.correlation_id,
			};
			return c.json(errorResponse, 409);
		}

		// Check for existing active subscription with retry for transient errors
		let activeSubscription;
		try {
			activeSubscription = await withRetry(
				() => killBillService.getActiveSubscription(user.id),
				{
					maxRetries: 2,
					baseDelayMs: 500,
					onRetry: (error, attempt, delay) => {
						logger.warn(
							handlerName,
							`Retrying getActiveSubscription (attempt ${attempt})`,
							{ delay, error: String(error) },
						);
					},
				},
			);
		} catch (error) {
			const errorClassification = classifyError(error);
			logger.error(
				handlerName,
				"Failed to check for active subscription",
				{
					error: error instanceof Error
						? error.message
						: String(error),
					errorCode: errorClassification.code,
				},
			);

			// If it's a transient error, ask user to retry
			if (errorClassification.retryable) {
				const errorResponse:
					CreateEventDrivenSubscriptionErrorResponse = {
						code: errorClassification.code,
						message:
							"Unable to verify subscription status. Please try again.",
						details: error instanceof Error
							? error.message
							: undefined,
					};
				return c.json(errorResponse, 503);
			}

			throw error;
		}

		if (activeSubscription) {
			logger.warn(handlerName, "User already has active subscription", {
				subscriptionId: activeSubscription.subscriptionId,
				planName: activeSubscription.planName,
			});

			const errorResponse: CreateEventDrivenSubscriptionErrorResponse = {
				code: ErrorCodes.DUPLICATE_SUBSCRIPTION,
				message:
					`Subscription already exists with id: ${activeSubscription.subscriptionId}`,
			};
			return c.json(errorResponse, 409);
		}

		// Create correlation ID for tracking
		correlationId = crypto.randomUUID();

		// Acquire database lock to ensure only 1 user can have 1 active subscription request
		// This is an atomic operation that prevents race conditions
		const lockAcquired = await subscriptionStateManager.acquireUserLock(
			user.id,
			correlationId,
		);

		if (!lockAcquired) {
			// Another request acquired the lock between our check and now (race condition)
			logger.warn(
				handlerName,
				"Failed to acquire subscription lock (race condition)",
				{
					userId: user.id,
					correlationId,
				},
			);

			const errorResponse: CreateEventDrivenSubscriptionErrorResponse = {
				code: ErrorCodes.PENDING_SUBSCRIPTION_REQUEST,
				message:
					"You already have a pending subscription request. Please wait for it to complete or contact support.",
			};
			return c.json(errorResponse, 409);
		}

		// Create initial state transition with retry
		try {
			await withRetry(
				() =>
					subscriptionStateManager.transitionState(
						"subscription_request",
						correlationId!,
						"requested",
						{
							triggeredBy: "api-handler",
							eventType: "SubscriptionRequested",
							reason:
								"User initiated subscription request via API",
							metadata: {
								userId: user.id,
								email: user.email || "",
								name: user.user_metadata?.full_name ||
									user.user_metadata?.name || "",
								planId: body.planId,
							},
						},
					),
				{
					maxRetries: 2,
					baseDelayMs: 500,
					onRetry: (error, attempt, delay) => {
						logger.warn(
							handlerName,
							`Retrying state transition (attempt ${attempt})`,
							{ correlationId, delay, error: String(error) },
						);
					},
				},
			);
		} catch (error) {
			logger.error(handlerName, "Failed to create initial state", {
				correlationId,
				error: error instanceof Error ? error.message : String(error),
			});

			const errorResponse: CreateEventDrivenSubscriptionErrorResponse = {
				code: ErrorCodes.STATE_TRANSITION_FAILED,
				message: "Failed to initialize subscription request",
				correlation_id: correlationId,
			};
			return c.json(errorResponse, 500);
		}

		// Create and publish SubscriptionRequested event with retry
		const event = createSubscriptionRequestedEvent(
			correlationId,
			user.id,
			body.planId,
			user.email || "",
			user.user_metadata?.full_name || user.user_metadata?.name || "",
		);

		logger.info(handlerName, "Publishing SubscriptionRequested event", {
			eventId: event.eventId,
			correlationId: event.correlationId,
			userId: user.id,
			planId: body.planId,
		});

		try {
			await withRetry(
				() => publishEvent("subscription.requested", event),
				{
					maxRetries: 3,
					baseDelayMs: 1000,
					onRetry: (error, attempt, delay) => {
						logger.warn(
							handlerName,
							`Retrying event publish (attempt ${attempt})`,
							{ correlationId, delay, error: String(error) },
						);
					},
				},
			);
		} catch (error) {
			// Event publish failed - update state to failed
			logger.error(handlerName, "Failed to publish event", {
				correlationId,
				error: error instanceof Error ? error.message : String(error),
			});

			// Try to mark the state as failed
			try {
				await subscriptionStateManager.transitionToFailed(
					correlationId,
					"Failed to publish subscription requested event",
					{
						triggeredBy: "api-handler",
						reason: "RabbitMQ publish failure",
						errorDetails: {
							errorCode: getErrorCode(error),
							errorMessage: error instanceof Error
								? error.message
								: String(error),
						},
					},
				);
			} catch (stateError) {
				logger.error(
					handlerName,
					"Failed to update state after publish failure",
					{
						correlationId,
						error: stateError instanceof Error
							? stateError.message
							: String(stateError),
					},
				);
			}

			const errorResponse: CreateEventDrivenSubscriptionErrorResponse = {
				code: ErrorCodes.RABBITMQ_PUBLISH_ERROR,
				message:
					"Failed to queue subscription request. Please try again.",
				correlation_id: correlationId,
			};
			return c.json(errorResponse, 503);
		}

		// Return immediate response
		const responseData: CreateEventDrivenSubscriptionResponse = {
			correlation_id: correlationId,
			status: "processing",
			message: "Subscription request is being processed",
		};

		const successResponse: BaseResponse<
			CreateEventDrivenSubscriptionResponse
		> = {
			successful: true,
			message: "Event-driven subscription request accepted",
			data: responseData,
		};

		logger.info(handlerName, "Event-driven subscription request accepted", {
			correlationId,
		});

		return c.json(successResponse, 202);
	} catch (error: unknown) {
		const errorClassification = classifyError(error);

		logger.error(handlerName, "Event-driven subscription request failed", {
			correlationId,
			error: error instanceof Error ? error.message : String(error),
			errorCode: errorClassification.code,
			errorType: errorClassification.type,
			retryable: errorClassification.retryable,
		});

		// If we have a correlation ID, try to mark the request as failed
		if (correlationId) {
			try {
				await subscriptionStateManager.transitionToFailed(
					correlationId,
					error instanceof Error ? error.message : "Unknown error",
					{
						triggeredBy: "api-handler",
						reason:
							"Unhandled error in subscription request handler",
						errorDetails: {
							errorCode: errorClassification.code,
							errorType: errorClassification.type,
						},
					},
				);
			} catch (stateError) {
				logger.error(
					handlerName,
					"Failed to record failure state",
					{
						correlationId,
						stateError: stateError instanceof Error
							? stateError.message
							: String(stateError),
					},
				);
			}
		}

		const errorResponse: CreateEventDrivenSubscriptionErrorResponse = {
			code: errorClassification.code,
			message: "Failed to process event-driven subscription request",
			details: error instanceof Error ? error.message : undefined,
			correlation_id: correlationId,
		};

		// Return 503 for transient errors, 500 for permanent
		const statusCode = errorClassification.retryable ? 503 : 500;
		return c.json(errorResponse, statusCode);
	}
}
