// deno-lint-ignore-file
import { assertEquals, assertRejects } from "@std/assert";
import { assertSpyCalls, returnsNext, stub } from "@std/testing/mock";
import { AccountService } from "../account-service.ts";
import { killBillService } from "@shared/services/killbill.ts";
import { subscriptionStateManager } from "@shared/services/subscription-state-management.ts";
import { RabbitMQClient } from "@shared/rabbitmq.ts";
import { SubscriptionRequestedEvent } from "@shared/types/events.ts";
import { ApplicationError } from "@shared/errors/index.ts";

Deno.test({
	name: "AccountService Tests",
	async fn(t) {
		const service = new AccountService();

		// Mock event
		const mockEvent: SubscriptionRequestedEvent = {
			eventId: "evt-123",
			correlationId: "corr-123",
			timestamp: new Date().toISOString(),
			type: "SubscriptionRequested",
			userId: "user-123",
			planId: "plan-123",
			email: "test@example.com",
			name: "Test User",
			metadata: { source: "api" },
		};

		await t.step(
			"handleSubscriptionRequested - Idempotent SKIP",
			async () => {
				// Mock state as already processed
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() =>
						Promise.resolve({
							current_state: "account_ready",
							entity_type: "subscription_request",
							entity_id: "corr-123",
							state_updated_at: new Date().toISOString(),
							last_updated_by: "system",
						}),
				);

				// Access private method for testing
				// deno-lint-ignore no-explicit-any
				await (service as any).handleSubscriptionRequested(mockEvent);

				assertSpyCalls(stateStub, 1);
				assertEquals(service.getStatus().events_skipped, 1);
				stateStub.restore();
			},
		);

		await t.step(
			"handleSubscriptionRequested - Success (New Account)",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() => Promise.resolve(null),
				);

				const killBillStub = stub(
					killBillService,
					"getOrCreateAccount",
					() =>
						Promise.resolve({
							account: {
								accountId: "kb-acc-123",
								name: "Test User",
								email: "test@example.com",
								externalKey: "user-123",
								currency: "USD",
							},
							isNewAccount: true,
						}),
				);

				const transitionStub = stub(
					subscriptionStateManager,
					"transitionToAccountReady",
					() => Promise.resolve("trans-123"),
				);

				const publishStub = stub(
					RabbitMQClient.prototype,
					"publishEvent",
					() => Promise.resolve(),
				);

				// deno-lint-ignore no-explicit-any
				await (service as any).handleSubscriptionRequested(mockEvent);

				assertSpyCalls(killBillStub, 1);
				assertSpyCalls(transitionStub, 1);
				assertSpyCalls(publishStub, 1);

				stateStub.restore();
				killBillStub.restore();
				transitionStub.restore();
				publishStub.restore();
			},
		);

		await t.step(
			"handleSubscriptionRequested - Error handling",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() => Promise.resolve(null),
				);

				const killBillStub = stub(
					killBillService,
					"getOrCreateAccount",
					() => Promise.reject(new Error("KillBill timeout")),
				);

				const failStub = stub(
					subscriptionStateManager,
					"transitionToFailed",
					() => Promise.resolve("trans-123"),
				);

				// Should throw ApplicationError
				// deno-lint-ignore no-explicit-any
				await assertRejects(() =>
					(service as any).handleSubscriptionRequested(mockEvent)
				);

				assertSpyCalls(killBillStub, 1);
				assertSpyCalls(failStub, 1);

				stateStub.restore();
				killBillStub.restore();
				failStub.restore();
			},
		);

		await t.step(
			"handleSubscriptionRequested - Success (Non-blocking State)",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() =>
						Promise.resolve({
							current_state: "pending", // non-blocking state
							entity_type: "subscription_request",
							entity_id: "corr-123",
							state_updated_at: new Date().toISOString(),
							last_updated_by: "system",
						}),
				);

				const killBillStub = stub(
					killBillService,
					"getOrCreateAccount",
					() =>
						Promise.resolve({
							account: {
								accountId: "kb-acc-123",
								name: "Test User",
								email: "test@example.com",
								externalKey: "user-123",
								currency: "USD",
							},
							isNewAccount: true,
						}),
				);

				const transitionStub = stub(
					subscriptionStateManager,
					"transitionToAccountReady",
					() => Promise.resolve("trans-123"),
				);

				const publishStub = stub(
					RabbitMQClient.prototype,
					"publishEvent",
					() => Promise.resolve(),
				);

				await (service as any).handleSubscriptionRequested(mockEvent);

				assertSpyCalls(killBillStub, 1);

				stateStub.restore();
				killBillStub.restore();
				transitionStub.restore();
				publishStub.restore();
			},
		);

		await t.step(
			"handleSubscriptionRequested - Non-Error throwing",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() => Promise.resolve(null),
				);

				const killBillStub = stub(
					killBillService,
					"getOrCreateAccount",
					() => Promise.reject("String Error"), // not an instance of Error
				);

				const failStub = stub(
					subscriptionStateManager,
					"transitionToFailed",
					() => Promise.resolve("trans-123"),
				);

				await assertRejects(() =>
					(service as any).handleSubscriptionRequested(mockEvent)
				);

				assertSpyCalls(failStub, 1);

				stateStub.restore();
				killBillStub.restore();
				failStub.restore();
			},
		);

		await t.step(
			"handleSubscriptionRequested - ApplicationError rethrow",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() => Promise.resolve(null),
				);

				const appError = new ApplicationError(
					"KILLBILL_CONNECTION_ERROR",
					"test",
					{ type: "TRANSIENT" as any, retryable: true },
				);
				const killBillStub = stub(
					killBillService,
					"getOrCreateAccount",
					() => Promise.reject(appError),
				);

				const failStub = stub(
					subscriptionStateManager,
					"transitionToFailed",
					() => Promise.resolve("trans-123"),
				);

				const err = await assertRejects(() =>
					(service as any).handleSubscriptionRequested(mockEvent)
				);
				assertEquals(err, appError);

				stateStub.restore();
				killBillStub.restore();
				failStub.restore();
			},
		);

		await t.step(
			"handleSubscriptionRequested - Idempotent Retry",
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

				const killBillStub = stub(
					killBillService,
					"getOrCreateAccount",
					() =>
						Promise.resolve({
							account: {
								accountId: "kb-acc-123",
								name: "Test User",
								email: "test@example.com",
								externalKey: "user-123",
								currency: "USD",
							},
							isNewAccount: true,
						}),
				);
				const transitionStub = stub(
					subscriptionStateManager,
					"transitionToAccountReady",
					() => Promise.resolve("trans-123"),
				);
				const publishStub = stub(
					RabbitMQClient.prototype,
					"publishEvent",
					() => Promise.resolve(),
				);

				await (service as any).handleSubscriptionRequested(mockEvent);

				assertSpyCalls(killBillStub, 1);

				stateStub.restore();
				killBillStub.restore();
				transitionStub.restore();
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

			const svc = new AccountService();
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

				const svc = new AccountService();
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

			const svc = new AccountService();
			await svc.start();

			const handleStub = stub(
				svc as any,
				"handleSubscriptionRequested",
				() => Promise.resolve(),
			);

			await capturedCallback({
				type: "SubscriptionRequested",
				userId: "123",
			});
			assertSpyCalls(handleStub, 1);
			assertEquals(svc.getStatus().events_processed, 1);

			await capturedCallback({ type: "OtherEvent" });
			assertSpyCalls(handleStub, 1);

			handleStub.restore();
			const handleStub2 = stub(
				svc as any,
				"handleSubscriptionRequested",
				() => Promise.reject(new Error("fail")),
			);
			await assertRejects(() =>
				capturedCallback({
					type: "SubscriptionRequested",
					userId: "123",
				})
			);

			connectStub.restore();
			consumeStub.restore();
			handleStub2.restore();
		});
	},
});
