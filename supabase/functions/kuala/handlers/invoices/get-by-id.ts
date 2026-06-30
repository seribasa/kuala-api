import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { authLogger } from "../../middleware/logger.ts";
import { getUser } from "../../middleware/auth.ts";
import { killBillService } from "@shared/services/killbill.ts";

import { mapInvoiceStatus } from "./mapper.ts";

/**
 * Get invoice by ID
 * GET /invoices/{invoiceId}
 */
export const handleGetInvoiceById = async (c: Context) => {
	const handlerName = "get-invoice-by-id";
	authLogger.start(handlerName);

	try {
		// Get Authorization header
		const authorization = c.req.header("Authorization");
		const invoiceId = c.req.param("invoiceId");

		authLogger.validation(handlerName, "Request validation", {
			hasAuthorization: !!authorization,
			hasInvoiceId: !!invoiceId,
			invoiceId: invoiceId?.substring(0, 8) + "...",
		});

		if (!invoiceId) {
			authLogger.error(handlerName, "Missing invoice ID parameter");
			const errorResponse: ErrorResponse = {
				code: "MISSING_INVOICE_ID",
				message: "Invoice ID is required",
			};
			return c.json(errorResponse, 400);
		}

		// Get authenticated user from context (set by authMiddleware)
		const user = getUser(c);
		const userId = user.id;

		authLogger.validation(handlerName, "Authenticated user", {
			userId: userId.substring(0, 8) + "...",
		});

		// Get the invoice details
		const invoice = await killBillService.getInvoiceById(invoiceId);

		// Verify ownership
		const account = await killBillService.getAccountByExternalKey(userId);
		if (!account || account.accountId !== invoice.accountId) {
			authLogger.error(
				handlerName,
				"User does not own this invoice",
				{
					userId: userId.substring(0, 8) + "...",
					invoiceId: invoiceId.substring(0, 8) + "...",
				},
			);
			const errorResponse: ErrorResponse = {
				code: "INVOICE_NOT_FOUND",
				message: "Invoice not found",
			};
			return c.json(errorResponse, 404);
		}

		const mappedInvoice = mapInvoiceStatus(invoice);

		authLogger.success(handlerName, "Invoice retrieved successfully", {
			invoiceId: mappedInvoice.invoiceId.substring(0, 8) + "...",
			status: mappedInvoice.status,
			amount: mappedInvoice.amount,
		});

		// Forward the Kill Bill invoice response as per spec
		return c.json(mappedInvoice, 200);
	} catch (error) {
		authLogger.exception(handlerName, error as Error);

		if (error instanceof Error) {
			if (error.message === "INVOICE_NOT_FOUND") {
				const errorResponse: ErrorResponse = {
					code: "INVOICE_NOT_FOUND",
					message: "Invoice not found",
				};
				return c.json(errorResponse, 404);
			}

			if (error.message.includes("Failed to get")) {
				const errorResponse: ErrorResponse = {
					code: "KILLBILL_ERROR",
					message: "Failed to fetch invoice",
				};
				return c.json(errorResponse, 500);
			}
		}

		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Internal server error",
		};
		return c.json(errorResponse, 500);
	}
};
