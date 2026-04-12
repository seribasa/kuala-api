# Subscription Service Dockerfile
# Deno-based microservice that handles Kill Bill subscription creation
# and orchestrates the subscription SAGA workflow via RabbitMQ

FROM denoland/deno:debian

# Install curl for health check
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace configuration
COPY deno.json deno.lock ./

# Copy shared modules (used via @shared/ import alias)
COPY supabase/functions/_shared ./supabase/functions/_shared

# Copy service source code
COPY services/subscription-service ./services/subscription-service

# Cache dependencies
RUN deno cache \
    --config=deno.json \
    services/subscription-service/index.ts

# Expose health check port
EXPOSE 8003

# Health check: subscription-service serves status JSON on port 8003
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8003 || exit 1

CMD ["deno", "run", "--allow-all", "--config=deno.json", "services/subscription-service/index.ts"]
