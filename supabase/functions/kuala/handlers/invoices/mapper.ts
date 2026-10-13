import { KillBillInvoice } from "../../../_shared/types/index.ts";

export type MappedInvoice = Omit<KillBillInvoice, "status"> & {
	status: "draft" | "open" | "paid" | "void" | "uncollectible";
};

export const mapInvoiceStatus = (invoice: KillBillInvoice): MappedInvoice => {
	let mappedStatus: MappedInvoice["status"] = "open";

	if (invoice.status === "VOID") {
		mappedStatus = "void";
	} else if (invoice.status === "DRAFT") {
		mappedStatus = "draft";
	} else if (invoice.status === "COMMITTED") {
		if (invoice.balance <= 0) {
			mappedStatus = "paid";
		} else {
			mappedStatus = "open";
		}
	}

	return {
		...invoice,
		status: mappedStatus,
	};
};
