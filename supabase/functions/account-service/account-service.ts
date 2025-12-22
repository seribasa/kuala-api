import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
	RabbitMQClient,
} from "../_shared/rabbitmq.ts";
import {
	createAccountReadyEvent,
	DomainEvent,
	SubscriptionRequestedEvent,
} from "../_shared/types/events.ts";
import { killBillService } from "../_shared/services/killbill.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ServiceStatus {
	status: "healthy" | "unhealthy" | "starting";
	consumer_active: boolean;
	last_event: string | null;
	events_processed: number;
}

export class AccountService {
	private supabase: SupabaseClient;
	private rabbitMQClient: RabbitMQClient;
	private consumerActive = false;
	private eventsProcessed = 0;
	private lastEvent: string | null = null;
	private status: ServiceStatus["status"] = "starting";

	constructor() {
		this.supabase = createClient(supabaseUrl, supabaseServiceKey);
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
			const { error: statusError } = await this.supabase
				.from("subscription_requests")
				.update({
					status: "account_ready",
					updated_at: new Date().toISOString(),
				})
				.eq("correlation_id", event.correlationId);

			if (statusError) {
				throw new Error(
					`Failed to update subscription status: ${statusError.message}`,
				);
			}

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
			await this.supabase
				.from("subscription_requests")
				.update({
					status: "failed",
					error_message: error instanceof Error
						? error.message
						: "Unknown error",
					updated_at: new Date().toISOString(),
				})
				.eq("correlation_id", event.correlationId);

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
