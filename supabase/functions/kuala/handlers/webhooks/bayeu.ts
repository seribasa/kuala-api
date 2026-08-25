import { config } from "../../../_shared/config/env.ts";
import { Context } from "@hono/hono";
import { logger } from "../../middleware/logger.ts";
import { killBillService } from "../../../_shared/services/killbill.ts";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { supabase } from "../../../_shared/supabase.ts";

/**
 * Validates Hookdeck signature using Web Crypto API
 */
import crypto from "node:crypto";
import { Buffer } from "node:buffer";

function verifyHookdeckSignature(
	bodyText: string,
	c: Context,
): boolean {
	const OUTPOST_WEBHOOK_SECRET = config.OUTPOST_WEBHOOK_SECRET;
	const handlerName = "bayeu-webhook";

	if (!OUTPOST_WEBHOOK_SECRET) {
		logger.error(
			handlerName,
			"OUTPOST_WEBHOOK_SECRET is not set in environment",
		);
		return false;
	}

	const hookdeckSignature = c.req.header("x-hookdeck-signature") ||
		c.req.header("hookdeck-signature");
	const outpostSignature = c.req.header("x-outpost-signature");
	const outpostTimestamp = c.req.header("x-outpost-timestamp") || "";

	if (!hookdeckSignature && !outpostSignature) {
		const headersObj = Object.fromEntries(c.req.raw.headers.entries());
		logger.error(
			handlerName,
			"No signature header found. Available headers:",
			headersObj,
		);
		return false;
	}

	const possibleSecrets: Buffer[] = [Buffer.from(OUTPOST_WEBHOOK_SECRET)];
	if (OUTPOST_WEBHOOK_SECRET.startsWith("whsec_")) {
		const rawKey = OUTPOST_WEBHOOK_SECRET.slice(6);
		// Standard Webhooks secrets are usually base64
		possibleSecrets.push(Buffer.from(rawKey, "base64"));
		// Hookdeck Outpost dashboard sometimes provides 64-character HEX strings
		if (/^[0-9a-fA-F]+$/.test(rawKey) && rawKey.length % 2 === 0) {
			possibleSecrets.push(Buffer.from(rawKey, "hex"));
		}
	}

	for (const secretBytes of possibleSecrets) {
		// 1. Check Hookdeck Event Gateway format (Base64)
		if (hookdeckSignature) {
			const hashBase64 = crypto
				.createHmac("sha256", secretBytes)
				.update(bodyText)
				.digest("base64");

			try {
				if (
					crypto.timingSafeEqual(
						Buffer.from(hookdeckSignature.trim()),
						Buffer.from(hashBase64),
					)
				) {
					return true;
				}
			} catch (err) {
				// Ignore
			}
		}

		// 2. Check Hookdeck Outpost format (Hex, prefixed with v0=)
		if (outpostSignature) {
			const outpostEventId = c.req.header("x-outpost-event-id") || "";
			const extractedSigs = outpostSignature
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s.startsWith("v0="))
				.map((s) => s.slice(3));

			const payloadsToTest = [
				bodyText,
				outpostTimestamp ? `${outpostTimestamp}.${bodyText}` : null,
				(outpostEventId && outpostTimestamp)
					? `${outpostEventId}.${outpostTimestamp}.${bodyText}`
					: null,
			].filter(Boolean) as string[];

			for (const payload of payloadsToTest) {
				const hashHex = crypto
					.createHmac("sha256", secretBytes)
					.update(payload)
					.digest("hex");

				const hashBase64 = crypto
					.createHmac("sha256", secretBytes)
					.update(payload)
					.digest("base64");

				for (const sig of extractedSigs) {
					try {
						if (
							Buffer.from(sig).length ===
								Buffer.from(hashHex).length &&
							crypto.timingSafeEqual(
								Buffer.from(sig),
								Buffer.from(hashHex),
							)
						) {
							return true;
						}
						if (
							Buffer.from(sig).length ===
								Buffer.from(hashBase64).length &&
							crypto.timingSafeEqual(
								Buffer.from(sig),
								Buffer.from(hashBase64),
							)
						) {
							return true;
						}
					} catch (err) {
						// Ignore
					}
				}
			}
		}
	}

	logger.error(
		handlerName,
		"Signature mismatch. None of the extracted signatures matched the computed hashes.",
	);
	return false;
}

export const handleBayeuWebhook = async (c: Context) => {
	const handlerName = "bayeu-webhook";

	try {
		const bodyText = await c.req.text();

		const skipVerification = config.SKIP_WEBHOOK_VERIFICATION ||
			config.DENO_ENV === "test";

		const isValid = verifyHookdeckSignature(
			bodyText,
			c,
		);
		if (!isValid && !skipVerification) {
			logger.error(handlerName, "Invalid Hookdeck-Signature");
			const err: ErrorResponse = {
				code: "UNAUTHORIZED",
				message: "Invalid Signature",
			};
			return c.json(err, 401);
		}

		const payload = JSON.parse(bodyText);
		const { status, metadata, amount } = payload;

		logger.info(
			handlerName,
			"Received payload from Outpost",
			{ status, invoiceId: metadata?.invoice_id, amount },
		);

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

		// Invalidate cached invoice PDF in Supabase Storage
		try {
			const fileName = `invoice-${invoiceId}.pdf`;
			const { error: removeError } = await supabase.storage.from(
				"invoices",
			)
				.remove([fileName]);

			if (removeError) {
				logger.error(
					handlerName,
					`Failed to remove cached invoice PDF for ${invoiceId}: ${removeError.message}`,
				);
			} else {
				logger.info(
					handlerName,
					`Successfully invalidated cached invoice PDF for ${invoiceId}`,
				);
			}
		} catch (e: unknown) {
			logger.error(
				handlerName,
				`Failed to invalidate cached invoice PDF for ${invoiceId}: ${
					e instanceof Error ? e.message : String(e)
				}`,
			);
		}

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
