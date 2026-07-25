// deno-lint-ignore-file
import { assertEquals, assertRejects } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { InvoiceService } from "../invoice-service.ts";
import { killBillService } from "@shared/services/killbill.ts";
import { subscriptionStateManager } from "@shared/services/subscription-state-management.ts";
import { RabbitMQClient } from "@shared/rabbitmq.ts";
import { SubscriptionCreatedEvent } from "@shared/types/events.ts";
import { ApplicationError } from "@shared/errors/index.ts";

Deno.test({
	name: "InvoiceService Tests",
	async fn(t) {
		const service = new InvoiceService();

		const mockEvent: SubscriptionCreatedEvent = {
			eventId: "evt-123",
			correlationId: "corr-123",
			timestamp: new Date().toISOString(),
			type: "SubscriptionCreated",
			userId: "user-123",
			accountId: "kb-acc-123",
			subscriptionId: "sub-123",
			planId: "plan-123",
			metadata: {},
		};

		await t.step(
			"handleSubscriptionCreated - Idempotent SKIP",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() =>
						Promise.resolve({
							current_state: "completed",
							entity_type: "subscription_request",
							entity_id: "corr-123",
							state_updated_at: new Date().toISOString(),
							last_updated_by: "system",
						}),
				);

				// deno-lint-ignore no-explicit-any
				await (service as any).handleSubscriptionCreated(mockEvent);

				assertSpyCalls(stateStub, 1);
				assertEquals(service.getStatus().events_skipped, 1);
				stateStub.restore();
			},
		);

		await t.step(
			"handleSubscriptionCreated - Success (No invoice needed)",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() => Promise.resolve(null),
				);

				const generatingStub = stub(
					subscriptionStateManager,
					"transitionToGeneratingInvoice",
					() => Promise.resolve("trans-123"),
				);

				const getAccStub = stub(
					killBillService,
					"getAccountByExternalKey",
					() =>
						Promise.resolve({
							accountId: "kb-acc-123",
							name: "Test User",
							email: "test@example.com",
							externalKey: "user-123",
							currency: "USD",
						}),
				);

				const getInvStub = stub(
					killBillService,
					"getAccountInvoices",
					() => Promise.resolve([]), // No existing invoices
				);

				const triggerInvStub = stub(
					killBillService,
					"triggerInvoiceRun",
					() => Promise.resolve(null), // No invoice generated
				);

				const completedStub = stub(
					subscriptionStateManager,
					"transitionToCompleted",
					() => Promise.resolve("trans-125"),
				);

				const publishStub = stub(
					RabbitMQClient.prototype,
					"publishEvent",
					() => Promise.resolve(),
				);

				// deno-lint-ignore no-explicit-any
				await (service as any).handleSubscriptionCreated(mockEvent);

				assertSpyCalls(getAccStub, 1);
				assertSpyCalls(getInvStub, 1);
				assertSpyCalls(triggerInvStub, 1);
				assertSpyCalls(generatingStub, 1);
				assertSpyCalls(completedStub, 1);
				assertSpyCalls(publishStub, 0); // Event should NOT be published if no invoice

				stateStub.restore();
				generatingStub.restore();
				getAccStub.restore();
				getInvStub.restore();
				triggerInvStub.restore();
				completedStub.restore();
				publishStub.restore();
			},
		);

		await t.step(
			"handleSubscriptionCreated - Success (Generates new invoice)",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() => Promise.resolve(null),
				);

				const generatingStub = stub(
					subscriptionStateManager,
					"transitionToGeneratingInvoice",
					() => Promise.resolve("trans-123"),
				);

				const getAccStub = stub(
					killBillService,
					"getAccountByExternalKey",
					() =>
						Promise.resolve({
							accountId: "kb-acc-123",
							name: "Test",
							email: "test@ex.com",
							externalKey: "user-123",
							currency: "USD",
						}),
				);

				const getInvStub = stub(
					killBillService,
					"getAccountInvoices",
					() => Promise.resolve([]), // No existing
				);

				const triggerInvStub = stub(
					killBillService,
					"triggerInvoiceRun",
					() => Promise.resolve("inv-123"), // Invoice was generated
				);

				const completedStub = stub(
					subscriptionStateManager,
					"transitionToCompleted",
					() => Promise.resolve("trans-125"),
				);

				const publishStub = stub(
					RabbitMQClient.prototype,
					"publishEvent",
					() => Promise.resolve(),
				);

				// deno-lint-ignore no-explicit-any
				await (service as any).handleSubscriptionCreated(mockEvent);

				assertSpyCalls(getAccStub, 1);
				assertSpyCalls(getInvStub, 1);
				assertSpyCalls(triggerInvStub, 1);
				assertSpyCalls(generatingStub, 1);
				assertSpyCalls(completedStub, 1);
				assertSpyCalls(publishStub, 1);

				stateStub.restore();
				generatingStub.restore();
				getAccStub.restore();
				getInvStub.restore();
				triggerInvStub.restore();
				completedStub.restore();
				publishStub.restore();
			},
		);

		await t.step(
			"handleSubscriptionCreated - Success (Uses existing invoice)",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() => Promise.resolve(null),
				);

				const generatingStub = stub(
					subscriptionStateManager,
					"transitionToGeneratingInvoice",
					() => Promise.resolve("trans-123"),
				);

				const getAccStub = stub(
					killBillService,
					"getAccountByExternalKey",
					() =>
						Promise.resolve({
							accountId: "kb-acc-123",
							name: "Test",
							email: "test@ex.com",
							externalKey: "user-123",
							currency: "USD",
						}),
				);

				const getInvStub = stub(
					killBillService,
					"getAccountInvoices",
					() =>
						Promise.resolve([{
							invoiceId: "inv-existing",
							accountId: "kb-acc-123",
							amount: 10,
							currency: "USD",
							status: "COMMITTED" as "COMMITTED",
							creditAdj: 0,
							refundAdj: 0,
							invoiceDate: new Date().toISOString(),
							targetDate: new Date().toISOString(),
							balance: 10,
							items: [{
								invoiceItemId: "item-123",
								invoiceId: "inv-existing",
								accountId: "kb-acc-123",
								itemType: "RECURRING" as "RECURRING",
								amount: 10,
								currency: "USD",
								startDate: new Date().toISOString(),
								endDate: new Date().toISOString(),
							}],
						}]),
				);

				const triggerInvStub = stub(
					killBillService,
					"triggerInvoiceRun",
					() => Promise.resolve(null),
				);

				const completedStub = stub(
					subscriptionStateManager,
					"transitionToCompleted",
					() => Promise.resolve("trans-125"),
				);

				const publishStub = stub(
					RabbitMQClient.prototype,
					"publishEvent",
					() => Promise.resolve(),
				);

				// deno-lint-ignore no-explicit-any
				await (service as any).handleSubscriptionCreated(mockEvent);

				assertSpyCalls(getAccStub, 1);
				assertSpyCalls(getInvStub, 1);
				assertSpyCalls(triggerInvStub, 0); // Shouldn't be called because invoice exists
				assertSpyCalls(generatingStub, 1);
				assertSpyCalls(completedStub, 1);
				assertSpyCalls(publishStub, 1);

				stateStub.restore();
				generatingStub.restore();
				getAccStub.restore();
				getInvStub.restore();
				triggerInvStub.restore();
				completedStub.restore();
				publishStub.restore();
			},
		);

		await t.step("handleSubscriptionCreated - Error handling", async () => {
			const stateStub = stub(
				subscriptionStateManager,
				"getCurrentState",
				() => Promise.resolve(null),
			);

			const generatingStub = stub(
				subscriptionStateManager,
				"transitionToGeneratingInvoice",
				() => Promise.resolve("trans-123"),
			);

			const getAccStub = stub(
				killBillService,
				"getAccountByExternalKey",
				() => Promise.reject(new Error("KillBill error")),
			);

			const failStub = stub(
				subscriptionStateManager,
				"transitionToFailed",
				() => Promise.resolve("trans-125"),
			);

			// Should throw ApplicationError
			// deno-lint-ignore no-explicit-any
			await assertRejects(() =>
				(service as any).handleSubscriptionCreated(mockEvent)
			);

			assertSpyCalls(getAccStub, 1);
			assertSpyCalls(failStub, 1);

			stateStub.restore();
			generatingStub.restore();
			getAccStub.restore();
			failStub.restore();
		});

		await t.step(
			"handleSubscriptionCreated - Non-Error throwing",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() => Promise.resolve(null),
				);
				const generatingStub = stub(
					subscriptionStateManager,
					"transitionToGeneratingInvoice",
					() => Promise.resolve("trans-123"),
				);
				const getAccStub = stub(
					killBillService,
					"getAccountByExternalKey",
					() => Promise.reject("String Error"),
				); // not an Error instance
				const failStub = stub(
					subscriptionStateManager,
					"transitionToFailed",
					() => Promise.resolve("trans-125"),
				);

				await assertRejects(() =>
					(service as any).handleSubscriptionCreated(mockEvent)
				);

				assertSpyCalls(failStub, 1);

				stateStub.restore();
				generatingStub.restore();
				getAccStub.restore();
				failStub.restore();
			},
		);

		await t.step(
			"handleSubscriptionCreated - Success (Non-blocking State)",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() =>
						Promise.resolve({
							current_state: "started", // Non-blocking state
							entity_type: "subscription_request",
							entity_id: "corr-123",
							state_updated_at: new Date().toISOString(),
							last_updated_by: "system",
						}),
				);
				const generatingStub = stub(
					subscriptionStateManager,
					"transitionToGeneratingInvoice",
					() => Promise.resolve("trans-123"),
				);
				const getAccStub = stub(
					killBillService,
					"getAccountByExternalKey",
					() =>
						Promise.resolve({
							accountId: "kb-acc-123",
							name: "Test User",
							email: "test@example.com",
							externalKey: "user-123",
							currency: "USD",
						}),
				);
				const getInvStub = stub(
					killBillService,
					"getAccountInvoices",
					() => Promise.resolve([]),
				);
				const triggerInvStub = stub(
					killBillService,
					"triggerInvoiceRun",
					() => Promise.resolve("inv-123"),
				);
				const completedStub = stub(
					subscriptionStateManager,
					"transitionToCompleted",
					() => Promise.resolve("trans-125"),
				);
				const publishStub = stub(
					RabbitMQClient.prototype,
					"publishEvent",
					() => Promise.resolve(),
				);

				await (service as any).handleSubscriptionCreated(mockEvent);

				assertSpyCalls(triggerInvStub, 1);

				stateStub.restore();
				generatingStub.restore();
				getAccStub.restore();
				getInvStub.restore();
				triggerInvStub.restore();
				completedStub.restore();
				publishStub.restore();
			},
		);

		await t.step(
			"handleSubscriptionCreated - Ignores VOID invoice",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() => Promise.resolve(null),
				);
				const generatingStub = stub(
					subscriptionStateManager,
					"transitionToGeneratingInvoice",
					() => Promise.resolve("trans-123"),
				);
				const getAccStub = stub(
					killBillService,
					"getAccountByExternalKey",
					() =>
						Promise.resolve({
							accountId: "kb-acc-123",
							name: "Test User",
							email: "test@example.com",
							externalKey: "user-123",
							currency: "USD",
						}),
				);
				const getInvStub = stub(
					killBillService,
					"getAccountInvoices",
					() =>
						Promise.resolve([
							{
								invoiceId: "inv-void",
								status: "VOID" as any,
								accountId: "kb-acc-123",
								amount: 10,
								currency: "USD",
								creditAdj: 0,
								refundAdj: 0,
								invoiceDate: new Date().toISOString(),
								targetDate: new Date().toISOString(),
								balance: 10,
								items: [],
							},
						]),
				);
				const triggerInvStub = stub(
					killBillService,
					"triggerInvoiceRun",
					() => Promise.resolve("inv-new"),
				);
				const completedStub = stub(
					subscriptionStateManager,
					"transitionToCompleted",
					() => Promise.resolve("trans-125"),
				);
				const publishStub = stub(
					RabbitMQClient.prototype,
					"publishEvent",
					() => Promise.resolve(),
				);

				await (service as any).handleSubscriptionCreated(mockEvent);

				assertSpyCalls(triggerInvStub, 1); // Should trigger NEW invoice because the existing one is VOID!

				stateStub.restore();
				generatingStub.restore();
				getAccStub.restore();
				getInvStub.restore();
				triggerInvStub.restore();
				completedStub.restore();
				publishStub.restore();
			},
		);

		await t.step(
			"handleSubscriptionCreated - ApplicationError rethrow",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() => Promise.resolve(null),
				);
				const generatingStub = stub(
					subscriptionStateManager,
					"transitionToGeneratingInvoice",
					() => Promise.resolve("trans-123"),
				);

				const appError = new ApplicationError(
					"KILLBILL_CONNECTION_ERROR",
					"test",
					{ type: "TRANSIENT" as any, retryable: true },
				);
				const getAccStub = stub(
					killBillService,
					"getAccountByExternalKey",
					() => Promise.reject(appError),
				);

				const failStub = stub(
					subscriptionStateManager,
					"transitionToFailed",
					() => Promise.resolve("trans-125"),
				);

				const err = await assertRejects(() =>
					(service as any).handleSubscriptionCreated(mockEvent)
				);
				assertEquals(err, appError);

				stateStub.restore();
				generatingStub.restore();
				getAccStub.restore();
				failStub.restore();
			},
		);

		await t.step(
			"handleSubscriptionCreated - Idempotent Retry",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() =>
						Promise.resolve({
							current_state: "failed",
							entity_type: "subscription_request",
							entity_id: "corr-123",
							state_updated_at: new Date().toISOString(),
							last_updated_by: "system",
						}),
				);
				const generatingStub = stub(
					subscriptionStateManager,
					"transitionToGeneratingInvoice",
					() => Promise.resolve("trans-123"),
				);
				const getAccStub = stub(
					killBillService,
					"getAccountByExternalKey",
					() =>
						Promise.resolve({
							accountId: "kb-acc-123",
							name: "Test User",
							email: "test@example.com",
							externalKey: "user-123",
							currency: "USD",
						}),
				);
				const getInvStub = stub(
					killBillService,
					"getAccountInvoices",
					() => Promise.resolve([]),
				);
				const triggerInvStub = stub(
					killBillService,
					"triggerInvoiceRun",
					() => Promise.resolve("inv-123"),
				);
				const completedStub = stub(
					subscriptionStateManager,
					"transitionToCompleted",
					() => Promise.resolve("trans-125"),
				);
				const publishStub = stub(
					RabbitMQClient.prototype,
					"publishEvent",
					() => Promise.resolve(),
				);

				await (service as any).handleSubscriptionCreated(mockEvent);

				assertSpyCalls(getAccStub, 1);
				assertSpyCalls(triggerInvStub, 1);

				stateStub.restore();
				generatingStub.restore();
				getAccStub.restore();
				getInvStub.restore();
				triggerInvStub.restore();
				completedStub.restore();
				publishStub.restore();
			},
		);

		await t.step("start, getStatus, stop", async () => {
			const connectStub = stub(
				RabbitMQClient.prototype,
				"connect",
				() => Promise.resolve(),
			);
			const consumeStub = stub(
				RabbitMQClient.prototype,
				"consume",
				() => {},
			);
			const disconnectStub = stub(
				RabbitMQClient.prototype,
				"disconnect",
				() => Promise.resolve(),
			);

			const svc = new InvoiceService();
			assertEquals(svc.getStatus().status, "starting");

			await svc.start();
			assertEquals(svc.getStatus().status, "healthy");
			assertEquals(svc.getStatus().consumer_active, true);

			assertSpyCalls(connectStub, 1);
			assertSpyCalls(consumeStub, 1);

			svc.stop();
			assertEquals(svc.getStatus().status, "unhealthy");
			assertEquals(svc.getStatus().consumer_active, false);

			assertSpyCalls(disconnectStub, 1);

			connectStub.restore();
			consumeStub.restore();
			disconnectStub.restore();
		});

		await t.step(
			"start - connection failure should not throw",
			async () => {
				const connectStub = stub(
					RabbitMQClient.prototype,
					"connect",
					() => Promise.reject(new Error("conn failed")),
				);
				const consumeStub = stub(
					RabbitMQClient.prototype,
					"consume",
					() => {},
				);

				const svc = new InvoiceService();
				await svc.start();

				assertSpyCalls(connectStub, 1);
				assertSpyCalls(consumeStub, 1);

				connectStub.restore();
				consumeStub.restore();
			},
		);

		await t.step("consumer callback execution", async () => {
			let capturedCallback: any;
			const consumeStub = stub(
				RabbitMQClient.prototype,
				"consume",
				(_queue, cb) => {
					capturedCallback = cb;
				},
			);
			const connectStub = stub(
				RabbitMQClient.prototype,
				"connect",
				() => Promise.resolve(),
			);

			const svc = new InvoiceService();
			await svc.start();

			const handleStub = stub(
				svc as any,
				"handleSubscriptionCreated",
				() => Promise.resolve(),
			);

			await capturedCallback({
				type: "SubscriptionCreated",
				userId: "123",
			});
			assertSpyCalls(handleStub, 1);
			assertEquals(svc.getStatus().events_processed, 1);

			await capturedCallback({ type: "OtherEvent" });
			assertSpyCalls(handleStub, 1);

			handleStub.restore();
			const handleStub2 = stub(
				svc as any,
				"handleSubscriptionCreated",
				() => Promise.reject(new Error("fail")),
			);
			await assertRejects(() =>
				capturedCallback({ type: "SubscriptionCreated", userId: "123" })
			);

			connectStub.restore();
			consumeStub.restore();
			handleStub2.restore();
		});
	},
});
