-- Create a general state management system with history tracking
-- This system allows any entity to have state transitions tracked with full audit trail

-- Entity types registry - tracks what types of entities can have states
CREATE TABLE IF NOT EXISTS public.entity_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE, -- e.g., 'subscription_request', 'payment_flow', 'user_onboarding'
    description TEXT,
    allowed_states JSONB NOT NULL, -- Array of allowed state names and transitions
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- State transitions table - tracks all state changes with history
CREATE TABLE IF NOT EXISTS public.state_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Entity identification
    entity_type TEXT NOT NULL, -- References entity_types.name
    entity_id UUID NOT NULL,   -- The ID of the entity (e.g., subscription_request.correlation_id)
    
    -- State transition details
    from_state TEXT,           -- Previous state (NULL for initial state)
    to_state TEXT NOT NULL,    -- New state
    
    -- Transition metadata
    triggered_by TEXT,         -- Service/user/system that triggered the change
    event_type TEXT,          -- Event that caused the transition (e.g., 'AccountReady', 'SubscriptionCreated')
    transition_reason TEXT,    -- Human-readable reason for the transition
    
    -- Additional context
    metadata JSONB,           -- Any additional data related to the transition
    error_details JSONB,      -- Error information if transition failed
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_entity_type CHECK (entity_type ~ '^[a-z_]+$'),
    CONSTRAINT valid_states CHECK (from_state IS NULL OR length(trim(from_state)) > 0),
    CONSTRAINT different_states CHECK (from_state IS DISTINCT FROM to_state OR from_state IS NULL)
);

-- Current entity states view - provides latest state for each entity
CREATE OR REPLACE VIEW public.current_entity_states AS
WITH latest_transitions AS (
    SELECT 
        entity_type,
        entity_id,
        to_state as current_state,
        created_at as state_updated_at,
        triggered_by as last_updated_by,
        event_type as last_event_type,
        metadata as last_metadata,
        ROW_NUMBER() OVER (
            PARTITION BY entity_type, entity_id 
            ORDER BY created_at DESC
        ) as rn
    FROM public.state_transitions
)
SELECT 
    entity_type,
    entity_id,
    current_state,
    state_updated_at,
    last_updated_by,
    last_event_type,
    last_metadata
