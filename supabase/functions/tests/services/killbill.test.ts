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

import { KillBillService, killBillService } from "../../_shared/services/killbill.ts";

describe("KillBillService", () => {
    let fetchStub: any;

    beforeEach(() => {
        fetchStub = stub(globalThis, "fetch", returnsNext([
            Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: new Headers() }))
        ]));
    });

    afterEach(() => {
        fetchStub.restore();
    });

    describe("getOrCreateAccount", () => {
        it("returns existing account", async () => {
            fetchStub.restore();
            fetchStub = stub(globalThis, "fetch", returnsNext([
                Promise.resolve(new Response(JSON.stringify({accountId: "acc-1"}), { status: 200 }))
            ]));

            const res = await killBillService.getOrCreateAccount("u1", "test@test.com");
            assertEquals(res.isNewAccount, false);
            assertEquals(res.account.accountId, "acc-1");
        });

        it("creates new account when not exists", async () => {
            fetchStub.restore();
            fetchStub = stub(globalThis, "fetch", returnsNext([
                Promise.resolve(new Response(null, { status: 404 })), // GET by id
                Promise.resolve(new Response(null, { status: 201, headers: new Headers({"Location": "http://loc/acc-2"}) })), // POST create
                Promise.resolve(new Response(JSON.stringify({accountId: "acc-2"}), { status: 200 })) // GET location
            ]));

            const res = await killBillService.getOrCreateAccount("u2", "test2@test.com");
            assertEquals(res.isNewAccount, true);
            assertEquals(res.account.accountId, "acc-2");
        });
    });

    describe("getAccountByExternalKey", () => {
        it("handles fetch failure", async () => {
            fetchStub.restore();
            fetchStub = stub(globalThis, "fetch", returnsNext([
                Promise.reject(new Error("Network err"))
            ]));
            
            const res = await killBillService.getAccountByExternalKey("u2");
            assertEquals(res, null);
        });

        it("throws if create failure", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(null, { status: 500 }))
             ]));
             
             await assertRejects(() => killBillService.getAccountByExternalKey("u1"), Error, "Failed to get account: 500");
        });
    });

    describe("createAccount", () => {
        it("throws if create fails", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response("err msg", { status: 400 }))
             ]));
             
             await assertRejects(() => killBillService.createAccount("u1", "test@t.com"), Error, "Failed to create Kill Bill account: 400");
        });

        it("throws if no location header", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(null, { status: 201 }))
             ]));
             
             await assertRejects(() => killBillService.createAccount("u1", "test@t.com"), Error, "Failed to get account location");
        });

        it("throws if fetch details fails", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(null, { status: 201, headers: new Headers({"Location": "http://loc"}) })),
                 Promise.resolve(new Response(null, { status: 500 }))
             ]));
             
             await assertRejects(() => killBillService.createAccount("u1", "test@t.com"), Error, "Failed to fetch account details");
        });
    });

    describe("getSubscriptionById", () => {
        it("success", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(JSON.stringify({subscriptionId: "sub-1"}), { status: 200 }))
             ]));
             const req = await killBillService.getSubscriptionById("sub-1");
             assertEquals(req.subscriptionId, "sub-1");
        });

        it("404", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(null, { status: 404 }))
             ]));
             await assertRejects(() => killBillService.getSubscriptionById("sub-1"), Error, "SUBSCRIPTION_NOT_FOUND");
        });

        it("other error", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(null, { status: 500 }))
             ]));
             await assertRejects(() => killBillService.getSubscriptionById("sub-1"), Error, "Failed to get subscription: 500");
        });
    });

    describe("getSubscriptionByExternalId", () => {
        it("other error", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(null, { status: 500 }))
             ]));
             await assertRejects(() => killBillService.getSubscriptionByExternalId("sub-1"), Error, "Failed to get account subscriptions: 500");
        });
    });

    describe("hasActiveSubscription", () => {
        it("false on fetch error", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.reject(new Error("Net err"))
             ]));
             const req = await killBillService.hasActiveSubscription("sub-1");
             assertEquals(req.hasActive, false);
        });

        it("true on active", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(JSON.stringify({state: "ACTIVE"}), { status: 200 }))
             ]));
             const req = await killBillService.hasActiveSubscription("sub-1");
             assertEquals(req.hasActive, true);
        });

        it("false on non active", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(JSON.stringify({state: "CANCELLED"}), { status: 200 }))
             ]));
             const req = await killBillService.hasActiveSubscription("sub-1");
             assertEquals(req.hasActive, false);
        });
    });
    
    describe("verifySubscriptionOwnership", () => {
        it("returns true", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(JSON.stringify({accountId: "acc-1", subscriptionId: "s"}), { status: 200 })),
                 Promise.resolve(new Response(JSON.stringify({accountId: "acc-1"}), { status: 200 })),
             ]));
             const req = await killBillService.verifySubscriptionOwnership("s", "u");
             assertEquals(req, true);
        });
        it("returns false on mismatch", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(JSON.stringify({accountId: "acc-1", subscriptionId: "s"}), { status: 200 })),
                 Promise.resolve(new Response(JSON.stringify({accountId: "acc-wrong"}), { status: 200 })),
             ]));
             const req = await killBillService.verifySubscriptionOwnership("s", "u");
             assertEquals(req, false);
        });
        it("returns false on error", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.reject(new Error("Err"))
             ]));
             const req = await killBillService.verifySubscriptionOwnership("s", "u");
             assertEquals(req, false);
        });
    });

    describe("getActiveSubscription", () => {
        it("returns sub if ACTIVE", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(JSON.stringify({state: "ACTIVE"}), { status: 200 }))
             ]));
             const req = await killBillService.getActiveSubscription("sub-1");
             assertEquals(req?.state, "ACTIVE");
        });
        it("returns null if not active", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(JSON.stringify({state: "C"}), { status: 200 }))
             ]));
             const req = await killBillService.getActiveSubscription("sub-1");
             assertEquals(req, null);
        });
    });

    describe("createSubscription", () => {
        it("success", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(null, { status: 201, headers: new Headers({"Location": "http://loc/sub-1"}) }))
             ]));
             const req = await killBillService.createSubscription("ext", "acc", "plan");
             assertEquals(req, "sub-1");
        });
        it("duplicate", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response("Duplicate entry", { status: 400 }))
             ]));
             await assertRejects(() => killBillService.createSubscription("ext", "acc", "plan"), Error, "DUPLICATE_SUBSCRIPTION");
        });
        it("other error", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response("err", { status: 400 }))
             ]));
             await assertRejects(() => killBillService.createSubscription("ext", "acc", "plan"), Error, "Failed to create subscription: 400 - err");
        });
    });

    describe("cancelSubscription", () => {
        it("success", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(null, { status: 200 }))
             ]));
             await killBillService.cancelSubscription("sub-1");
        });
        it("error", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response("err", { status: 400 }))
             ]));
             await assertRejects(() => killBillService.cancelSubscription("sub-1"), Error, "Failed to cancel subscription: 400 - err");
        });
    });
    
    describe("uncancelSubscription", () => {
        it("success", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(null, { status: 200 }))
             ]));
             await killBillService.uncancelSubscription("sub-1");
        });
        it("error", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response("err", { status: 400 }))
             ]));
             await assertRejects(() => killBillService.uncancelSubscription("sub-1"), Error, "Failed to uncancel subscription: 400 - err");
        });
    });

    describe("voidInvoice", () => {
        it("success", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(null, { status: 200 }))
             ]));
             await killBillService.voidInvoice("inv-1");
        });
        it("error", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response("err", { status: 400 }))
             ]));
             await assertRejects(() => killBillService.voidInvoice("inv-1"), Error, "Failed to void invoice: 400 - err");
        });
    });
    
    describe("triggerInvoiceRun", () => {
        it("success", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(null, { status: 201, headers: new Headers({"Location": "http://loc/inv-1"}) }))
             ]));
             const res = await killBillService.triggerInvoiceRun("acc-1", "target_date");
             assertEquals(res, "inv-1");
        });
        it("404", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(null, { status: 404 }))
             ]));
             const res = await killBillService.triggerInvoiceRun("acc-1", "target_date");
             assertEquals(res, null);
        });
        it("error", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response("err", { status: 400 }))
             ]));
             await assertRejects(() => killBillService.triggerInvoiceRun("acc-1", "target_date"), Error, "Failed to trigger invoice run: 400 - err");
        });
    });
    
    describe("getAccountInvoices", () => {
        it("success", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(JSON.stringify([{invoiceId: "1"}]), { status: 200 }))
             ]));
             const res = await killBillService.getAccountInvoices(
                 "acc1", "start", "end", true, true, true, true, ["filter"], "NONE"
             );
             assertEquals(res[0].invoiceId, "1");
             // ensure correct query string
             const callArg = fetchStub.calls[0].args[0];
             assertSpyCalls(fetchStub, 1);
        });
        it("error", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(null, { status: 500 }))
             ]));
             await assertRejects(() => killBillService.getAccountInvoices("acc1"), Error, "Failed to get account invoices: 500");
        });
    });
    
    describe("getInvoiceById", () => {
        it("success", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(JSON.stringify({invoiceId: "1"}), { status: 200 }))
             ]));
             const res = await killBillService.getInvoiceById("inv1");
             assertEquals(res.invoiceId, "1");
        });
        it("404", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(null, { status: 404 }))
             ]));
             await assertRejects(() => killBillService.getInvoiceById("inv1"), Error, "INVOICE_NOT_FOUND");
        });
        it("error", async () => {
             fetchStub.restore();
             fetchStub = stub(globalThis, "fetch", returnsNext([
                 Promise.resolve(new Response(null, { status: 500 }))
             ]));
             await assertRejects(() => killBillService.getInvoiceById("inv1"), Error, "Failed to get invoice: 500");
        });
    });
    
});
