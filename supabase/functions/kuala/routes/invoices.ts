import { Hono } from "@hono/hono";
import {
	handleCreateInvoice,
	handleDownloadInvoicePdf,
	handleGetInvoiceById,
	handleListInvoices,
	handlePayInvoice,
} from "../handlers/invoices/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import {
	validateJson,
	validateParam,
	validateQuery,
} from "../validators/core.ts";
import {
	createInvoiceSchema,
	getInvoiceByIdParamSchema,
	listInvoicesQuerySchema,
	payInvoiceBodySchema,
	payInvoiceParamSchema,
	payInvoiceQuerySchema,
} from "../validators/schemas.ts";

export const invoiceRoutes = new Hono().basePath("/invoices");

invoiceRoutes.use(authMiddleware);

invoiceRoutes.post(
	"/",
	validateJson(createInvoiceSchema),
	handleCreateInvoice,
);

invoiceRoutes.get(
	"/",
	validateQuery(listInvoicesQuerySchema),
	handleListInvoices,
);

invoiceRoutes.get(
	"/:invoiceId/pdf",
	validateParam(getInvoiceByIdParamSchema),
	handleDownloadInvoicePdf,
);

invoiceRoutes.get(
	"/:invoiceId",
	validateParam(getInvoiceByIdParamSchema),
	handleGetInvoiceById,
);

invoiceRoutes.post(
	"/:id/pay",
	validateParam(payInvoiceParamSchema),
	validateQuery(payInvoiceQuerySchema),
	validateJson(payInvoiceBodySchema),
	handlePayInvoice,
);