FROM latest_transitions 
WHERE rn = 1;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_state_transitions_entity ON public.state_transitions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_state_transitions_entity_created_at ON public.state_transitions(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_state_transitions_to_state ON public.state_transitions(to_state);
CREATE INDEX IF NOT EXISTS idx_state_transitions_created_at ON public.state_transitions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_state_transitions_triggered_by ON public.state_transitions(triggered_by);
CREATE INDEX IF NOT EXISTS idx_entity_types_name ON public.entity_types(name);

-- Add RLS policies
ALTER TABLE public.state_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_types ENABLE ROW LEVEL SECURITY;

-- Service role can manage everything
CREATE POLICY "Service role can manage state_transitions" ON public.state_transitions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage entity_types" ON public.entity_types
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users can view state transitions for their entities
-- (We'll need to join with the actual entity tables to enforce this)
CREATE POLICY "Users can view relevant state_transitions" ON public.state_transitions
    FOR SELECT TO authenticated USING (true); -- Will be refined based on entity ownership

-- Function to transition state with validation
CREATE OR REPLACE FUNCTION transition_entity_state(
    p_entity_type TEXT,
    p_entity_id UUID,
    p_to_state TEXT,
    p_triggered_by TEXT DEFAULT 'system',
    p_event_type TEXT DEFAULT NULL,
    p_transition_reason TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT NULL,
    p_error_details JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_current_state TEXT;
    v_transition_id UUID;
    v_entity_type_config RECORD;
BEGIN
    -- Get entity type configuration
    SELECT * INTO v_entity_type_config
    FROM public.entity_types
    WHERE name = p_entity_type;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Entity type "%" not found', p_entity_type;
    END IF;
    
    -- Get current state
    SELECT current_state INTO v_current_state
    FROM public.current_entity_states
    WHERE entity_type = p_entity_type AND entity_id = p_entity_id;
    
    -- Validate state transition (basic validation - can be enhanced)
    -- You can add more complex validation logic here based on entity_type_config.allowed_states
    
    -- Insert the state transition
    INSERT INTO public.state_transitions (
        entity_type,
        entity_id,
        from_state,
        to_state,
        triggered_by,
        event_type,
        transition_reason,
        metadata,
        error_details
    ) VALUES (
        p_entity_type,
        p_entity_id,
        v_current_state,
        p_to_state,
        p_triggered_by,
        p_event_type,
        p_transition_reason,
        p_metadata,
        p_error_details
    ) RETURNING id INTO v_transition_id;
    
    RETURN v_transition_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get entity state history
CREATE OR REPLACE FUNCTION get_entity_state_history(
    p_entity_type TEXT,
    p_entity_id UUID,
    p_limit INTEGER DEFAULT 50
) RETURNS TABLE (
    transition_id UUID,
    from_state TEXT,
    to_state TEXT,
    triggered_by TEXT,
    event_type TEXT,
    transition_reason TEXT,
    metadata JSONB,
    error_details JSONB,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        st.id,
        st.from_state,
        st.to_state,
        st.triggered_by,
        st.event_type,
        st.transition_reason,
        st.metadata,
        st.error_details,
        st.created_at
    FROM public.state_transitions st
    WHERE st.entity_type = p_entity_type AND st.entity_id = p_entity_id
    ORDER BY st.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Insert initial entity type for subscription requests
INSERT INTO public.entity_types (name, description, allowed_states) VALUES (
    'subscription_request',
    'Subscription creation workflow states',
    '{
        "states": [
            {"name": "requested", "description": "Initial subscription request"},
            {"name": "account_ready", "description": "Account service completed"},
            {"name": "creating_subscription", "description": "Subscription service processing"},
            {"name": "subscription_created", "description": "Subscription created in Kill Bill"},
            {"name": "generating_invoice", "description": "Invoice service processing"},
            {"name": "completed", "description": "All steps completed successfully"},
            {"name": "failed", "description": "Process failed"},
            {"name": "cancelled", "description": "Process cancelled"}
        ],
        "transitions": {
            "requested": ["account_ready", "failed", "cancelled"],
            "account_ready": ["creating_subscription", "failed"],
            "creating_subscription": ["subscription_created", "failed"],
            "subscription_created": ["generating_invoice", "failed"],
            "generating_invoice": ["completed", "failed"],
            "failed": ["requested"],
            "cancelled": [],
            "completed": []
        }
    }'::jsonb
) ON CONFLICT (name) DO UPDATE SET 
    allowed_states = EXCLUDED.allowed_states,
    description = EXCLUDED.description;

-- Add comments
COMMENT ON TABLE public.entity_types IS 'Registry of entity types that can have state transitions tracked';
COMMENT ON TABLE public.state_transitions IS 'Audit trail of all state transitions for any entity type';
COMMENT ON VIEW public.current_entity_states IS 'Current state of all entities, derived from latest transitions';
COMMENT ON FUNCTION transition_entity_state IS 'Function to safely transition entity state with validation and audit trail';
COMMENT ON FUNCTION get_entity_state_history IS 'Function to retrieve state transition history for an entity';

COMMENT ON COLUMN public.state_transitions.entity_type IS 'Type of entity (references entity_types.name)';
COMMENT ON COLUMN public.state_transitions.entity_id IS 'Unique identifier of the entity instance';
COMMENT ON COLUMN public.state_transitions.from_state IS 'Previous state (NULL for initial state)';
COMMENT ON COLUMN public.state_transitions.to_state IS 'New state after transition';
COMMENT ON COLUMN public.state_transitions.triggered_by IS 'Service, user, or system that triggered the transition';
COMMENT ON COLUMN public.state_transitions.event_type IS 'Domain event that caused this state transition';
COMMENT ON COLUMN public.state_transitions.metadata IS 'Additional context data for the transition';
COMMENT ON COLUMN public.state_transitions.error_details IS 'Error information if transition was due to failure';