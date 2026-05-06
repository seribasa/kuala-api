import { RabbitMQClient } from "@shared/rabbitmq.ts";
import {
	AccountReadyEvent,
	createSubscriptionCreatedEvent,
	DomainEvent,
} from "@shared/types/events.ts";
import { killBillService } from "@shared/services/killbill.ts";
import { logger } from "@shared/middleware/logger.ts";
import { subscriptionStateManager } from "@shared/services/subscription-state-management.ts";
import { ApplicationError, classifyError } from "@shared/errors/index.ts";

interface ServiceStatus {
	status: "healthy" | "unhealthy" | "starting";
	consumer_active: boolean;
	last_event: string | null;
	events_processed: number;
	events_skipped: number;
}

export class SubscriptionService {
	private rabbitMQClient: RabbitMQClient;
	private consumerActive = false;
	private eventsProcessed = 0;
	private eventsSkipped = 0;
	private lastEvent: string | null = null;
	private status: ServiceStatus["status"] = "starting";

	constructor() {
		this.rabbitMQClient = new RabbitMQClient();
	}

	async start() {
		console.log("📋 Subscription Service starting...");

		// Try to connect, but don't fail if RabbitMQ isn't ready yet
		try {
			await this.rabbitMQClient.connect();
		} catch (error) {
			console.warn(
				"⚠️ Initial RabbitMQ connection failed, will retry in background:",
				error,
			);
			// Don't throw - let the reconnection logic handle it
		}

		// Register consumer even if not connected yet
		// It will be created when connection is established
		this.rabbitMQClient.consume(
			"account-ready",
			async (event: DomainEvent) => {
				try {
					if (event.type === "AccountReady") {
						await this.handleAccountReady(
							event as AccountReadyEvent,
						);
						this.eventsProcessed++;
						this.lastEvent = new Date().toISOString();
					}
				} catch (error) {
					console.error("Error processing event:", error);
					throw error; // This will nack the message
				}
			},
		);

		this.consumerActive = true;
		this.status = "healthy";
		console.log(
			"✅ Subscription Service started (consumer will activate when RabbitMQ connects)",
		);
	}

