import { Context } from "@hono/hono";
import { ErrorResponse } from "../../../_shared/types/response.ts";
import { authLogger } from "../../middleware/logger.ts";
import { getUser } from "../../middleware/auth.ts";
import { killBillService } from "@shared/services/killbill.ts";
import { PDFDocument, StandardFonts } from "pdf-lib";

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
			.replace(/<[^>]+>/g, " ") // Strip HTML tags
			.replace(/\s+/g, " ") // Collapse whitespace
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

		authLogger.success(handlerName, "PDF generated successfully");

		return new Response(pdfBytes as unknown as BodyInit, {
			status: 200,
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition":
					`attachment; filename="invoice-${invoiceId}.pdf"`,
			},
		});
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
