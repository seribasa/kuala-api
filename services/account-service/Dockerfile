# Account Service Dockerfile
# Deno-based microservice that handles Kill Bill account creation
# and publishes account.ready events via RabbitMQ

FROM dhi.io/deno:2

WORKDIR /app

# Copy workspace configuration
COPY deno.json deno.lock ./

# Copy shared modules (used via @shared/ import alias)
COPY supabase/functions/_shared ./supabase/functions/_shared

# Copy service source code
COPY services/account-service ./services/account-service

# Cache dependencies
RUN ["deno", "cache", "--config=deno.json", "services/account-service/index.ts"]

# Expose health check port
EXPOSE 8001

# Health check using deno eval (distroless image, no curl/sh available)
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD ["deno", "eval", "const r = await fetch('http://localhost:8001'); if(!r.ok) Deno.exit(1);"]

CMD ["run", "--allow-all", "--config=deno.json", "services/account-service/index.ts"]
