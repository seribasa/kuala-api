import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { logger } from "../../middleware/logger.ts";
import { getUser } from "../../middleware/auth.ts";
import { killBillService } from "../../../_shared/services/killbill.ts";

export const handlePayInvoice = async (c: Context) => {
	const handlerName = "pay-invoice";

	try {
		const authorization = c.req.header("Authorization");
		if (!authorization) {
			logger.error(handlerName, "Missing Authorization header");
			const err: ErrorResponse = {
				code: "UNAUTHORIZED",
				message: "Unauthorized: Missing Authorization header",
			};
			return c.json(err, 401);
		}

		// `getUser` reads from context because `authMiddleware` is used
		const user = getUser(c);
		if (!user) {
			logger.error(handlerName, "User not found in context");
			const err: ErrorResponse = {
				code: "UNAUTHORIZED",
				message: "Unauthorized",
			};
			return c.json(err, 401);
		}

		const invoiceId = c.req.param("id");
		if (!invoiceId) {
			const err: ErrorResponse = {
				code: "BAD_REQUEST",
				message: "Invoice ID is required",
			};
			return c.json(err, 400);
		}

		const gateway = Deno.env.get("PAYMENT_GATEWAY");
		if (!gateway) {
			logger.error(handlerName, "PAYMENT_GATEWAY is not configured");
			const err: ErrorResponse = {
				code: "INTERNAL_ERROR",
				message: "Payment service configuration error",
			};
			return c.json(err, 500);
		}
		// Fetch invoice from Kill Bill
		logger.info(
			handlerName,
			`Fetching invoice ${invoiceId} from Kill Bill`,
		);
		let invoice;
		try {
			invoice = await killBillService.getInvoiceById(invoiceId);
		} catch (e: unknown) {
			logger.error(
				handlerName,
				`Failed to fetch invoice: ${
					e instanceof Error ? e.message : String(e)
				}`,
			);
			const err: ErrorResponse = {
				code: "INTERNAL_ERROR",
				message: "Failed to fetch invoice",
			};
			return c.json(err, 500);
		}

		// Verify invoice ownership
		const account = await killBillService.getAccountByExternalKey(user.id);
		if (!account || invoice.accountId !== account.accountId) {
			logger.error(
				handlerName,
				`Invoice ${invoiceId} does not belong to user ${user.id}`,
			);
			const err: ErrorResponse = {
				code: "FORBIDDEN",
				message: "You do not have permission to pay this invoice",
			};
			return c.json(err, 403);
		}

		const amount = invoice.balance;
		const currency = invoice.currency;

		if (!amount || amount <= 0) {
			const err: ErrorResponse = {
				code: "BAD_REQUEST",
				message: "Invoice balance is zero. Nothing to pay.",
			};
			return c.json(err, 400);
		}

		const bayeuUrl = Deno.env.get("BAYEU_API_URL");
		const webhookUrl = Deno.env.get("KUALA_WEBHOOK_URL");

		if (!bayeuUrl) {
			logger.error(handlerName, "BAYEU_API_URL is not configured");
			const err: ErrorResponse = {
				code: "INTERNAL_ERROR",
				message: "Payment service configuration error",
			};
			return c.json(err, 500);
		}

		logger.info(
			handlerName,
			`Initiating payment via Bayeu for invoice ${invoiceId}`,
		);
		const bayeuResponse = await fetch(`${bayeuUrl}/initiate-payment`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": authorization,
			},
			body: JSON.stringify({
				amount,
				currency,
				gateway,
				tenant_id: "kuala-api",
				webhook_url: webhookUrl,
				metadata: {
					invoice_id: invoiceId,
				},
			}),
		});

		if (!bayeuResponse.ok) {
			const bayeuErr = await bayeuResponse.text();
			logger.error(handlerName, `Bayeu initiation failed: ${bayeuErr}`);
			const err: ErrorResponse = {
				code: "INTERNAL_ERROR",
				message: "Failed to initiate payment gateway",
			};
			return c.json(err, 500);
		}

		const bayeuData = await bayeuResponse.json();
		logger.info(
			handlerName,
			`Successfully initiated payment for invoice ${invoiceId}`,
		);
		return c.json(bayeuData);
	} catch (error) {
		logger.error(handlerName, "Internal server error", {
			error: String(error),
		});
		const err: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Internal server error",
		};
		return c.json(err, 500);
	}
};
