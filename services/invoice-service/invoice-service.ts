import { RabbitMQClient } from "@shared/rabbitmq.ts";
import {
	createInvoiceGeneratedEvent,
	DomainEvent,
	SubscriptionCreatedEvent,
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

export class InvoiceService {
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
		console.log("🧾 Invoice Service starting...");

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
		console.log(
			"✅ Invoice Service started (consumer will activate when RabbitMQ connects)",
		);
	}

	private async handleSubscriptionCreated(event: SubscriptionCreatedEvent) {
		const _handlerName = "InvoiceService.handleSubscriptionCreated";
		console.log(
			`🧾 Processing subscription created for user: ${event.userId}, subscription: ${event.subscriptionId}`,
		);

		try {
			// IDEMPOTENCY CHECK: Check if this event has already been processed
			const currentState = await subscriptionStateManager.getCurrentState(
				event.correlationId,
			);

			if (currentState) {
				const state = currentState.current_state;
				// If already completed, skip processing
				if (state === "completed") {
					console.log(
						`⏭️ Skipping already completed event ${event.correlationId}`,
					);
					this.eventsSkipped++;
					return; // Idempotent - already processed
				}

				// If in generating_invoice state, check if we can resume
				if (state === "generating_invoice") {
					console.log(
						`🔄 Resuming invoice generation for ${event.correlationId}`,
					);
				}

				// If failed, allow retry
				if (state === "failed") {
					console.log(
						`🔄 Retrying failed invoice generation for ${event.correlationId}`,
					);
				}
			}

			// 1. Update subscription status to generating_invoice
			await subscriptionStateManager.transitionToGeneratingInvoice(
				event.correlationId,
				{
					triggeredBy: "invoice-service",
					reason: "Starting invoice generation process",
					metadata: {
						userId: event.userId,
						accountId: event.accountId,
						subscriptionId: event.subscriptionId,
					},
				},
			);

			// 2. Get account from Kill Bill
			const account = await killBillService.getAccountByExternalKey(
				event.userId,
			);
			if (!account) {
				throw new Error(`Account not found for user: ${event.userId}`);
			}

			// 3. Check if invoice already exists for current period (must contain items)
			const invoices = await killBillService.getAccountInvoices(
				account.accountId,
			);
			const invoice = invoices.find((inv) => {
				if (inv.status === "VOID") return false;
				return inv.items && inv.items.length > 0;
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
				// Since we use IN_ARREAR mode, we must pass the end of the period as targetDate
				// to force the invoice to be generated immediately. With billCycleDayLocal = 1,
				// the first period ends on the 1st of the next month.
				const now = new Date();
				const nextMonth = new Date(
					Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
				);
				const targetDate = nextMonth.toISOString().split("T")[0];

				const newInvoiceId = await killBillService.triggerInvoiceRun(
					account.accountId,
					targetDate,
				);

				if (!newInvoiceId) {
					// No invoice generated - account is up to date
					console.log("✅ Account is up to date, no invoice needed");

					// Update subscription request status to completed without invoice
					await subscriptionStateManager.transitionToCompleted(
						event.correlationId,
						{
							triggeredBy: "invoice-service",
							reason:
								"Account is up to date, no new invoice needed",
							metadata: {
								userId: event.userId,
								accountId: event.accountId,
								subscriptionId: event.subscriptionId,
								invoiceGenerated: false,
							},
						},
					);

					console.log(
						`✅ Subscription flow completed without new invoice!`,
					);
					return;
				}

				invoiceId = newInvoiceId;
				console.log(`🧾 New invoice generated: ${invoiceId}`);
			}

			// 5. Update subscription request status to completed
			await subscriptionStateManager.transitionToCompleted(
				event.correlationId,
				{
					triggeredBy: "invoice-service",
					reason: hasInvoiceForCurrentPeriod
						? "Used existing invoice for current period"
						: "Generated new invoice",
					metadata: {
						userId: event.userId,
						accountId: event.accountId,
						subscriptionId: event.subscriptionId,
						invoiceId,
						invoiceGenerated: true,
						wasExistingInvoice: hasInvoiceForCurrentPeriod,
					},
				},
			);

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

			// Classify error for better handling
			const errorClassification = classifyError(error);

			// Update subscription status to failed
			await subscriptionStateManager.transitionToFailed(
				event.correlationId,
				error instanceof Error ? error.message : "Unknown error",
				{
					triggeredBy: "invoice-service",
					reason: "Failed to process subscription created event",
					metadata: {
						userId: event.userId,
						accountId: event.accountId,
						subscriptionId: event.subscriptionId,
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
		console.log("🧾 Invoice Service stopping...");
		this.consumerActive = false;
		this.status = "unhealthy";
		this.rabbitMQClient.disconnect();
	}
}