	private async handleAccountReady(event: AccountReadyEvent) {
		const handlerName = "SubscriptionService.handleAccountReady";
		console.log(
			`📋 Processing account ready for user: ${event.userId}, account: ${event.accountId}`,
		);

		try {
			// IDEMPOTENCY CHECK: Check if this event has already been processed
			const currentState = await subscriptionStateManager.getCurrentState(
				event.correlationId,
			);

			if (currentState) {
				const state = currentState.current_state;
				// If already past subscription_created state, skip processing
				if (
					state === "subscription_created" ||
					state === "generating_invoice" ||
					state === "completed"
				) {
					logger.info(
						handlerName,
						`Skipping already processed event, current state: ${state}`,
						{ correlationId: event.correlationId },
					);
					this.eventsSkipped++;
					return; // Idempotent - already processed
				}

				// If in creating_subscription state, check if subscription exists
				if (state === "creating_subscription") {
					const existingSub = await killBillService
						.getSubscriptionByExternalId(event.userId);
					if (existingSub && existingSub.state !== "CANCELLED") {
						logger.info(
							handlerName,
							"Subscription already created, transitioning state",
							{ subscriptionId: existingSub.subscriptionId },
						);
						// Update state and publish event
						await subscriptionStateManager
							.transitionToSubscriptionCreated(
								event.correlationId,
								{
									triggeredBy: "subscription-service",
									reason:
										"Subscription already exists (idempotency recovery)",
									metadata: {
										userId: event.userId,
										subscriptionId:
											existingSub.subscriptionId,
										accountId: event.accountId,
										planId: event.planId,
									},
								},
							);
						const subscriptionCreatedEvent =
							createSubscriptionCreatedEvent(
								event.correlationId,
								event.userId,
								event.accountId,
								existingSub.subscriptionId,
								event.planId,
							);
						await this.rabbitMQClient.publishEvent(
							"subscription.created",
							subscriptionCreatedEvent,
						);
						return;
					}
				}

				// If failed, allow retry
				if (state === "failed") {
					logger.info(
						handlerName,
						`Retrying failed subscription creation`,
						{ correlationId: event.correlationId },
					);
				}
			}

			// Update subscription status to creating_subscription
			await subscriptionStateManager.transitionToCreatingSubscription(
				event.correlationId,
				{
					triggeredBy: "subscription-service",
					reason: "Starting subscription creation process",
					metadata: {
						userId: event.userId,
						accountId: event.accountId,
						planId: event.planId,
						email: event.email,
						name: event.name,
					},
				},
			);
			let subscriptionId: string | null = null;
			// Check for existing active subscription
			const existingSubscription = await killBillService
				.getSubscriptionByExternalId(
					event.userId,
				);

			if (existingSubscription) {
				logger.warn(
					handlerName,
					"User already has active subscription",
					{
						subscription: JSON.stringify(existingSubscription),
					},
				);
				if (existingSubscription.state.toUpperCase() === "CANCELLED") {
					logger.info(
						handlerName,
						"Existing subscription is canceled, proceeding to uncancel",
						{
							subscriptionId: existingSubscription.subscriptionId,
						},
					);
					await killBillService.uncancelSubscription(
						existingSubscription.subscriptionId,
					).catch((error: unknown) => {
						throw new Error(
							`Failed to uncancel existing subscription: ${
								error instanceof Error
									? error.message
									: String(error)
							}`,
						);
					});
					subscriptionId = existingSubscription.subscriptionId;
				} else {
					// Active subscription exists - use it
					subscriptionId = existingSubscription.subscriptionId;
				}
			} else {
				// Create subscription in Kill Bill
				logger.info(
					handlerName,
					"No existing subscription found, creating new subscription",
				);
				subscriptionId = await killBillService.createSubscription(
					event.userId,
					event.accountId,
					event.planId,
				).catch((error: unknown) => {
					throw new Error(
						`Failed to create subscription: ${
							error instanceof Error
								? error.message
								: String(error)
						}`,
					);
				});
			}
			if (!subscriptionId) {
				throw new Error("Subscription ID is null after creation");
			}

			// Update subscription request status
			await subscriptionStateManager.transitionToSubscriptionCreated(
				event.correlationId,
				{
					triggeredBy: "subscription-service",
					reason: existingSubscription
						? "Uncancelled existing subscription"
						: "Created new subscription in Kill Bill",
					metadata: {
						userId: event.userId,
						subscriptionId,
						accountId: event.accountId,
						planId: event.planId,
						wasExisting: !!existingSubscription,
						email: event.email,
						name: event.name,
					},
				},
			);

			// Publish SubscriptionCreated event
			const subscriptionCreatedEvent = createSubscriptionCreatedEvent(
				event.correlationId,
				event.userId,
				event.accountId,
				subscriptionId,
				event.planId,
			);
			await this.rabbitMQClient.publishEvent(
				"subscription.created",
				subscriptionCreatedEvent,
			);

			console.log(
				`🎉 Subscription created event published for correlation: ${event.correlationId}`,
			);
		} catch (error) {
			console.error(`❌ Failed to process account ready event:`, error);

			// Classify error for better handling
			const errorClassification = classifyError(error);

			// Update subscription status to failed
			await subscriptionStateManager.transitionToFailed(
				event.correlationId,
				error instanceof Error ? error.message : "Unknown error",
				{
					triggeredBy: "subscription-service",
					reason: "Failed to process account ready event",
					metadata: {
						userId: event.userId,
						accountId: event.accountId,
						planId: event.planId,
					},
					errorDetails: {
						errorCode: errorClassification.code,
						errorType: errorClassification.type,
						retryable: errorClassification.retryable,
					},
				},
			);

			// Re-throw with classification for RabbitMQ retry logic
			if (error instanceof ApplicationError) {
				throw error;
			}

			throw new ApplicationError(
				errorClassification.code,
				error instanceof Error ? error.message : "Unknown error",
				{
					type: errorClassification.type,
					retryable: errorClassification.retryable,
					cause: error instanceof Error ? error : undefined,
				},
			);
		}
	}

	getStatus(): ServiceStatus {
		return {
			status: this.status,
			consumer_active: this.consumerActive,
			last_event: this.lastEvent,
			events_processed: this.eventsProcessed,
			events_skipped: this.eventsSkipped,
		};
	}

	stop() {
		console.log("📋 Subscription Service stopping...");
		this.consumerActive = false;
		this.status = "unhealthy";
		this.rabbitMQClient.disconnect();
	}
}
