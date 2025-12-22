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

	transitionState(
		entityType: string,
		entityId: string,
		toState: string,
		options: TransitionOptions = {},
	): Promise<string> {
		return stateManager.transitionState(
			entityType,
			entityId,
			toState,
			options,
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

	/**
	 * Check if user has any pending subscription requests
	 */
	async hasPendingSubscriptionRequest(userId: string): Promise<boolean> {
		const request = await stateManager.getEntitiesByMetadata(
			"subscription_request",
			"userId",
			userId,
		);
		
		const pending = request.filter((r) =>
			r.current_state !== "completed" && r.current_state !== "failed"
		);
		return pending.length > 0;
	},

	/**
	 * Get user's latest subscription request regardless of state
	 */
	async getLatestSubscriptionRequest(
		userId: string,
	): Promise<CurrentEntityState | null> {
		const requests = await stateManager.getEntitiesByMetadata(
			"subscription_request",
			"userId",
			userId,
		);
		if (requests.length === 0) return null;

		// Sort by state_updated_at to get the most recent
		return requests.sort((a, b) =>
			new Date(b.state_updated_at).getTime() -
			new Date(a.state_updated_at).getTime()
		)[0];
	},
};
