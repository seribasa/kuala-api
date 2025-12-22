import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { RabbitMQClient } from "../_shared/rabbitmq.ts";
import {
	createInvoiceGeneratedEvent,
	DomainEvent,
	SubscriptionCreatedEvent,
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

export class InvoiceService {
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
		console.log("🧾 Invoice Service starting...");

		try {
			await this.rabbitMQClient.connect();

			// Start consuming subscription.created events
			this.rabbitMQClient.consume(
				"subscription-created",
				async (event: DomainEvent) => {
					try {
						if (event.type === "SubscriptionCreated") {
							await this.handleSubscriptionCreated(
								event as SubscriptionCreatedEvent,
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
			console.log("✅ Invoice Service consumer started");
		} catch (error) {
			console.error("❌ Failed to start Invoice Service:", error);
			this.status = "unhealthy";
			throw error;
		}
	}

	private async handleSubscriptionCreated(event: SubscriptionCreatedEvent) {
		console.log(
			`🧾 Processing subscription created for user: ${event.userId}, subscription: ${event.subscriptionId}`,
		);

		try {
			// 1. Update subscription status to generating_invoice
			const { error: statusError } = await this.supabase
				.from("subscription_requests")
				.update({
					status: "generating_invoice",
					updated_at: new Date().toISOString(),
				})
				.eq("correlation_id", event.correlationId);

			if (statusError) {
				throw new Error(
					`Failed to update subscription status: ${statusError.message}`,
				);
			}

			// 2. Get account from Kill Bill
			const account = await killBillService.getAccountByExternalKey(
				event.userId,
			);
			if (!account) {
				throw new Error(`Account not found for user: ${event.userId}`);
			}

			// 3. Check if invoice already exists for current period
			// TODO: check again the period logic
			const invoices = await killBillService.getAccountInvoices(
				account.accountId,
			);
			const invoice = invoices.find((invoice) => {
				if (invoice.status === "VOID") return false;
				return invoice
			});
			const hasInvoiceForCurrentPeriod = !!invoice;

			let invoiceId: string;

			if (hasInvoiceForCurrentPeriod && invoice) {
				console.log(
					`📋 Invoice already exists for current period: ${invoice.invoiceId}`,
				);
				invoiceId = invoice.invoiceId;
			} else {
				console.log(
					"🔄 No invoice for current period. Generating new invoice...",
				);

				// 4. Generate invoice via Kill Bill
				const newInvoiceId = await killBillService.triggerInvoiceRun(
					account.accountId,
				);

				if (!newInvoiceId) {
					// No invoice generated - account is up to date
					console.log("✅ Account is up to date, no invoice needed");

					// Update subscription request status to completed without invoice
					const { error: updateError } = await this.supabase
						.from("subscription_requests")
						.update({
							status: "completed",
							updated_at: new Date().toISOString(),
							completed_at: new Date().toISOString(),
						})
						.eq("correlation_id", event.correlationId);

					if (updateError) {
						throw new Error(
							`Failed to update subscription status: ${updateError.message}`,
						);
					}

					console.log(
						`✅ Subscription flow completed without new invoice!`,
					);
					return;
				}

				invoiceId = newInvoiceId;
				console.log(`🧾 New invoice generated: ${invoiceId}`);
			}

			// 5. Update subscription request status to completed
			const { error: updateError } = await this.supabase
				.from("subscription_requests")
				.update({
					status: "completed",
					invoice_id: invoiceId,
					updated_at: new Date().toISOString(),
					completed_at: new Date().toISOString(),
				})
				.eq("correlation_id", event.correlationId);

			if (updateError) {
				throw new Error(
					`Failed to update subscription status: ${updateError.message}`,
				);
			}

			// 6. Publish InvoiceGenerated event
			const invoiceGeneratedEvent = createInvoiceGeneratedEvent(
				event.correlationId,
				event.userId,
				event.accountId,
				event.subscriptionId,
				invoiceId,
			);

			await this.rabbitMQClient.publishEvent(
				"invoice.generated",
				invoiceGeneratedEvent,
			);

			console.log(
				`🎉 Invoice generated event published for correlation: ${event.correlationId}`,
			);
			console.log(`✅ Subscription flow completed successfully!`);
		} catch (error) {
			console.error(
				`❌ Failed to process subscription created event:`,
				error,
			);

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
		console.log("🧾 Invoice Service stopping...");
		this.consumerActive = false;
		this.status = "unhealthy";
		this.rabbitMQClient.disconnect();
	}
}
