import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { authLogger } from "../../middleware/logger.ts";
import { getUser } from "../../middleware/auth.ts";
import { killBillService } from "@shared/services/killbill.ts";
import { mapInvoiceStatus } from "./mapper.ts";

/**
 * List and search invoices
 * GET /invoices
 */
export const handleListInvoices = async (c: Context) => {
	const handlerName = "list-invoices";
	authLogger.start(handlerName);

	try {
		// Get Authorization header
		const authorization = c.req.header("Authorization");

		const offsetParam = c.req.query("offset");
		const limitParam = c.req.query("limit");
		const searchKey = c.req.query("searchKey");

		const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
		const limit = limitParam ? parseInt(limitParam, 10) : 100;

		authLogger.validation(handlerName, "Request validation", {
			hasAuthorization: !!authorization,
			offset,
			limit,
			hasSearchKey: !!searchKey,
		});

		// Get authenticated user from context (set by authMiddleware)
		const user = getUser(c);
		const userId = user.id;

		authLogger.validation(handlerName, "Authenticated user", {
			userId: userId.substring(0, 8) + "...",
		});

		// Get account to get accountId
		const account = await killBillService.getAccountByExternalKey(userId);
		if (!account) {
			authLogger.error(handlerName, "Account not found for user", {
				userId: userId.substring(0, 8) + "...",
			});
			const errorResponse: ErrorResponse = {
				code: "ACCOUNT_NOT_FOUND",
				message: "Billing account not found",
			};
			return c.json(errorResponse, 404);
		}

		let invoices;

		if (searchKey) {
			// Search across all invoices and filter by account
			authLogger.apiCall(handlerName, "Searching invoices", {
				searchKey,
			});
			const rawInvoices = await killBillService.searchInvoices(
				searchKey,
				0,
				1000,
			);

			// Filter by account and paginate in memory to ensure secure results
			const accountInvoices = rawInvoices.filter((inv) =>
				inv.accountId === account.accountId
			);
			invoices = accountInvoices.slice(offset, offset + limit);
		} else {
			// Get all invoices for account and paginate in memory
			authLogger.apiCall(handlerName, "Listing account invoices");
			const allInvoices = await killBillService.getAccountInvoices(
				account.accountId,
			);
			invoices = allInvoices.slice(offset, offset + limit);
		}

		const mappedInvoices = invoices.map(mapInvoiceStatus);

		authLogger.success(handlerName, "Invoices retrieved successfully", {
			count: mappedInvoices.length,
		});

		return c.json({ invoices: mappedInvoices });
	} catch (error) {
		authLogger.exception(handlerName, error as Error);

		if (error instanceof Error) {
			if (
				error.message.includes("Failed to get") ||
				error.message.includes("Failed to search")
			) {
				const errorResponse: ErrorResponse = {
					code: "KILLBILL_ERROR",
					message: "Failed to fetch invoices",
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
