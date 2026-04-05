import {
	assertEquals,
	assertExists,
} from "@std/assert";
import {
	afterEach,
	beforeEach,
	describe,
	it,
} from "@std/testing/bdd";
import {
	assertSpyCalls,
	returnsNext,
	stub,
} from "@std/testing/mock";

import {
	buildCompensationContext,
	compensationActions,
	executeCompensation,
} from "../../_shared/errors/compensation.ts";
import { killBillService } from "../../_shared/services/killbill.ts";
import { subscriptionStateManager } from "../../_shared/services/subscription-state-management.ts";

// Create a mock logger
const mockLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
};

describe("compensationActions", () => {
    // deno-lint-ignore no-explicit-any
    let cancelSubscriptionStub: any;
    // deno-lint-ignore no-explicit-any
    let voidInvoiceStub: any;

    beforeEach(() => {
        cancelSubscriptionStub = stub(
            killBillService,
            "cancelSubscription",
            returnsNext([Promise.resolve()]),
        );
        voidInvoiceStub = stub(
            killBillService,
            "voidInvoice",
            returnsNext([Promise.resolve()]),
        );
    });

    afterEach(() => {
        cancelSubscriptionStub.restore();
        voidInvoiceStub.restore();
    });

    describe("accountReady", () => {
        it("should return success without action", () => {
            const context = buildCompensationContext("corr1", "account_ready", "error", {});
            const result = compensationActions.accountReady(context, {}, mockLogger);
            assertEquals(result.success, true);
        });
    });

    describe("subscriptionCreated", () => {
        it("should return false if no subscriptionId is provided", async () => {
            const context = buildCompensationContext("corr1", "subscription_created", "error", {});
            const result = await compensationActions.subscriptionCreated(context, {}, mockLogger);
            assertEquals(result.success, false);
            assertSpyCalls(cancelSubscriptionStub, 0);
        });

        it("should preserve for debugging if flag is set", async () => {
            const context = buildCompensationContext("corr1", "subscription_created", "error", { subscriptionId: "sub1" });
            const result = await compensationActions.subscriptionCreated(context, { preserveForDebugging: true }, mockLogger);
            assertEquals(result.success, true);
            assertSpyCalls(cancelSubscriptionStub, 0);
        });

        it("should cancel subscription on failure", async () => {
            const context = buildCompensationContext("corr1", "subscription_created", "error", { subscriptionId: "sub1" });
            const result = await compensationActions.subscriptionCreated(context, {}, mockLogger);
            assertEquals(result.success, true);
            assertSpyCalls(cancelSubscriptionStub, 1);
        });

        it("should return false when cancel fails", async () => {
            cancelSubscriptionStub.restore();
            cancelSubscriptionStub = stub(
                killBillService,
                "cancelSubscription",
                returnsNext([Promise.reject(new Error("Cancel failed"))]),
            );
            const context = buildCompensationContext("corr1", "subscription_created", "error", { subscriptionId: "sub1" });
            const result = await compensationActions.subscriptionCreated(context, {}, mockLogger);
            assertEquals(result.success, false);
            assertExists(result.error);
        });
    });

    describe("generatingInvoice", () => {
        it("should void invoice and cancel subscription", async () => {
            const context = buildCompensationContext("corr1", "generating_invoice", "error", { 
                subscriptionId: "sub1", 
                invoiceId: "inv1" 
            });
            const result = await compensationActions.generatingInvoice(context, {}, mockLogger);
            assertEquals(result.success, true);
            assertSpyCalls(voidInvoiceStub, 1);
            assertSpyCalls(cancelSubscriptionStub, 1);
        });

        it("should return false if invoice void fails", async () => {
            voidInvoiceStub.restore();
            voidInvoiceStub = stub(
                killBillService,
                "voidInvoice",
                returnsNext([Promise.reject(new Error("Void failed"))]),
            );
            const context = buildCompensationContext("corr1", "generating_invoice", "error", { 
                subscriptionId: "sub1", 
                invoiceId: "inv1" 
            });
            const result = await compensationActions.generatingInvoice(context, {}, mockLogger);
            assertEquals(result.success, false);
            assertSpyCalls(voidInvoiceStub, 1);
            assertSpyCalls(cancelSubscriptionStub, 1); // still tries to cancel subscription
        });
    });
});

describe("executeCompensation", () => {
    // deno-lint-ignore no-explicit-any
    let cancelSubscriptionStub: any;
    // deno-lint-ignore no-explicit-any
    let transitionStateStub: any;

    beforeEach(() => {
        cancelSubscriptionStub = stub(
            killBillService,
            "cancelSubscription",
            returnsNext([Promise.resolve()]),
        );
        transitionStateStub = stub(
            subscriptionStateManager,
            "transitionState",
            returnsNext([Promise.resolve("audit_id")]),
        );
    });

    afterEach(() => {
        cancelSubscriptionStub.restore();
        transitionStateStub.restore();
    });

    it("should handle requested state", async () => {
        const context = buildCompensationContext("c1", "requested", "e", {});
        const result = await executeCompensation(context, {}, mockLogger);
        assertEquals(result.success, true);
        assertSpyCalls(transitionStateStub, 0);
    });

    it("should handle account_ready state", async () => {
        const context = buildCompensationContext("c1", "account_ready", "e", {});
        const result = await executeCompensation(context, {}, mockLogger);
        assertEquals(result.success, true);
    });

    it("should handle creating_subscription state", async () => {
        const context = buildCompensationContext("c1", "creating_subscription", "e", { subscriptionId: "s1" });
        const result = await executeCompensation(context, {}, mockLogger);
        assertEquals(result.success, true);
        assertSpyCalls(cancelSubscriptionStub, 1);
    });

    it("should handle unknown state", async () => {
        const context = buildCompensationContext("c1", "unknown_state", "e", {});
        const result = await executeCompensation(context, {}, mockLogger);
        assertEquals(result.success, false);
    });

    it("should record transition if markAsCancelled is true and success is true", async () => {
        const context = buildCompensationContext("c1", "account_ready", "e", {});
        const result = await executeCompensation(context, { markAsCancelled: true }, mockLogger);
        assertEquals(result.success, true);
        assertSpyCalls(transitionStateStub, 1);
    });

    it("should continue if transition state fails", async () => {
        transitionStateStub.restore();
        transitionStateStub = stub(
            subscriptionStateManager,
            "transitionState",
            returnsNext([Promise.reject(new Error("DB error"))]),
        );
        const context = buildCompensationContext("c1", "account_ready", "e", {});
        const result = await executeCompensation(context, { markAsCancelled: true }, mockLogger);
        assertEquals(result.success, true); // Still returns true despite db err
        assertSpyCalls(transitionStateStub, 1);
    });
});
