import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { RabbitMQClient } from "../_shared/rabbitmq.ts";
import {
	AccountReadyEvent,
	createSubscriptionCreatedEvent,
	DomainEvent,
} from "../_shared/types/events.ts";
import { killBillService } from "../_shared/services/killbill.ts";
import { logger } from "../_shared/middleware/logger.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ServiceStatus {
	status: "healthy" | "unhealthy" | "starting";
	consumer_active: boolean;
	last_event: string | null;
	events_processed: number;
}

export class SubscriptionService {
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
			const { error: statusError } = await this.supabase
				.from("subscription_requests")
				.update({
					status: "creating_subscription",
					account_id: event.accountId,
					updated_at: new Date().toISOString(),
				})
				.eq("correlation_id", event.correlationId);

			if (statusError) {
				throw new Error(
					`Failed to update subscription status: ${statusError.message}`,
				);
			}
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
			const { error: updateError } = await this.supabase
				.from("subscription_requests")
				.update({
					status: "subscription_created",
					subscription_id: subscriptionId,
					updated_at: new Date().toISOString(),
				})
				.eq("correlation_id", event.correlationId);

			if (updateError) {
				throw new Error(
					`Failed to update subscription status: ${updateError.message}`,
				);
			}

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
		console.log("📋 Subscription Service stopping...");
		this.consumerActive = false;
		this.status = "unhealthy";
		this.rabbitMQClient.disconnect();
	}
}
