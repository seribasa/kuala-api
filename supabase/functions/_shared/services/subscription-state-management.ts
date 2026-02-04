import {
	CurrentEntityState,
	stateManager,
	StateTransition,
	TransitionOptions,
} from "./state-management.ts";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Create Supabase client for lock operations
const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey);

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

	async transitionToCompleted(
		correlationId: string,
		options: Omit<TransitionOptions, "eventType"> & { eventType?: string },
	): Promise<string> {
		const result = await stateManager.transitionState(
			"subscription_request",
			correlationId,
			"completed",
			{ eventType: "InvoiceGenerated", ...options },
		);

		// Release the lock when subscription is completed
		try {
			await this.releaseUserLockByCorrelation(correlationId);
		} catch (error) {
			console.error("Failed to release lock after completion:", error);
			// Don't throw - the transition was successful, lock cleanup is best-effort
		}

		return result;
	},

	async transitionToFailed(
		correlationId: string,
		errorMessage: string,
		options: Omit<TransitionOptions, "errorDetails"> & {
			// deno-lint-ignore no-explicit-any
			errorDetails?: Record<string, any>;
		},
	): Promise<string> {
		const result = await stateManager.transitionState(
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

		// NOTE: Lock is intentionally NOT released on failure.
		// Failed subscriptions are manually reviewed by admin before being resolved.
		// Admin can release the lock manually after handling the failed subscription.

		return result;
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

	/**
	 * Acquire a lock for a user's subscription request.
	 * This ensures only 1 user can have 1 active subscription request at a time
	 * at the database level (atomic operation).
	 *
	 * @param userId - The user ID to acquire lock for
	 * @param correlationId - The correlation ID for the subscription request
	 * @returns The correlation ID if lock was acquired, null if user already has an active request
	 */
	async acquireUserLock(
		userId: string,
		correlationId: string,
	): Promise<string | null> {
		const { data, error } = await supabase.rpc(
			"acquire_user_subscription_lock",
			{
				p_user_id: userId,
				p_correlation_id: correlationId,
			},
		);

		if (error) {
			console.error("Failed to acquire user subscription lock:", error);
			throw new Error(
				`Failed to acquire subscription lock: ${error.message}`,
			);
		}

		return data as string | null;
	},

	/**
	 * Release a subscription lock for a user.
	 * Should be called when subscription process completes (success or failure).
	 *
	 * @param userId - The user ID to release lock for
	 * @returns true if a lock was released, false if no lock existed
	 */
	async releaseUserLock(userId: string): Promise<boolean> {
		const { data, error } = await supabase.rpc(
			"release_user_subscription_lock",
			{
				p_user_id: userId,
			},
		);

		if (error) {
			console.error("Failed to release user subscription lock:", error);
			throw new Error(
				`Failed to release subscription lock: ${error.message}`,
			);
		}

		return data as boolean;
	},

	/**
	 * Release a subscription lock by correlation ID.
	 * Useful when we only have the correlation ID and not the user ID.
	 *
	 * @param correlationId - The correlation ID to release lock for
	 * @returns true if a lock was released, false if no lock existed
	 */
	async releaseUserLockByCorrelation(
		correlationId: string,
	): Promise<boolean> {
		const { data, error } = await supabase.rpc(
			"release_subscription_lock_by_correlation",
			{
				p_correlation_id: correlationId,
			},
		);

		if (error) {
			console.error(
				"Failed to release subscription lock by correlation:",
				error,
			);
			throw new Error(
				`Failed to release subscription lock: ${error.message}`,
			);
		}

		return data as boolean;
	},

	/**
	 * Get the active subscription request for a user.
	 *
	 * @param userId - The user ID to check
	 * @returns The active request info or null if no active request
	 */
	async getActiveRequest(
		userId: string,
	): Promise<{ correlation_id: string; created_at: string } | null> {
		const { data, error } = await supabase.rpc(
			"get_user_active_subscription_request",
			{
				p_user_id: userId,
			},
		);

		if (error) {
			console.error("Failed to get active subscription request:", error);
			throw new Error(
				`Failed to get active subscription request: ${error.message}`,
			);
		}

		if (!data || data.length === 0) return null;
		return data[0];
	},
};
