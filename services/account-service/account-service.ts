import { RabbitMQClient } from "@shared/rabbitmq.ts";
import {
	createAccountReadyEvent,
	DomainEvent,
	SubscriptionRequestedEvent,
} from "@shared/types/events.ts";
import { killBillService } from "@shared/services/killbill.ts";
import { subscriptionStateManager } from "@shared/services/subscription-state-management.ts";
import { ApplicationError, classifyError } from "@shared/errors/index.ts";

interface ServiceStatus {
	status: "healthy" | "unhealthy" | "starting";
	consumer_active: boolean;
	last_event: string | null;
	events_processed: number;
	events_skipped: number;
}

export class AccountService {
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
		console.log("🏦 Account Service starting...");

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
			"subscription-requested",
			async (event: DomainEvent) => {
				try {
					if (event.type === "SubscriptionRequested") {
						await this.handleSubscriptionRequested(
							event as SubscriptionRequestedEvent,
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
			"✅ Account Service started (consumer will activate when RabbitMQ connects)",
		);
	}

	private async handleSubscriptionRequested(
		event: SubscriptionRequestedEvent,
	) {
		console.log(
			`🏦 Processing subscription request for user: ${event.userId}`,
		);

		try {
			// IDEMPOTENCY CHECK: Check if this event has already been processed
			const currentState = await subscriptionStateManager.getCurrentState(
				event.correlationId,
			);

			if (currentState) {
				const state = currentState.current_state;
				// If already past account_ready state, skip processing
				if (
					state === "account_ready" ||
					state === "creating_subscription" ||
					state === "subscription_created" ||
					state === "generating_invoice" ||
					state === "completed"
				) {
					console.log(
						`⏭️ Skipping already processed event ${event.eventId}, current state: ${state}`,
					);
					this.eventsSkipped++;
					return; // Idempotent - already processed
				}

				// If failed, allow retry
				if (state === "failed") {
					console.log(
						`🔄 Retrying failed subscription request ${event.correlationId}`,
					);
				}
			}

			// 1. Check if account already exists
			const killBillAccountResponse = await killBillService
				.getOrCreateAccount(
					event.userId,
					event.email,
				);

			// 2. Update SAGA subscription status to account_ready
			await subscriptionStateManager.transitionToAccountReady(
				event.correlationId,
				{
					triggeredBy: "account-service",
					reason: "Account created/verified in Kill Bill",
					metadata: {
						userId: event.userId,
						accountId: killBillAccountResponse.account.accountId,
						isNewAccount: killBillAccountResponse.isNewAccount,
						currency: killBillAccountResponse.account.currency,
						email: event.email,
						name: event.name,
						planId: event.planId,
					},
				},
			);

			// 3. Publish AccountReady event
			const accountReadyEvent = createAccountReadyEvent(
				event.correlationId,
				event.userId,
				killBillAccountResponse.account.accountId,
				event.name,
				event.email,
				killBillAccountResponse.account.currency,
				event.planId,
				killBillAccountResponse.isNewAccount,
			);
			await this.rabbitMQClient.publishEvent(
				"account.ready",
				accountReadyEvent,
			);

			console.log(
				`🎉 Account ready event published for correlation: ${event.correlationId}`,
			);
		} catch (error) {
			console.error(`❌ Failed to process subscription request:`, error);

			// Classify error for better handling
			const errorClassification = classifyError(error);

			// Update subscription status to failed
			await subscriptionStateManager.transitionToFailed(
				event.correlationId,
				error instanceof Error ? error.message : "Unknown error",
				{
					triggeredBy: "account-service",
					reason: "Failed to process subscription request",
					metadata: {
						userId: event.userId,
						email: event.email,
						name: event.name,
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
		console.log("🏦 Account Service stopping...");
		this.consumerActive = false;
		this.status = "unhealthy";
		this.rabbitMQClient.disconnect();
	}
}
