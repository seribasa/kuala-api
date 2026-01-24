/**
 * Compensation Actions for Failed Subscription Flow
 *
 * Provides rollback/cleanup actions when subscription flow fails at various stages.
 */

import { killBillService } from "@shared/services/killbill.ts";
import { subscriptionStateManager } from "../services/subscription-state-management.ts";

/**
 * Compensation context with metadata from the failed operation
 */
export interface CompensationContext {
	correlationId: string;
	userId: string;
	accountId?: string;
	subscriptionId?: string;
	invoiceId?: string;
	planId?: string;
	failedAtState: string;
	errorMessage: string;
	// deno-lint-ignore no-explicit-any
	additionalMetadata?: Record<string, any>;
}

/**
 * Result of a compensation action
 */
export interface CompensationResult {
	success: boolean;
	action: string;
	message: string;
	error?: string;
}

/**
 * Options for compensation execution
 */
export interface CompensationOptions {
	/** Whether to mark the subscription as cancelled in state management */
	markAsCancelled?: boolean;
	/** Whether to preserve resources for debugging (won't cleanup for 24h) */
	preserveForDebugging?: boolean;
	/** Reason for compensation */
	reason?: string;
}

/**
 * Logger interface for compensation actions
 */
interface CompensationLogger {
	info: (action: string, message: string, context?: unknown) => void;
	warn: (action: string, message: string, context?: unknown) => void;
	error: (action: string, message: string, context?: unknown) => void;
}

const defaultLogger: CompensationLogger = {
	info: (action, message, context) =>
		console.log(`🔄 [Compensation:${action}] ${message}`, context || ""),
	warn: (action, message, context) =>
		console.warn(`⚠️ [Compensation:${action}] ${message}`, context || ""),
	error: (action, message, context) =>
		console.error(`❌ [Compensation:${action}] ${message}`, context || ""),
};

/**
 * Compensation actions for each state in the subscription flow
 */
export const compensationActions = {
	/**
	 * Compensate for failure after account was created/verified
	 * No action needed - accounts can be reused
	 */
	accountReady(
		context: CompensationContext,
		_options: CompensationOptions = {},
		logger: CompensationLogger = defaultLogger,
	): CompensationResult {
		logger.info("accountReady", "No compensation needed for account", {
			correlationId: context.correlationId,
			accountId: context.accountId,
		});

		return {
			success: true,
			action: "accountReady",
			message: "No compensation needed - account can be reused",
		};
	},

	/**
	 * Compensate for failure after subscription was created
	 * Cancels the subscription in KillBill
	 */
	async subscriptionCreated(
		context: CompensationContext,
		options: CompensationOptions = {},
		logger: CompensationLogger = defaultLogger,
	): Promise<CompensationResult> {
		if (!context.subscriptionId) {
			logger.warn(
				"subscriptionCreated",
				"No subscription ID provided for compensation",
				context,
			);
			return {
				success: false,
				action: "subscriptionCreated",
				message: "No subscription ID to compensate",
			};
		}

		if (options.preserveForDebugging) {
			logger.info(
				"subscriptionCreated",
				"Preserving subscription for debugging",
				{
					subscriptionId: context.subscriptionId,
				},
			);
			return {
				success: true,
				action: "subscriptionCreated",
				message: "Subscription preserved for debugging",
			};
		}

		try {
			logger.info(
				"subscriptionCreated",
				"Cancelling subscription due to flow failure",
				{
					subscriptionId: context.subscriptionId,
					reason: context.errorMessage,
				},
			);

			await killBillService.cancelSubscription(context.subscriptionId);

			logger.info(
				"subscriptionCreated",
				"Subscription cancelled successfully",
				{
					subscriptionId: context.subscriptionId,
				},
			);

			return {
				success: true,
				action: "subscriptionCreated",
				message: `Subscription ${context.subscriptionId} cancelled`,
			};
		} catch (error) {
			logger.error(
				"subscriptionCreated",
				"Failed to cancel subscription",
				{
					subscriptionId: context.subscriptionId,
					error: error instanceof Error
						? error.message
						: String(error),
				},
			);

			return {
				success: false,
				action: "subscriptionCreated",
				message: "Failed to cancel subscription",
				error: error instanceof Error ? error.message : String(error),
			};
		}
	},

	/**
	 * Compensate for failure during invoice generation
	 * Voids the invoice if created, then cancels subscription
	 */
	async generatingInvoice(
		context: CompensationContext,
		options: CompensationOptions = {},
		logger: CompensationLogger = defaultLogger,
	): Promise<CompensationResult> {
		const results: CompensationResult[] = [];

		// 1. Void invoice if it exists
		if (context.invoiceId && !options.preserveForDebugging) {
			try {
				logger.info(
					"generatingInvoice",
					"Voiding invoice due to flow failure",
					{
						invoiceId: context.invoiceId,
					},
				);

				await killBillService.voidInvoice(context.invoiceId);

				results.push({
					success: true,
					action: "voidInvoice",
					message: `Invoice ${context.invoiceId} voided`,
				});
			} catch (error) {
				logger.error("generatingInvoice", "Failed to void invoice", {
					invoiceId: context.invoiceId,
					error: error instanceof Error
						? error.message
						: String(error),
				});

				results.push({
					success: false,
					action: "voidInvoice",
					message: "Failed to void invoice",
					error: error instanceof Error
						? error.message
						: String(error),
				});
			}
		}

		// 2. Cancel subscription if it exists
		if (context.subscriptionId && !options.preserveForDebugging) {
			const subResult = await compensationActions.subscriptionCreated(
				context,
				options,
				logger,
			);
			results.push(subResult);
		}

		const allSuccess = results.every((r) => r.success);
		return {
			success: allSuccess,
			action: "generatingInvoice",
			message: allSuccess
				? "All compensation actions completed successfully"
				: "Some compensation actions failed",
			error: allSuccess ? undefined : results
				.filter((r) => !r.success)
				.map((r) => r.error)
				.join("; "),
		};
	},
};

