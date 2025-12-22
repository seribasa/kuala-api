import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export interface StateTransition {
	id: string;
	entity_type: string;
	entity_id: string;
	from_state: string | null;
	to_state: string;
	triggered_by: string;
	event_type?: string;
	transition_reason?: string;
	metadata?: Record<string, any>;
	error_details?: Record<string, any>;
	created_at: string;
}

export interface CurrentEntityState {
	entity_type: string;
	entity_id: string;
	current_state: string;
	state_updated_at: string;
	last_updated_by: string;
	last_event_type?: string;
	last_metadata?: Record<string, any>;
}

export interface TransitionOptions {
	triggeredBy?: string;
	eventType?: string;
	reason?: string;
	metadata?: Record<string, any>;
	errorDetails?: Record<string, any>;
}

/**
 * A general-purpose state management service that provides:
 * - State transitions with full audit trail
 * - History tracking for all entities
 * - Validation and error handling
 * - Easy querying of current and historical states
 */
export class StateManagementService {
	private supabase: SupabaseClient;

	constructor() {
		this.supabase = createClient(supabaseUrl, supabaseServiceKey);
	}

	/**
	 * Transition an entity to a new state
	 */
	async transitionState(
		entityType: string,
		entityId: string,
		toState: string,
		options: TransitionOptions = {},
	): Promise<string> {
		const {
			triggeredBy = "system",
			eventType,
			reason,
			metadata,
			errorDetails,
		} = options;

		try {
			const { data, error } = await this.supabase.rpc(
				"transition_entity_state",
				{
					p_entity_type: entityType,
					p_entity_id: entityId,
					p_to_state: toState,
					p_triggered_by: triggeredBy,
					p_event_type: eventType,
					p_transition_reason: reason,
					p_metadata: metadata,
					p_error_details: errorDetails,
				},
			);

			if (error) {
				throw new Error(
					`Failed to transition state: ${error.message}`,
				);
			}

			return data as string; // Returns transition ID
		} catch (error) {
			console.error("State transition failed:", {
				entityType,
				entityId,
				toState,
				error,
			});
			throw error;
		}
	}

	/**
	 * Get the current state of an entity
	 */
	async getCurrentState(
		entityType: string,
		entityId: string,
	): Promise<CurrentEntityState | null> {
		const { data, error } = await this.supabase
			.from("current_entity_states")
			.select("*")
			.eq("entity_type", entityType)
			.eq("entity_id", entityId)
			.maybeSingle();

		if (error) {
			throw new Error(`Failed to get current state: ${error.message}`);
		}

		return data as CurrentEntityState | null;
	}

	/**
	 * Get state history for an entity
	 */
	async getStateHistory(
		entityType: string,
		entityId: string,
		limit = 50,
	): Promise<StateTransition[]> {
		const { data, error } = await this.supabase.rpc(
			"get_entity_state_history",
			{
				p_entity_type: entityType,
				p_entity_id: entityId,
				p_limit: limit,
			},
		);

		if (error) {
			throw new Error(`Failed to get state history: ${error.message}`);
		}

		return data as StateTransition[];
	}

	/**
	 * Check if an entity is in a specific state
	 */
	async isInState(
		entityType: string,
		entityId: string,
		expectedState: string,
	): Promise<boolean> {
		const currentState = await this.getCurrentState(entityType, entityId);
		return currentState?.current_state === expectedState;
	}

	/**
	 * Check if an entity is in any of the specified states
	 */
	async isInAnyState(
		entityType: string,
		entityId: string,
		expectedStates: string[],
	): Promise<boolean> {
		const currentState = await this.getCurrentState(entityType, entityId);
		return currentState
			? expectedStates.includes(currentState.current_state)
			: false;
	}

	/**
	 * Wait for an entity to reach a specific state (with timeout)
	 */
	async waitForState(
		entityType: string,
		entityId: string,
		expectedState: string,
		timeoutMs = 30000,
		intervalMs = 1000,
	): Promise<CurrentEntityState> {
		const startTime = Date.now();

		while (Date.now() - startTime < timeoutMs) {
			const currentState = await this.getCurrentState(
				entityType,
				entityId,
			);

			if (currentState?.current_state === expectedState) {
				return currentState;
			}

			if (
				currentState?.current_state === "failed" ||
				currentState?.current_state === "cancelled"
			) {
				throw new Error(
					`Entity reached terminal state: ${currentState.current_state}`,
				);
			}

			await new Promise((resolve) => setTimeout(resolve, intervalMs));
		}

		throw new Error(
			`Timeout waiting for entity to reach state: ${expectedState}`,
		);
	}

	/**
	 * Get all entities in a specific state
	 */
	async getEntitiesInState(
		entityType: string,
		state: string,
	): Promise<CurrentEntityState[]> {
		const { data, error } = await this.supabase
			.from("current_entity_states")
			.select("*")
			.eq("entity_type", entityType)
			.eq("current_state", state);

		if (error) {
			throw new Error(
				`Failed to get entities in state: ${error.message}`,
			);
		}

		return data as CurrentEntityState[];
	}

	/**
	 * Get state transition statistics
	 */
	async getStateStatistics(
		entityType: string,
		fromDate?: string,
		toDate?: string,
	): Promise<Record<string, number>> {
		let query = this.supabase
			.from("state_transitions")
			.select("to_state")
			.eq("entity_type", entityType);

		if (fromDate) {
			query = query.gte("created_at", fromDate);
		}
		if (toDate) {
			query = query.lte("created_at", toDate);
		}

		const { data, error } = await query;

		if (error) {
			throw new Error(
				`Failed to get state statistics: ${error.message}`,
			);
		}

		// Count occurrences of each state
		const statistics: Record<string, number> = {};
		for (const row of data) {
			statistics[row.to_state] = (statistics[row.to_state] || 0) + 1;
		}

		return statistics;
	}

	/**
	 * Bulk transition multiple entities to the same state
	 */
	async bulkTransition(
		entityType: string,
		entityIds: string[],
		toState: string,
		options: TransitionOptions = {},
	): Promise<string[]> {
		const transitionIds: string[] = [];

		for (const entityId of entityIds) {
			try {
				const transitionId = await this.transitionState(
					entityType,
					entityId,
					toState,
					options,
				);
				transitionIds.push(transitionId);
			} catch (error) {
				console.error(
					`Failed to transition entity ${entityId}:`,
					error,
				);
				// Continue with other entities, don't fail the whole batch
			}
		}

		return transitionIds;
	}
}

// Export a singleton instance for convenience
export const stateManager = new StateManagementService();
