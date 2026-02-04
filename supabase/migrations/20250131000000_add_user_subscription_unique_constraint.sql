-- Add unique constraint to ensure 1 user can only have 1 active subscription correlation ID event
-- This prevents race conditions where a user might create multiple subscription requests simultaneously

-- Create a table to track active subscription requests per user
-- This provides a single point of truth for the unique constraint
CREATE TABLE IF NOT EXISTS public.user_active_subscription_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL UNIQUE,  -- Ensures only 1 active request per user
    correlation_id UUID NOT NULL UNIQUE,  -- Ensures correlation_id is also unique
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_user_active_subscription_requests_user_id 
    ON public.user_active_subscription_requests(user_id);
    
CREATE INDEX IF NOT EXISTS idx_user_active_subscription_requests_correlation_id 
    ON public.user_active_subscription_requests(correlation_id);

-- Enable RLS
ALTER TABLE public.user_active_subscription_requests ENABLE ROW LEVEL SECURITY;

-- Service role can manage everything
CREATE POLICY "Service role can manage user_active_subscription_requests" 
    ON public.user_active_subscription_requests
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Users can view their own active subscription requests
CREATE POLICY "Users can view their own active subscription requests" 
    ON public.user_active_subscription_requests
    FOR SELECT TO authenticated 
    USING (user_id = auth.uid()::text);

-- Function to acquire a subscription lock for a user
-- Returns the correlation_id if successful, NULL if user already has an active request
CREATE OR REPLACE FUNCTION acquire_user_subscription_lock(
    p_user_id TEXT,
    p_correlation_id UUID
) RETURNS UUID AS $$
DECLARE
    v_result UUID;
BEGIN
    -- Try to insert the lock record
    INSERT INTO public.user_active_subscription_requests (user_id, correlation_id)
    VALUES (p_user_id, p_correlation_id)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING correlation_id INTO v_result;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to release a subscription lock for a user
-- Should be called when subscription process completes (success or failure)
CREATE OR REPLACE FUNCTION release_user_subscription_lock(
    p_user_id TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM public.user_active_subscription_requests
    WHERE user_id = p_user_id;
    
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    
    RETURN v_deleted > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to release a subscription lock by correlation_id
-- Useful when we only have the correlation_id
CREATE OR REPLACE FUNCTION release_subscription_lock_by_correlation(
    p_correlation_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM public.user_active_subscription_requests
    WHERE correlation_id = p_correlation_id;
    
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    
    RETURN v_deleted > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get active subscription request for a user
CREATE OR REPLACE FUNCTION get_user_active_subscription_request(
    p_user_id TEXT
) RETURNS TABLE (
    correlation_id UUID,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        uasr.correlation_id,
        uasr.created_at
    FROM public.user_active_subscription_requests uasr
    WHERE uasr.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments for documentation
COMMENT ON TABLE public.user_active_subscription_requests IS 
    'Tracks active subscription requests per user. The UNIQUE constraint on user_id ensures only 1 active request at a time.';
    
COMMENT ON FUNCTION acquire_user_subscription_lock IS 
    'Atomically acquires a subscription lock for a user. Returns correlation_id if successful, NULL if user already has an active request.';
    
COMMENT ON FUNCTION release_user_subscription_lock IS 
    'Releases a subscription lock for a user. Should be called when subscription process completes.';
    
COMMENT ON FUNCTION release_subscription_lock_by_correlation IS 
    'Releases a subscription lock by correlation_id. Useful when we only have the correlation_id.';
    
COMMENT ON FUNCTION get_user_active_subscription_request IS 
    'Gets the active subscription request for a user if one exists.';
