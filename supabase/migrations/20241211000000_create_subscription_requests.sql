-- Create subscription_requests table for saga state management
-- This table tracks the state of subscription creation workflows across multiple services

CREATE TABLE IF NOT EXISTS public.subscription_requests (
    -- Primary identifier
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Saga coordination fields
    correlation_id UUID NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'requested' CHECK (
        status IN (
            'requested',           -- Initial state when subscription is requested
            'account_ready',       -- Account service has processed the request
            'subscription_created', -- Subscription service has created the subscription
            'generating_invoice',  -- Invoice service is processing
            'completed',           -- All services have completed successfully
            'failed'               -- One or more services failed
        )
    ),
    
    -- User and subscription details
    user_id UUID NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    
    -- Kill Bill integration fields
    account_id TEXT,           -- Kill Bill account ID
    subscription_id TEXT,      -- Kill Bill subscription ID
    bundle_id TEXT,           -- Kill Bill bundle ID
    invoice_id TEXT,          -- Generated invoice ID
    
    -- Error handling
    error_message TEXT,        -- Error details if status is 'failed'
    retry_count INTEGER DEFAULT 0,
    
    -- Timestamps for saga tracking
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata for auditing and debugging
    request_payload JSONB,     -- Original request data
    last_processed_event TEXT, -- Last event type processed
    processing_notes TEXT[]    -- Array of processing notes/logs
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_subscription_requests_correlation_id ON public.subscription_requests(correlation_id);
CREATE INDEX IF NOT EXISTS idx_subscription_requests_user_id ON public.subscription_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_requests_status ON public.subscription_requests(status);
CREATE INDEX IF NOT EXISTS idx_subscription_requests_created_at ON public.subscription_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_subscription_requests_updated_at ON public.subscription_requests(updated_at);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_subscription_requests_user_status ON public.subscription_requests(user_id, status);

-- Add RLS policies
ALTER TABLE public.subscription_requests ENABLE ROW LEVEL SECURITY;

-- Policy for service role to manage all subscription requests
CREATE POLICY "Service role can manage subscription_requests" ON public.subscription_requests
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Policy for authenticated users to view their own subscription requests
CREATE POLICY "Users can view their own subscription requests" ON public.subscription_requests
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Policy for authenticated users to create their own subscription requests
CREATE POLICY "Users can create their own subscription requests" ON public.subscription_requests
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Function to update the updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_subscription_requests_updated_at
    BEFORE UPDATE ON public.subscription_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE public.subscription_requests IS 'Saga state table for tracking subscription creation workflows across microservices';
COMMENT ON COLUMN public.subscription_requests.correlation_id IS 'Unique identifier for correlating events across services in the saga';
COMMENT ON COLUMN public.subscription_requests.status IS 'Current state of the subscription creation saga';
COMMENT ON COLUMN public.subscription_requests.account_id IS 'Kill Bill account ID assigned during account creation';
COMMENT ON COLUMN public.subscription_requests.subscription_id IS 'Kill Bill subscription ID assigned during subscription creation';
COMMENT ON COLUMN public.subscription_requests.bundle_id IS 'Kill Bill bundle ID for the subscription';
COMMENT ON COLUMN public.subscription_requests.invoice_id IS 'Generated invoice ID from the invoice service';
COMMENT ON COLUMN public.subscription_requests.request_payload IS 'Original subscription request data for debugging and replay';
COMMENT ON COLUMN public.subscription_requests.last_processed_event IS 'Last domain event type that was processed for this saga';
COMMENT ON COLUMN public.subscription_requests.processing_notes IS 'Array of processing notes for debugging and audit trail';