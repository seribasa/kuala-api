import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { authLogger } from "../../middleware/logger.ts";
import { getUser } from "../../middleware/auth.ts";
import { killBillService } from "@shared/services/killbill.ts";

export interface CreateInvoiceRequest {
	accountId: string;
	targetDate?: string;
}

/**
 * Generate invoice for a subscription (if not auto-generated)
 * POST /invoices
 */
export const handleCreateInvoice = async (c: Context) => {
	const handlerName = "create-invoice";
	authLogger.start(handlerName);

	try {
		// Get Authorization header
		const authorization = c.req.header("Authorization");

		authLogger.validation(handlerName, "Request validation", {
			hasAuthorization: !!authorization,
		});

		// Parse body
		let body: CreateInvoiceRequest;
		try {
			body = await c.req.json<CreateInvoiceRequest>();
		} catch (_) {
			const errorResponse: ErrorResponse = {
				code: "INVALID_REQUEST",
				message: "Invalid JSON body",
			};
			return c.json(errorResponse, 400);
		}

		if (!body.accountId) {
			authLogger.error(handlerName, "Missing accountId parameter");
			const errorResponse: ErrorResponse = {
				code: "MISSING_ACCOUNT_ID",
				message: "accountId is required",
			};
			return c.json(errorResponse, 400);
		}

		// Get authenticated user from context (set by authMiddleware)
		const user = getUser(c);
		const userId = user.id;

		authLogger.validation(handlerName, "Authenticated user", {
			userId: userId.substring(0, 8) + "...",
		});

		// Verify that the user owns the accountId
		const account = await killBillService.getAccountByExternalKey(userId);
		if (!account || account.accountId !== body.accountId) {
			authLogger.error(handlerName, "User does not own this account", {
				userId: userId.substring(0, 8) + "...",
				accountId: body.accountId.substring(0, 8) + "...",
			});
			const errorResponse: ErrorResponse = {
				code: "ACCOUNT_NOT_FOUND",
				message: "Account not found or unauthorized",
			};
			return c.json(errorResponse, 404);
		}

		// Trigger invoice run
		const invoiceId = await killBillService.triggerInvoiceRun(
			body.accountId,
			body.targetDate,
		);

		if (!invoiceId) {
			authLogger.error(handlerName, "No invoice generated (up to date)");
			const errorResponse: ErrorResponse = {
				code: "NOTHING_TO_INVOICE",
				message: "Nothing to invoice for",
			};
			return c.json(errorResponse, 404);
		}

		authLogger.success(handlerName, "Invoice created successfully", {
			invoiceId: invoiceId.substring(0, 8) + "...",
		});

		// Spec says: "201: Invoice created with empty response"
		return new Response(null, { status: 201 });
	} catch (error) {
		authLogger.exception(handlerName, error as Error);

		const errorResponse: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Internal server error",
		};
		return c.json(errorResponse, 500);
	}
};
