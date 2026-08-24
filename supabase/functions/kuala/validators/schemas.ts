import { z } from "zod";

// --- Invoices ---
export const createInvoiceSchema = z.object({
	accountId: z.string().min(1, "accountId is required"),
	targetDate: z.string().optional(),
});

export const payInvoiceBodySchema = z.object({
	back_url: z.url().optional(),
	success_url: z.url().optional(),
	failed_url: z.url().optional(),
});

export const payInvoiceQuerySchema = z.object({
	back_url: z.url().optional(),
	success_url: z.url().optional(),
	failed_url: z.url().optional(),
});

export const payInvoiceParamSchema = z.object({
	id: z.string().min(1, "invoiceId is required"),
});

export const listInvoicesQuerySchema = z.object({
	offset: z.coerce.number().min(0).optional(),
	limit: z.coerce.number().positive().max(100).optional(),
	searchKey: z.string().optional(),
});

export const getInvoiceByIdParamSchema = z.object({
	invoiceId: z.string().min(1, "invoiceId is required"),
});

// --- Auth ---
export const refreshTokenSchema = z.object({
	refresh_token: z.string().min(1, "refresh_token is required"),
});

export const exchangeTokenSchema = z.object({
	auth_code: z.string().min(1, "auth_code is required"),
	code_verifier: z.string().min(1, "code_verifier is required"),
});

export const authorizeQuerySchema = z.object({
	redirect_to: z.url("Valid redirect_to URL is required"),
	code_challenge: z.string().min(1, "code_challenge is required"),
});

// --- Subscriptions ---
export const createSubscriptionSchema = z.object({
	planId: z.string().min(1, "planId is required"),
});

export const getSubscriptionByIdParamSchema = z.object({
	subscriptionId: z.string().min(1, "subscriptionId is required"),
});

export const getSubscriptionStatusParamSchema = z.object({
	correlationId: z.string().min(1, "correlationId is required"),
});

// --- Plans ---
export const getPlansQuerySchema = z.object({
	interval: z.enum(["month", "year"]).optional(),
});
