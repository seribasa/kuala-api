import {
	assertEquals,
	assertRejects,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
	afterEach,
	beforeEach,
	describe,
	it,
} from "https://deno.land/std@0.224.0/testing/bdd.ts";
import {
	assertSpyCalls,
	returnsNext,
	stub,
} from "https://deno.land/std@0.224.0/testing/mock.ts";

import { subscriptionStateManager } from "../../_shared/services/subscription-state-management.ts";
import { stateManager } from "../../_shared/services/state-management.ts";

describe("subscriptionStateManager Transitions", () => {
    let transitionStateStub: any;

    beforeEach(() => {
        transitionStateStub = stub(
            stateManager,
            "transitionState",
            returnsNext([Promise.resolve("test-id")]),
        );
    });

    afterEach(() => {
        transitionStateStub.restore();
    });

    it("transitionToAccountReady", async () => {
        await subscriptionStateManager.transitionToAccountReady("corr", {});
        assertSpyCalls(transitionStateStub, 1);
        assertEquals(transitionStateStub.calls[0].args[2], "account_ready");
    });

    it("transitionToCreatingSubscription", async () => {
        await subscriptionStateManager.transitionToCreatingSubscription("corr", {});
        assertSpyCalls(transitionStateStub, 1);
        assertEquals(transitionStateStub.calls[0].args[2], "creating_subscription");
    });

    it("transitionToSubscriptionCreated", async () => {
        await subscriptionStateManager.transitionToSubscriptionCreated("corr", {});
        assertSpyCalls(transitionStateStub, 1);
        assertEquals(transitionStateStub.calls[0].args[2], "subscription_created");
    });

    it("transitionToGeneratingInvoice", async () => {
        await subscriptionStateManager.transitionToGeneratingInvoice("corr", {});
        assertSpyCalls(transitionStateStub, 1);
        assertEquals(transitionStateStub.calls[0].args[2], "generating_invoice");
    });

    it("transitionToCompleted", async () => {
        const releaseLockStub = stub(subscriptionStateManager, "releaseUserLockByCorrelation", returnsNext([Promise.resolve(true)]));
        await subscriptionStateManager.transitionToCompleted("corr", {});
        assertSpyCalls(transitionStateStub, 1);
        assertEquals(transitionStateStub.calls[0].args[2], "completed");
        assertSpyCalls(releaseLockStub, 1);
        releaseLockStub.restore();
    });

    it("transitionToCompleted - handles lock release error", async () => {
        const releaseLockStub = stub(subscriptionStateManager, "releaseUserLockByCorrelation", returnsNext([Promise.reject(new Error("Fail"))]));
        // Should not throw
        await subscriptionStateManager.transitionToCompleted("corr", {});
        assertSpyCalls(transitionStateStub, 1);
        assertSpyCalls(releaseLockStub, 1);
        releaseLockStub.restore();
    });

    it("transitionToFailed", async () => {
        await subscriptionStateManager.transitionToFailed("corr", "err message", {});
        assertSpyCalls(transitionStateStub, 1);
        assertEquals(transitionStateStub.calls[0].args[2], "failed");
        assertEquals(transitionStateStub.calls[0].args[3].errorDetails.message, "err message");
    });

    it("transitionState - direct pass through", async () => {
        await subscriptionStateManager.transitionState("type", "id", "toState", {});
        assertSpyCalls(transitionStateStub, 1);
    });
});

describe("subscriptionStateManager Queries", () => {
    afterEach(() => {
        if ((stateManager as any).getCurrentState.restore) (stateManager as any).getCurrentState.restore();
        if ((stateManager as any).getStateHistory.restore) (stateManager as any).getStateHistory.restore();
        if ((stateManager as any).getEntitiesByMetadata.restore) (stateManager as any).getEntitiesByMetadata.restore();
    });

    it("getCurrentState", async () => {
        const _stub = stub(stateManager, "getCurrentState", returnsNext([Promise.resolve({current_state: "c"} as any)]));
        const res = await subscriptionStateManager.getCurrentState("corr1");
        assertSpyCalls(_stub, 1);
        assertEquals(res?.current_state, "c");
    });

    it("getHistory", async () => {
        const _stub = stub(stateManager, "getStateHistory", returnsNext([Promise.resolve([{to_state: "t"}] as any)]));
        const res = await subscriptionStateManager.getHistory("corr1");
        assertSpyCalls(_stub, 1);
        assertEquals(res[0].to_state, "t");
    });

    it("hasPendingSubscriptionRequest - true", async () => {
        const _stub = stub(stateManager, "getEntitiesByMetadata", returnsNext([Promise.resolve([{current_state: "requested"} as any])]));
        const res = await subscriptionStateManager.hasPendingSubscriptionRequest("u1");
        assertEquals(res, true);
    });

    it("hasPendingSubscriptionRequest - false", async () => {
        const _stub = stub(stateManager, "getEntitiesByMetadata", returnsNext([Promise.resolve([{current_state: "completed"} as any])]));
        const res = await subscriptionStateManager.hasPendingSubscriptionRequest("u1");
        assertEquals(res, false);
    });

    it("getLatestSubscriptionRequest - null", async () => {
        const _stub = stub(stateManager, "getEntitiesByMetadata", returnsNext([Promise.resolve([])]));
        const res = await subscriptionStateManager.getLatestSubscriptionRequest("u1");
        assertEquals(res, null);
    });

    it("getLatestSubscriptionRequest - sorts dates", async () => {
        const entities = [
            {state_updated_at: "2020-01-01T00:00:00Z"},
            {state_updated_at: "2021-01-01T00:00:00Z"},
            {state_updated_at: "2019-01-01T00:00:00Z"}
        ];
        const _stub = stub(stateManager, "getEntitiesByMetadata", returnsNext([Promise.resolve(entities as any)]));
        const res = await subscriptionStateManager.getLatestSubscriptionRequest("u1");
        assertEquals(res?.state_updated_at, "2021-01-01T00:00:00Z");
    });
});

