-- Create event_queue table for RabbitMQ fallback mode
CREATE TABLE IF NOT EXISTS public.event_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL,
    routing_key TEXT NOT NULL,
    correlation_id UUID NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_event_queue_routing_status ON public.event_queue(routing_key, status);
CREATE INDEX IF NOT EXISTS idx_event_queue_correlation ON public.event_queue(correlation_id);
CREATE INDEX IF NOT EXISTS idx_event_queue_created_at ON public.event_queue(created_at);

-- Add RLS policies
ALTER TABLE public.event_queue ENABLE ROW LEVEL SECURITY;

-- Policy for service role to manage all events
CREATE POLICY "Service role can manage event_queue" ON public.event_queue
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Policy for authenticated users to view their own events
CREATE POLICY "Users can view their own events" ON public.event_queue
    FOR SELECT
    TO authenticated
    USING (
        payload->>'userId' = auth.uid()::text
    );

COMMENT ON TABLE public.event_queue IS 'Event queue for RabbitMQ fallback mode when AMQP is unavailable';
COMMENT ON COLUMN public.event_queue.routing_key IS 'RabbitMQ routing key for event routing';
COMMENT ON COLUMN public.event_queue.payload IS 'Complete event data as JSONB';
COMMENT ON COLUMN public.event_queue.status IS 'Processing status: pending, processing, completed, failed';