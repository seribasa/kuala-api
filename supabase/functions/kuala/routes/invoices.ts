import { Hono } from "@hono/hono";
import {
	handleCreateInvoice,
	handleDownloadInvoicePdf,
	handleGetInvoiceById,
	handleListInvoices,
	handlePayInvoice,
} from "../handlers/invoices/index.ts";
import { authMiddleware } from "../middleware/auth.ts";

export const invoiceRoutes = new Hono().basePath("/invoices");
invoiceRoutes.use(authMiddleware);
invoiceRoutes.post("/", handleCreateInvoice);
invoiceRoutes.get("/", handleListInvoices);
invoiceRoutes.get("/:invoiceId/pdf", handleDownloadInvoicePdf);
invoiceRoutes.get("/:invoiceId", handleGetInvoiceById);
invoiceRoutes.post("/:id/pay", handlePayInvoice);
