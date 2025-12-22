import {
	CurrentEntityState,
	stateManager,
	StateTransition,
	TransitionOptions,
} from "./state-management.ts";

// Convenience functions for subscription requests
export const subscriptionStateManager = {
	transitionToAccountReady(
		correlationId: string,
		options: Omit<TransitionOptions, "eventType"> & { eventType?: string },
	): Promise<string> {
		return stateManager.transitionState(
			"subscription_request",
			correlationId,
			"account_ready",
			{ eventType: "AccountReady", ...options },
		);
	},

	transitionToCreatingSubscription(
		correlationId: string,
		options: Omit<TransitionOptions, "eventType"> & { eventType?: string },
	): Promise<string> {
		return stateManager.transitionState(
			"subscription_request",
			correlationId,
			"creating_subscription",
			{ eventType: "CreatingSubscription", ...options },
		);
	},

	transitionToSubscriptionCreated(
		correlationId: string,
		options: Omit<TransitionOptions, "eventType"> & { eventType?: string },
	): Promise<string> {
		return stateManager.transitionState(
			"subscription_request",
			correlationId,
			"subscription_created",
			{ eventType: "SubscriptionCreated", ...options },
		);
	},

	transitionToGeneratingInvoice(
		correlationId: string,
		options: Omit<TransitionOptions, "eventType"> & { eventType?: string },
	): Promise<string> {
		return stateManager.transitionState(
			"subscription_request",
			correlationId,
			"generating_invoice",
			{ eventType: "GeneratingInvoice", ...options },
		);
	},

	transitionToCompleted(
		correlationId: string,
		options: Omit<TransitionOptions, "eventType"> & { eventType?: string },
	): Promise<string> {
		return stateManager.transitionState(
			"subscription_request",
			correlationId,
			"completed",
			{ eventType: "InvoiceGenerated", ...options },
		);
	},

	transitionToFailed(
		correlationId: string,
		errorMessage: string,
		options: Omit<TransitionOptions, "errorDetails"> & {
			// deno-lint-ignore no-explicit-any
			errorDetails?: Record<string, any>;
		},
	): Promise<string> {
		return stateManager.transitionState(
			"subscription_request",
			correlationId,
			"failed",
			{
				errorDetails: {
					message: errorMessage,
					...options.errorDetails,
				},
				...options,
			},
		);
	},

	getCurrentState(
		correlationId: string,
	): Promise<CurrentEntityState | null> {
		return stateManager.getCurrentState(
			"subscription_request",
			correlationId,
		);
	},

	getHistory(correlationId: string): Promise<StateTransition[]> {
		return stateManager.getStateHistory(
			"subscription_request",
			correlationId,
		);
	},
};
