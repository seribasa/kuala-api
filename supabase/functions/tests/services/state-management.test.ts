import { assertEquals, assertRejects } from "@std/assert";
import { beforeEach, describe, it } from "@std/testing/bdd";
import { returnsNext, stub } from "@std/testing/mock";

import {
	InvalidStateTransitionError,
	isValidTransition,
	StateManagementService,
} from "../../_shared/services/state-management.ts";

describe("StateManagementService Transitions & Validation", () => {
	describe("isValidTransition", () => {
		it("should return true for valid transitions", () => {
			assertEquals(isValidTransition("", "requested"), true);
			assertEquals(isValidTransition("requested", "account_ready"), true);
			assertEquals(
				isValidTransition("account_ready", "creating_subscription"),
				true,
			);
			assertEquals(
				isValidTransition("creating_subscription", "failed"),
				true,
			);
		});

		it("should return false for invalid transitions", () => {
			assertEquals(isValidTransition("requested", "completed"), false);
			assertEquals(
				isValidTransition("completed", "account_ready"),
				false,
			);
		});

		it("should allow any transition for unknown from_state", () => {
			assertEquals(
				isValidTransition("some_unknown_state", "requested"),
				true,
			);
		});

		it("should return true if entityType is not subscription_request", () => {
			assertEquals(
				isValidTransition("completed", "requested", "other_entity"),
				true,
			);
		});
	});

	describe("StateManagementService API", () => {
		let service: StateManagementService;
		// deno-lint-ignore no-explicit-any
		let mockSupabase: any;

		beforeEach(() => {
			service = new StateManagementService();
			// Mock supabase client
			mockSupabase = {
				rpc: () => ({ data: "mock-id", error: null }),
				from: () => mockSupabase,
				select: () => mockSupabase,
				eq: () => mockSupabase,
				maybeSingle: () => ({
					data: { current_state: "requested" },
					error: null,
				}),
				contains: () => mockSupabase,
				gte: () => mockSupabase,
				lte: () => mockSupabase,
			};
			// deno-lint-ignore no-explicit-any
			(service as any).supabase = mockSupabase;
		});

		it("transitionState - throws InvalidStateTransitionError if validation fails", async () => {
			// current state is "requested"
			await assertRejects(
				() =>
					service.transitionState(
						"subscription_request",
						"id1",
						"completed",
					),
				InvalidStateTransitionError,
			);
		});

		it("transitionState - valid transition succeeds", async () => {
			const rpcStub = stub(
				mockSupabase,
				"rpc",
				returnsNext([{ data: "mock-id", error: null }]),
			);
			const result = await service.transitionState(
				"subscription_request",
				"id1",
				"account_ready",
			);
			assertEquals(result, "mock-id");
			rpcStub.restore();
		});

		it("transitionState - throws error on RPC failure", async () => {
			// current state is "requested"
			const rpcStub = stub(
				mockSupabase,
				"rpc",
				returnsNext([{ data: null, error: new Error("RPC Error") }]),
			);
			await assertRejects(
				() =>
					service.transitionState(
						"subscription_request",
						"id1",
						"account_ready",
					),
				Error,
				"Failed to transition state: RPC Error",
			);
			rpcStub.restore();
		});

		it("getCurrentState - succeeds", async () => {
			const maybeSingleStub = stub(
				mockSupabase,
				"maybeSingle",
				returnsNext([{
					data: { current_state: "running" },
					error: null,
				}]),
			);
			const state = await service.getCurrentState("entity", "id1");
			assertEquals(state?.current_state, "running");
			maybeSingleStub.restore();
		});

		it("getCurrentState - throws on error", async () => {
			const maybeSingleStub = stub(
				mockSupabase,
				"maybeSingle",
				returnsNext([{ data: null, error: new Error("DB Err") }]),
			);
			await assertRejects(() => service.getCurrentState("entity", "id1"));
			maybeSingleStub.restore();
		});

		it("getStateHistory - succeeds", async () => {
			const rpcStub = stub(
				mockSupabase,
				"rpc",
				returnsNext([{ data: [{ to_state: "ready" }], error: null }]),
			);
			const hist = await service.getStateHistory("entity", "id1");
			assertEquals(hist.length, 1);
			rpcStub.restore();
		});

		it("getStateHistory - throws on error", async () => {
			const rpcStub = stub(
				mockSupabase,
				"rpc",
				returnsNext([{ data: null, error: new Error("DB Err") }]),
			);
			await assertRejects(() => service.getStateHistory("entity", "id1"));
			rpcStub.restore();
		});

		it("isInState - returns boolean", async () => {
			const maybeSingleStub = stub(
				mockSupabase,
				"maybeSingle",
				returnsNext([{
					data: { current_state: "running" },
					error: null,
				}]),
			);
			const res = await service.isInState("entity", "id1", "running");
			assertEquals(res, true);
			maybeSingleStub.restore();
		});

		it("isInAnyState - returns boolean", async () => {
			const maybeSingleStub = stub(
				mockSupabase,
				"maybeSingle",
				returnsNext([{
					data: { current_state: "running" },
					error: null,
				}]),
			);
			const res = await service.isInAnyState("entity", "id1", [
				"running",
				"failed",
			]);
			assertEquals(res, true);
			maybeSingleStub.restore();
		});

		it("getEntitiesInState - returns entities", async () => {
			mockSupabase.eq = () => ({
				eq: () => Promise.resolve({ data: [{ id: 1 }], error: null }),
			});
			const res = await service.getEntitiesInState("entity", "state1");
			assertEquals(res.length, 1);
		});

		it("getEntitiesInState - throws on error", async () => {
			mockSupabase.eq = () => ({
				eq: () =>
					Promise.resolve({ data: null, error: new Error("DB ERR") }),
			});
			await assertRejects(() =>
				service.getEntitiesInState("entity", "state1")
			);
		});

		it("getStateStatistics - computes stats", async () => {
			const lteStub = stub(
				mockSupabase,
				"lte",
				returnsNext([{
					data: [{ to_state: "A" }, { to_state: "A" }, {
						to_state: "B",
					}],
					error: null,
				}]),
			);
			const qs = service.getStateStatistics("entity", "2020", "2021");
			const stats = await qs;
			assertEquals(stats["A"], 2);
			assertEquals(stats["B"], 1);
			lteStub.restore();
		});

		it("getStateStatistics - throws on error", async () => {
			const queryPromise = Promise.resolve({
				data: null,
				error: new Error("err"),
			});
			// Mocking the query directly returning the promise
			mockSupabase.eq = () => mockSupabase;
			mockSupabase.gte = () => mockSupabase;
			mockSupabase.lte = () => queryPromise;

			await assertRejects(() =>
				service.getStateStatistics("entity", "2020", "2021")
			);
		});

		it("getEntitiesByMetadata - returns data", async () => {
			const containsStub = stub(
				mockSupabase,
				"contains",
				returnsNext([{ data: [{ id: 1 }], error: null }]),
			);
			const res = await service.getEntitiesByMetadata(
				"entity",
				"userId",
				"user1",
			);
			assertEquals(res.length, 1);
			containsStub.restore();
		});

		it("getEntitiesByMetadata - throws on error", async () => {
			const containsStub = stub(
				mockSupabase,
				"contains",
				returnsNext([{ data: null, error: new Error("err") }]),
			);
			await assertRejects(() =>
				service.getEntitiesByMetadata("entity", "userId", "user1")
			);
			containsStub.restore();
		});

		it("bulkTransition - returns array of transitionIds and gracefully handles errors for some", async () => {
			// Current state is requested.
			const rpcStub = stub(
				mockSupabase,
				"rpc",
				returnsNext([
					{ data: "t1", error: null },
					{ data: null, error: new Error("RPC error") },
					{ data: "t3", error: null },
				]),
			);
			const serviceNoVal = new StateManagementService({
				validateTransitions: false,
			});
			// deno-lint-ignore no-explicit-any
			(serviceNoVal as any).supabase = mockSupabase;

			const res = await serviceNoVal.bulkTransition("subs", [
				"id1",
				"id2",
				"id3",
			], "account_ready");
			assertEquals(res.length, 2);
			assertEquals(res, ["t1", "t3"]);
			rpcStub.restore();
		});

		it("waitForState - should resolve when state reached", async () => {
			const maybeSingleStub = stub(
				mockSupabase,
				"maybeSingle",
				returnsNext([{
					data: { current_state: "target" },
					error: null,
				}]),
			);
			const res = await service.waitForState(
				"entity",
				"id",
				"target",
				1000,
				10,
			);
			assertEquals(res?.current_state, "target");
			maybeSingleStub.restore();
		});

		it("waitForState - should reject on timeout", async () => {
			const maybeSingleStub = stub(
				mockSupabase,
				"maybeSingle",
				returnsNext([{
					data: { current_state: "other" },
					error: null,
				}]),
			);
			await assertRejects(() =>
				service.waitForState("entity", "id", "target", 10, 1)
			);
			maybeSingleStub.restore();
		});

		it("waitForState - should reject on failed state", async () => {
			const maybeSingleStub = stub(
				mockSupabase,
				"maybeSingle",
				returnsNext([{
					data: { current_state: "failed" },
					error: null,
				}]),
			);
			await assertRejects(() =>
				service.waitForState("entity", "id", "target", 100, 10)
			);
			maybeSingleStub.restore();
		});

		it("waitForState - should reject on cancelled state", async () => {
			const maybeSingleStub = stub(
				mockSupabase,
				"maybeSingle",
				returnsNext([{
					data: { current_state: "cancelled" },
					error: null,
				}]),
			);
			await assertRejects(() =>
				service.waitForState("entity", "id", "target", 100, 10)
			);
			maybeSingleStub.restore();
		});
	});
});
