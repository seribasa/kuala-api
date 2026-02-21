// deno-lint-ignore-file
import { assertEquals, assertRejects } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { SubscriptionService } from "../subscription-service.ts";
import { killBillService } from "@shared/services/killbill.ts";
import { subscriptionStateManager } from "@shared/services/subscription-state-management.ts";
import { RabbitMQClient } from "@shared/rabbitmq.ts";
import { AccountReadyEvent } from "@shared/types/events.ts";
import { ApplicationError } from "@shared/errors/index.ts";

Deno.test({
	name: "SubscriptionService Tests",
	async fn(t) {
		const service = new SubscriptionService();

		const mockEvent: AccountReadyEvent = {
			eventId: "evt-123",
			correlationId: "corr-123",
			timestamp: new Date().toISOString(),
			type: "AccountReady",
			userId: "user-123",
			accountId: "kb-acc-123",
			name: "Test User",
			email: "test@example.com",
			currency: "USD",
			planId: "plan-123",
			metadata: { createdNew: true },
		};

		await t.step("handleAccountReady - Idempotent SKIP", async () => {
			const stateStub = stub(
				subscriptionStateManager,
				"getCurrentState",
				() =>
					Promise.resolve({
						current_state: "subscription_created",
						entity_type: "subscription_request",
						entity_id: "corr-123",
						state_updated_at: new Date().toISOString(),
						last_updated_by: "system",
					}),
			);

			// deno-lint-ignore no-explicit-any
			await (service as any).handleAccountReady(mockEvent);

			assertSpyCalls(stateStub, 1);
			assertEquals(service.getStatus().events_skipped, 1);
			stateStub.restore();
		});

		await t.step(
			"handleAccountReady - Success (New Subscription)",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() => Promise.resolve(null),
				);

				const creatingStub = stub(
					subscriptionStateManager,
					"transitionToCreatingSubscription",
					() => Promise.resolve("trans-123"),
				);

				const getSubStub = stub(
					killBillService,
					"getSubscriptionByExternalId",
					() => Promise.resolve(null), // No existing subscription
				);

				const createSubStub = stub(
					killBillService,
					"createSubscription",
					() => Promise.resolve("sub-123"),
				);

				const createdStub = stub(
					subscriptionStateManager,
					"transitionToSubscriptionCreated",
					() => Promise.resolve("trans-124"),
				);

				const publishStub = stub(
					RabbitMQClient.prototype,
					"publishEvent",
					() => Promise.resolve(),
				);

				// deno-lint-ignore no-explicit-any
				await (service as any).handleAccountReady(mockEvent);

				assertSpyCalls(getSubStub, 1);
				assertSpyCalls(createSubStub, 1);
				assertSpyCalls(creatingStub, 1);
				assertSpyCalls(createdStub, 1);
				assertSpyCalls(publishStub, 1);

				stateStub.restore();
				creatingStub.restore();
				getSubStub.restore();
				createSubStub.restore();
				createdStub.restore();
				publishStub.restore();
			},
		);

		await t.step(
			"handleAccountReady - Success (Existing Cancelled Subscription)",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() => Promise.resolve(null),
				);

				const creatingStub = stub(
					subscriptionStateManager,
					"transitionToCreatingSubscription",
					() => Promise.resolve("trans-123"),
				);

				const getSubStub = stub(
					killBillService,
					"getSubscriptionByExternalId",
					() =>
						Promise.resolve({
							subscriptionId: "sub-123",
							accountId: "kb-acc-123",
							state: "CANCELLED",
							// Fill dummy data for required fields
							bundleId: "bundle-123",
							externalKey: "user-123",
							startDate: new Date().toISOString(),
							productName: "Test",
							productCategory: "Test",
							billingPeriod: "MONTHLY",
							priceList: "DEFAULT",
							planName: "Test",
							sourceType: "NATIVE",
							cancelledDate: new Date().toISOString(),
							chargedThroughDate: new Date().toISOString(),
							billingStartDate: new Date().toISOString(),
							billingEndDate: new Date().toISOString(),
							events: [],
							priceOverrides: [],
						}),
				);

				const uncancelStub = stub(
					killBillService,
					"uncancelSubscription",
					() => Promise.resolve(),
				);

				const createdStub = stub(
					subscriptionStateManager,
					"transitionToSubscriptionCreated",
					() => Promise.resolve("trans-124"),
				);

				const publishStub = stub(
					RabbitMQClient.prototype,
					"publishEvent",
					() => Promise.resolve(),
				);

				// deno-lint-ignore no-explicit-any
				await (service as any).handleAccountReady(mockEvent);

				assertSpyCalls(getSubStub, 1);
				assertSpyCalls(uncancelStub, 1);
				assertSpyCalls(creatingStub, 1);
				assertSpyCalls(createdStub, 1);
				assertSpyCalls(publishStub, 1);

				stateStub.restore();
				creatingStub.restore();
				getSubStub.restore();
				uncancelStub.restore();
				createdStub.restore();
				publishStub.restore();
			},
		);

		await t.step("handleAccountReady - Error handling", async () => {
			const stateStub = stub(
				subscriptionStateManager,
				"getCurrentState",
				() => Promise.resolve(null),
			);

			const creatingStub = stub(
				subscriptionStateManager,
				"transitionToCreatingSubscription",
				() => Promise.resolve("trans-123"),
			);

			const getSubStub = stub(
				killBillService,
				"getSubscriptionByExternalId",
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
				(service as any).handleAccountReady(mockEvent)
			);

			assertSpyCalls(getSubStub, 1);
			assertSpyCalls(failStub, 1);

			stateStub.restore();
			creatingStub.restore();
			getSubStub.restore();
			failStub.restore();
		});

		await t.step("handleAccountReady - Non-Error throwing", async () => {
			const stateStub = stub(
				subscriptionStateManager,
				"getCurrentState",
				() => Promise.resolve(null),
			);
			const creatingStub = stub(
				subscriptionStateManager,
				"transitionToCreatingSubscription",
				() => Promise.resolve("trans-123"),
			);
			const getSubStub = stub(
				killBillService,
				"getSubscriptionByExternalId",
				() => Promise.reject("String Error"),
			); // Not an Error object
			const failStub = stub(
				subscriptionStateManager,
				"transitionToFailed",
				() => Promise.resolve("trans-123"),
			);

			await assertRejects(() =>
				(service as any).handleAccountReady(mockEvent)
			);

			stateStub.restore();
			creatingStub.restore();
			getSubStub.restore();
			failStub.restore();
		});

		await t.step(
			"handleAccountReady - Success (Non-blocking State)",
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
				const creatingStub = stub(
					subscriptionStateManager,
					"transitionToCreatingSubscription",
					() => Promise.resolve("trans-123"),
				);
				const getSubStub = stub(
					killBillService,
					"getSubscriptionByExternalId",
					() => Promise.resolve(null),
				);
				const createSubStub = stub(
					killBillService,
					"createSubscription",
					() => Promise.resolve("sub-123"),
				);
				const createdStub = stub(
					subscriptionStateManager,
					"transitionToSubscriptionCreated",
					() => Promise.resolve("trans-124"),
				);
				const publishStub = stub(
					RabbitMQClient.prototype,
					"publishEvent",
					() => Promise.resolve(),
				);

				await (service as any).handleAccountReady(mockEvent);

				assertSpyCalls(createSubStub, 1);

				stateStub.restore();
				creatingStub.restore();
				getSubStub.restore();
				createSubStub.restore();
				createdStub.restore();
				publishStub.restore();
			},
		);

		await t.step(
			"handleAccountReady - createSubscription throws",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() => Promise.resolve(null),
				);
				const creatingStub = stub(
					subscriptionStateManager,
					"transitionToCreatingSubscription",
					() => Promise.resolve("trans-123"),
				);
				const getSubStub = stub(
					killBillService,
					"getSubscriptionByExternalId",
					() => Promise.resolve(null),
				);
				const createSubStub = stub(
					killBillService,
					"createSubscription",
					() => Promise.reject(new Error("KB Error")),
				);
				const failStub = stub(
					subscriptionStateManager,
					"transitionToFailed",
					() => Promise.resolve("trans-123"),
				);

				await assertRejects(() =>
					(service as any).handleAccountReady(mockEvent)
				);

				assertSpyCalls(createSubStub, 1);
				assertSpyCalls(failStub, 1);

				stateStub.restore();
				creatingStub.restore();
				getSubStub.restore();
				createSubStub.restore();
				failStub.restore();
			},
		);

		await t.step(
			"handleAccountReady - uncancelSubscription throws",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() => Promise.resolve(null),
				);
				const creatingStub = stub(
					subscriptionStateManager,
					"transitionToCreatingSubscription",
					() => Promise.resolve("trans-123"),
				);
				const getSubStub = stub(
					killBillService,
					"getSubscriptionByExternalId",
					() =>
						Promise.resolve({
							subscriptionId: "sub-123",
							state: "CANCELLED",
							accountId: "kb-acc-123",
							bundleId: "bundle-123",
							externalKey: "user-123",
							startDate: new Date().toISOString(),
							productName: "Test",
							productCategory: "Test",
							billingPeriod: "MONTHLY",
							priceList: "DEFAULT",
							planName: "Test",
							sourceType: "NATIVE",
							events: [],
							priceOverrides: [],
						} as any),
				);
				const uncancelStub = stub(
					killBillService,
					"uncancelSubscription",
					() => Promise.reject(new Error("KB Error")),
				);
				const failStub = stub(
					subscriptionStateManager,
					"transitionToFailed",
					() => Promise.resolve("trans-123"),
				);

				await assertRejects(() =>
					(service as any).handleAccountReady(mockEvent)
				);

				assertSpyCalls(uncancelStub, 1);
				assertSpyCalls(failStub, 1);

				stateStub.restore();
				creatingStub.restore();
				getSubStub.restore();
				uncancelStub.restore();
				failStub.restore();
			},
		);

		await t.step(
			"handleAccountReady - Recovery creating_subscription but no existing",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() =>
						Promise.resolve({
							current_state: "creating_subscription",
							entity_type: "subscription_request",
							entity_id: "corr-123",
							state_updated_at: new Date().toISOString(),
							last_updated_by: "system",
						}),
				);
				const creatingStub = stub(
					subscriptionStateManager,
					"transitionToCreatingSubscription",
					() => Promise.resolve("trans-123"),
				);
				const getSubStub = stub(
					killBillService,
					"getSubscriptionByExternalId",
					() => Promise.resolve(null),
				);
				const createSubStub = stub(
					killBillService,
					"createSubscription",
					() => Promise.resolve("sub-124"),
				);
				const createdStub = stub(
					subscriptionStateManager,
					"transitionToSubscriptionCreated",
					() => Promise.resolve("trans-124"),
				);
				const publishStub = stub(
					RabbitMQClient.prototype,
					"publishEvent",
					() => Promise.resolve(),
				);

				await (service as any).handleAccountReady(mockEvent);

				assertSpyCalls(createSubStub, 1); // Should fall through and create it anyway!

				stateStub.restore();
				creatingStub.restore();
				getSubStub.restore();
				createSubStub.restore();
				createdStub.restore();
				publishStub.restore();
			},
		);

		await t.step(
			"handleAccountReady - ApplicationError rethrow",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() => Promise.resolve(null),
				);
				const creatingStub = stub(
					subscriptionStateManager,
					"transitionToCreatingSubscription",
					() => Promise.resolve("trans-123"),
				);

				const appError = new ApplicationError(
					"KILLBILL_CONNECTION_ERROR",
					"test",
					{ type: "TRANSIENT" as any, retryable: true },
				);
				const getSubStub = stub(
					killBillService,
					"getSubscriptionByExternalId",
					() => Promise.reject(appError),
				);

				const failStub = stub(
					subscriptionStateManager,
					"transitionToFailed",
					() => Promise.resolve("trans-123"),
				);

				const err = await assertRejects(() =>
					(service as any).handleAccountReady(mockEvent)
				);
				assertEquals(err, appError);

				stateStub.restore();
				creatingStub.restore();
				getSubStub.restore();
				failStub.restore();
			},
		);

		await t.step("handleAccountReady - Idempotent Retry", async () => {
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
			const creatingStub = stub(
				subscriptionStateManager,
				"transitionToCreatingSubscription",
				() => Promise.resolve("trans-123"),
			);
			const getSubStub = stub(
				killBillService,
				"getSubscriptionByExternalId",
				() => Promise.resolve(null),
			);
			const createSubStub = stub(
				killBillService,
				"createSubscription",
				() => Promise.resolve("sub-123"),
			);
			const createdStub = stub(
				subscriptionStateManager,
				"transitionToSubscriptionCreated",
				() => Promise.resolve("trans-124"),
			);
			const publishStub = stub(
				RabbitMQClient.prototype,
				"publishEvent",
				() => Promise.resolve(),
			);

			await (service as any).handleAccountReady(mockEvent);

			assertSpyCalls(createSubStub, 1);

			stateStub.restore();
			creatingStub.restore();
			getSubStub.restore();
			createSubStub.restore();
			createdStub.restore();
			publishStub.restore();
		});

		await t.step(
			"handleAccountReady - Idempotent Recovery from creating_subscription",
			async () => {
				const stateStub = stub(
					subscriptionStateManager,
					"getCurrentState",
					() =>
						Promise.resolve({
							current_state: "creating_subscription",
							entity_type: "subscription_request",
							entity_id: "corr-123",
							state_updated_at: new Date().toISOString(),
							last_updated_by: "system",
						}),
				);
				const getSubStub = stub(
					killBillService,
					"getSubscriptionByExternalId",
					() =>
						Promise.resolve({
							subscriptionId: "sub-123",
							state: "ACTIVE",
							accountId: "kb-acc-123",
							bundleId: "bundle-123",
							externalKey: "user-123",
							startDate: new Date().toISOString(),
							productName: "Test",
							productCategory: "Test",
							billingPeriod: "MONTHLY",
							priceList: "DEFAULT",
							planName: "Test",
							sourceType: "NATIVE",
							events: [],
							priceOverrides: [],
						} as any),
				);
				const createdStub = stub(
					subscriptionStateManager,
					"transitionToSubscriptionCreated",
					() => Promise.resolve("trans-124"),
				);
				const publishStub = stub(
					RabbitMQClient.prototype,
					"publishEvent",
					() => Promise.resolve(),
				);

				await (service as any).handleAccountReady(mockEvent);

				assertSpyCalls(getSubStub, 1);
				assertSpyCalls(createdStub, 1);
				assertSpyCalls(publishStub, 1);

				stateStub.restore();
				getSubStub.restore();
				createdStub.restore();
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

			const svc = new SubscriptionService();
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

				const svc = new SubscriptionService();
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

			const svc = new SubscriptionService();
			await svc.start();

			const handleStub = stub(
				svc as any,
				"handleAccountReady",
				() => Promise.resolve(),
			);

			await capturedCallback({ type: "AccountReady", userId: "123" });
			assertSpyCalls(handleStub, 1);
			assertEquals(svc.getStatus().events_processed, 1);

			await capturedCallback({ type: "OtherEvent" });
			assertSpyCalls(handleStub, 1);

			handleStub.restore();
			const handleStub2 = stub(
				svc as any,
				"handleAccountReady",
				() => Promise.reject(new Error("fail")),
			);
			await assertRejects(() =>
				capturedCallback({ type: "AccountReady", userId: "123" })
			);

			connectStub.restore();
			consumeStub.restore();
			handleStub2.restore();
		});
	},
});
