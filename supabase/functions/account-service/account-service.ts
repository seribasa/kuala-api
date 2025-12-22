import { RabbitMQClient } from "../_shared/rabbitmq.ts";
import {
	createAccountReadyEvent,
	DomainEvent,
	SubscriptionRequestedEvent,
} from "../_shared/types/events.ts";
import { killBillService } from "../_shared/services/killbill.ts";
import { subscriptionStateManager } from "../_shared/services/state-management.ts";

interface ServiceStatus {
	status: "healthy" | "unhealthy" | "starting";
	consumer_active: boolean;
	last_event: string | null;
	events_processed: number;
}

export class AccountService {
	private rabbitMQClient: RabbitMQClient;
	private consumerActive = false;
	private eventsProcessed = 0;
	private lastEvent: string | null = null;
	private status: ServiceStatus["status"] = "starting";

	constructor() {
		this.rabbitMQClient = new RabbitMQClient();
	}

	async start() {
		console.log("🏦 Account Service starting...");

		try {
			await this.rabbitMQClient.connect();

			// Start consuming subscription.requested events
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
			console.log("✅ Account Service consumer started");
		} catch (error) {
			console.error("❌ Failed to start Account Service:", error);
			this.status = "unhealthy";
			throw error;
		}
	}

	private async handleSubscriptionRequested(
		event: SubscriptionRequestedEvent,
	) {
		console.log(
			`🏦 Processing subscription request for user: ${event.userId}`,
		);

		try {
			// 1. Check if account already exists
			const killBillAccountResponse = await killBillService
				.getOrCreateAccount(
					event.userId,
					event.email,
				);

			// 3. Update SAGA subscription status to account_ready
			await subscriptionStateManager.transitionToAccountReady(
				event.correlationId,
				{
					triggeredBy: "account-service",
					reason: "Account created/verified in Kill Bill",
					metadata: {
						accountId: killBillAccountResponse.account.accountId,
						isNewAccount: killBillAccountResponse.isNewAccount,
						currency: killBillAccountResponse.account.currency,
					},
				},
			);

			// 4. Publish AccountReady event
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
		console.log("🏦 Account Service stopping...");
		this.consumerActive = false;
		this.status = "unhealthy";
		this.rabbitMQClient.disconnect();
	}
}
