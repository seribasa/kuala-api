import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { authLogger, logger } from "../../middleware/logger.ts";
import { getUser } from "../../middleware/auth.ts";
import { killBillService } from "@shared/services/killbill.ts";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { supabase } from "@shared/supabase.ts";

/**
 * Download invoice as PDF
 * GET /invoices/{invoiceId}/pdf
 */
export const handleDownloadInvoicePdf = async (c: Context) => {
	const handlerName = "download-invoice-pdf";
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

		// Check ownership by first getting the invoice summary
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

		const bucketName = "invoices";
		const fileName = `invoice-${invoiceId}.pdf`;

		// Check if file exists in Supabase Storage
		const { data: existingFiles } = await supabase.storage.from(bucketName)
			.list("", {
				search: fileName,
			});

		let pdfExists = false;
		if (existingFiles && existingFiles.length > 0) {
			pdfExists = existingFiles.some((file) => file.name === fileName);
		}

		if (!pdfExists) {
			logger.info(
				handlerName,
				"PDF not found in storage. Generating new PDF.",
			);

			// Get the HTML content
			const htmlContent = await killBillService.getInvoiceHtml(invoiceId);

			// Generate PDF
			const pdfDoc = await PDFDocument.create();
			const page = pdfDoc.addPage([595.28, 841.89]); // A4 size
			const font = await pdfDoc.embedFont(StandardFonts.Courier);

			const padding = 40;
			const { width, height } = page.getSize();
			const usableWidth = width - 2 * padding;

			page.drawText("Invoice: " + invoiceId, {
				x: padding,
				y: height - padding,
				size: 16,
				font,
			});

			// Clean up HTML a bit for text rendering
			const cleanText = htmlContent
				.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "") // Remove style blocks
				.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "") // Remove script blocks
				.replace(/<\/(p|div|tr|h[1-6]|table)>/gi, "\n") // Add newline after blocks
				.replace(/<br\s*\/?>/gi, "\n") // Replace <br> with newline
				.replace(/<\/td>/gi, "    ") // Add spacing between table columns
				.replace(/<[^>]+>/g, " ") // Strip remaining HTML tags
				.replace(/^[ \t]+/gm, "") // Remove leading whitespace on each line
				.replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n") // Collapse 3+ newlines to 2
				.trim()
				.substring(0, 4000); // Limit length to avoid page overflow for basic dump

			page.drawText(cleanText, {
				x: padding,
				y: height - padding - 40,
				size: 10,
				font,
				maxWidth: usableWidth,
				lineHeight: 14,
			});

			const pdfBytes = await pdfDoc.save();

			// Upload to Supabase Storage
			const { error: uploadError } = await supabase.storage.from(
				bucketName,
			).upload(fileName, pdfBytes, {
				contentType: "application/pdf",
				upsert: true,
			});

			if (uploadError) {
				throw new Error(
					"Failed to upload PDF to storage: " + uploadError.message,
				);
			}

			authLogger.success(
				handlerName,
				"PDF generated and uploaded successfully",
			);
		} else {
			logger.info(
				handlerName,
				"PDF found in storage. Skipping generation.",
			);
		}

		// Generate signed URL valid for 60 seconds
		const { data: signedUrlData, error: signedUrlError } = await supabase
			.storage.from(bucketName).createSignedUrl(fileName, 60);

		if (signedUrlError || !signedUrlData) {
			throw new Error("Failed to generate signed URL");
		}

		authLogger.success(handlerName, "Redirecting to signed URL");

		// Redirect to the signed URL
		return c.redirect(signedUrlData.signedUrl, 303);
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
