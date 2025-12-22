import { RabbitMQClient } from "../_shared/rabbitmq.ts";
import {
	AccountReadyEvent,
	createSubscriptionCreatedEvent,
	DomainEvent,
} from "../_shared/types/events.ts";
import { killBillService } from "../_shared/services/killbill.ts";
import { logger } from "../_shared/middleware/logger.ts";
import { subscriptionStateManager } from "../_shared/services/subscription-state-management.ts";

interface ServiceStatus {
	status: "healthy" | "unhealthy" | "starting";
	consumer_active: boolean;
	last_event: string | null;
	events_processed: number;
}

export class SubscriptionService {
	private rabbitMQClient: RabbitMQClient;
	private consumerActive = false;
	private eventsProcessed = 0;
	private lastEvent: string | null = null;
	private status: ServiceStatus["status"] = "starting";

	constructor() {
		this.rabbitMQClient = new RabbitMQClient();
	}

	async start() {
		console.log("📋 Subscription Service starting...");

		try {
			await this.rabbitMQClient.connect();

			// Start consuming subscription-requested events
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
			console.log("✅ Subscription Service consumer started");
		} catch (error) {
			console.error("❌ Failed to start Subscription Service:", error);
			this.status = "unhealthy";
			throw error;
		}
	}

	private async handleAccountReady(event: AccountReadyEvent) {
		const handlerName = "SubscriptionService.handleAccountReady";
		console.log(
			`📋 Processing account ready for user: ${event.userId}, account: ${event.accountId}`,
		);

		try {
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
					).catch((error) => {
						throw new Error(
							`Failed to uncancel existing subscription: ${
								error instanceof Error
									? error.message
									: String(error)
							}`,
						);
					});
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
				).catch((error) => {
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
			this.rabbitMQClient.publishEvent(
				"subscription.created",
				subscriptionCreatedEvent,
			);

			console.log(
				`🎉 Subscription created event published for correlation: ${event.correlationId}`,
			);
		} catch (error) {
			console.error(`❌ Failed to process account ready event:`, error);

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
				},
			);

			throw error;
		}
	}

	getStatus(): ServiceStatus {
		return {
			status: this.status,
			consumer_active: this.consumerActive,
			last_event: this.lastEvent,
			events_processed: this.eventsProcessed,
		};
	}

	stop() {
		console.log("📋 Subscription Service stopping...");
		this.consumerActive = false;
		this.status = "unhealthy";
		this.rabbitMQClient.disconnect();
	}
}