/**
 * Execute compensation based on the failed state
 */
export async function executeCompensation(
	context: CompensationContext,
	options: CompensationOptions = {},
	logger: CompensationLogger = defaultLogger,
): Promise<CompensationResult> {
	const { failedAtState } = context;

	logger.info(
		"executeCompensation",
		`Starting compensation for state: ${failedAtState}`,
		{
			correlationId: context.correlationId,
			userId: context.userId,
		},
	);

	let result: CompensationResult;

	switch (failedAtState) {
		case "requested":
			// Nothing to compensate at initial request stage
			result = {
				success: true,
				action: "requested",
				message: "No compensation needed at request stage",
			};
			break;

		case "account_ready":
			result = await compensationActions.accountReady(
				context,
				options,
				logger,
			);
			break;

		case "creating_subscription":
		case "subscription_created":
			result = await compensationActions.subscriptionCreated(
				context,
				options,
				logger,
			);
			break;

		case "generating_invoice":
			result = await compensationActions.generatingInvoice(
				context,
				options,
				logger,
			);
			break;

		default:
			logger.warn(
				"executeCompensation",
				`Unknown state for compensation: ${failedAtState}`,
				context,
			);
			result = {
				success: false,
				action: "unknown",
				message: `Unknown state for compensation: ${failedAtState}`,
			};
	}

	// Record compensation in state management if requested
	if (options.markAsCancelled && result.success) {
		try {
			await subscriptionStateManager.transitionState(
				"subscription_request",
				context.correlationId,
				"cancelled",
				{
					triggeredBy: "compensation-handler",
					reason: options.reason ||
						"Compensation executed after failure",
					metadata: {
						...context.additionalMetadata,
						compensationResult: result,
						originalError: context.errorMessage,
					},
				},
			);
		} catch (error) {
			logger.error(
				"executeCompensation",
				"Failed to update state after compensation",
				{
					error: error instanceof Error
						? error.message
						: String(error),
				},
			);
		}
	}

	return result;
}

/**
 * Build compensation context from state metadata
 */
export function buildCompensationContext(
	correlationId: string,
	failedAtState: string,
	errorMessage: string,
	// deno-lint-ignore no-explicit-any
	metadata: Record<string, any>,
): CompensationContext {
	return {
		correlationId,
		userId: metadata.userId || "",
		accountId: metadata.accountId,
		subscriptionId: metadata.subscriptionId,
		invoiceId: metadata.invoiceId,
		planId: metadata.planId,
		failedAtState,
		errorMessage,
		additionalMetadata: metadata,
	};
}
