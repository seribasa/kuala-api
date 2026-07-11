import { assertEquals } from "@std/assert";
import { mapInvoiceStatus } from "../../../kuala/handlers/invoices/mapper.ts";
import { KillBillInvoice } from "../../../_shared/types/index.ts";

Deno.test("mapInvoiceStatus - maps VOID to void", () => {
	const invoice = { status: "VOID", balance: 100 } as KillBillInvoice;
	const result = mapInvoiceStatus(invoice);
	assertEquals(result.status, "void");
});

Deno.test("mapInvoiceStatus - maps DRAFT to draft", () => {
	const invoice = { status: "DRAFT", balance: 100 } as KillBillInvoice;
	const result = mapInvoiceStatus(invoice);
	assertEquals(result.status, "draft");
});

Deno.test("mapInvoiceStatus - maps COMMITTED with 0 balance to paid", () => {
	const invoice = { status: "COMMITTED", balance: 0 } as KillBillInvoice;
	const result = mapInvoiceStatus(invoice);
	assertEquals(result.status, "paid");
});

Deno.test("mapInvoiceStatus - maps COMMITTED with negative balance to paid", () => {
	const invoice = { status: "COMMITTED", balance: -50 } as KillBillInvoice;
	const result = mapInvoiceStatus(invoice);
	assertEquals(result.status, "paid");
});

Deno.test("mapInvoiceStatus - maps COMMITTED with positive balance to open", () => {
	const invoice = { status: "COMMITTED", balance: 100 } as KillBillInvoice;
	const result = mapInvoiceStatus(invoice);
	assertEquals(result.status, "open");
});

Deno.test("mapInvoiceStatus - maps unknown status to open by default", () => {
	const invoice = {
		status: "UNKNOWN",
		balance: 100,
	} as unknown as KillBillInvoice;
	const result = mapInvoiceStatus(invoice);
	assertEquals(result.status, "open");
});
