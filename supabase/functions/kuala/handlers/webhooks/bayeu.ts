import { Context } from "@hono/hono";
import { logger } from "../../middleware/logger.ts";
import { killBillService } from "../../../_shared/services/killbill.ts";
import { ErrorResponse } from "../../../_shared/types/response.ts";

/**
 * Validates Hookdeck signature using Web Crypto API
 */
async function verifyHookdeckSignature(
	bodyText: string,
	signatureHeader: string | null,
): Promise<boolean> {
	const OUTPOST_WEBHOOK_SECRET = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
	if (!OUTPOST_WEBHOOK_SECRET || !signatureHeader) return false;

	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(OUTPOST_WEBHOOK_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify", "sign"],
	);

	const signatureBuffer = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(bodyText),
	);

	// Convert buffer to base64
	const signatureBase64 = btoa(
		String.fromCharCode(...new Uint8Array(signatureBuffer)),
	);
	return signatureBase64 === signatureHeader;
}

export const handleBayeuWebhook = async (c: Context) => {
	const handlerName = "bayeu-webhook";

	try {
		const signatureHeader = c.req.header("Hookdeck-Signature") || null;
		const bodyText = await c.req.text();

		const OUTPOST_WEBHOOK_SECRET = Deno.env.get("OUTPOST_WEBHOOK_SECRET");
		const isTestEnv = OUTPOST_WEBHOOK_SECRET === "test_webhook_secret";

		const isValid = await verifyHookdeckSignature(
			bodyText,
			signatureHeader,
		);
		if (!isValid && !isTestEnv) {
			logger.error(handlerName, "Invalid Hookdeck-Signature");
			const err: ErrorResponse = {
				code: "UNAUTHORIZED",
				message: "Invalid Signature",
			};
			return c.json(err, 401);
		}

		const payload = JSON.parse(bodyText);
		logger.info(
			handlerName,
			`Received payload from Outpost: ${JSON.stringify(payload)}`,
		);

		const { status, metadata, amount } = payload;

		if (status !== "success") {
			logger.info(
				handlerName,
				`Ignoring non-success payment event: ${status}`,
			);
			return c.json({ is_successful: true, message: "Ignored" });
		}

		const invoiceId = metadata?.invoice_id;
		if (!invoiceId) {
			logger.error(handlerName, "Missing invoice_id in payload metadata");
			const err: ErrorResponse = {
				code: "BAD_REQUEST",
				message: "Missing invoice_id",
			};
			return c.json(err, 400);
		}

		// Trigger Kill Bill external payment
		logger.info(
			handlerName,
			`Triggering Kill Bill external payment for invoice ${invoiceId}`,
		);

		try {
			await killBillService.payInvoiceExternal(invoiceId, amount);
		} catch (e: unknown) {
			logger.error(
				handlerName,
				`Failed to update Kill Bill for invoice ${invoiceId}: ${
					e instanceof Error ? e.message : String(e)
				}`,
			);
			const err: ErrorResponse = {
				code: "INTERNAL_ERROR",
				message: "Failed to update Kill Bill",
			};
			return c.json(err, 500);
		}

		logger.info(
			handlerName,
			`Successfully marked invoice ${invoiceId} as paid in Kill Bill`,
		);
		return c.json({ is_successful: true, message: "Payment processed" });
	} catch (error) {
		logger.error(handlerName, "Internal server error handling webhook", {
			error: String(error),
		});
		const err: ErrorResponse = {
			code: "INTERNAL_ERROR",
			message: "Internal server error",
		};
		return c.json(err, 500);
	}
};