describe("subscriptionStateManager Locks", () => {
    // To mock the local supabase client, we can monkey-patch fetch since supabase-js uses it under the hood.
    // Or we just rely on fetch mock.
    let fetchStub: any;

    beforeEach(() => {
        fetchStub = stub(globalThis, "fetch", returnsNext([
            Promise.resolve(new Response(JSON.stringify(true), { status: 200, headers: { "Content-Type": "application/json" } }))
        ]));
    });

    afterEach(() => {
        fetchStub.restore();
    });

    it("acquireUserLock", async () => {
        fetchStub.restore();
        fetchStub = stub(globalThis, "fetch", returnsNext([
            Promise.resolve(new Response(JSON.stringify("mock_data"), { status: 200, headers: { "Content-Type": "application/json" } }))
        ]));
        const res = await subscriptionStateManager.acquireUserLock("u", "c");
        assertEquals(res, "mock_data");
    });

    it("acquireUserLock - error", async () => {
        fetchStub.restore();
        fetchStub = stub(globalThis, "fetch", returnsNext([
            Promise.resolve(new Response(JSON.stringify({message: "err"}), { status: 400, headers: { "Content-Type": "application/json" } }))
        ]));
        await assertRejects(() => subscriptionStateManager.acquireUserLock("u", "c"));
    });

    it("releaseUserLock", async () => {
        const res = await subscriptionStateManager.releaseUserLock("u");
        assertEquals(res, true);
    });
    
    it("releaseUserLock - error", async () => {
        fetchStub.restore();
        fetchStub = stub(globalThis, "fetch", returnsNext([
            Promise.resolve(new Response(JSON.stringify({message: "err"}), { status: 400, headers: { "Content-Type": "application/json" } }))
        ]));
        await assertRejects(() => subscriptionStateManager.releaseUserLock("u"));
    });

    it("releaseUserLockByCorrelation", async () => {
        const res = await subscriptionStateManager.releaseUserLockByCorrelation("c");
        assertEquals(res, true);
    });
    
    it("releaseUserLockByCorrelation - error", async () => {
        fetchStub.restore();
        fetchStub = stub(globalThis, "fetch", returnsNext([
            Promise.resolve(new Response(JSON.stringify({message: "err"}), { status: 400, headers: { "Content-Type": "application/json" } }))
        ]));
        await assertRejects(() => subscriptionStateManager.releaseUserLockByCorrelation("c"));
    });

    it("getActiveRequest", async () => {
         fetchStub.restore();
         fetchStub = stub(globalThis, "fetch", returnsNext([
            Promise.resolve(new Response(JSON.stringify([{correlation_id: "123", created_at: "date"}]), { status: 200, headers: { "Content-Type": "application/json" } }))
        ]));
        const res = await subscriptionStateManager.getActiveRequest("u");
        assertEquals(res?.correlation_id, "123");
    });

    it("getActiveRequest - null", async () => {
         fetchStub.restore();
         fetchStub = stub(globalThis, "fetch", returnsNext([
            Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }))
        ]));
        const res = await subscriptionStateManager.getActiveRequest("u");
        assertEquals(res, null);
    });

    it("getActiveRequest - error", async () => {
        fetchStub.restore();
        fetchStub = stub(globalThis, "fetch", returnsNext([
            Promise.resolve(new Response(JSON.stringify({message: "err"}), { status: 400, headers: { "Content-Type": "application/json" } }))
        ]));
        await assertRejects(() => subscriptionStateManager.getActiveRequest("u"));
    });
});
