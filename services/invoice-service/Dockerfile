# Invoice Service Dockerfile
# Deno-based microservice that handles Kill Bill invoice generation
# and publishes invoice.generated events via RabbitMQ

FROM denoland/deno:debian

# Install curl for health check
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace configuration
COPY deno.json deno.lock ./

# Copy shared modules (used via @shared/ import alias)
COPY supabase/functions/_shared ./supabase/functions/_shared

# Copy service source code
COPY services/invoice-service ./services/invoice-service

# Cache dependencies
RUN deno cache \
    --config=deno.json \
    services/invoice-service/index.ts

# Expose health check port
EXPOSE 8002

# Health check: invoice-service serves status JSON on port 8002
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8002 || exit 1

CMD ["deno", "run", "--allow-all", "--config=deno.json", "services/invoice-service/index.ts"]
