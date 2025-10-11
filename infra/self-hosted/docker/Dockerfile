FROM denoland/deno:alpine

WORKDIR /app

# Cache dependencies
RUN deno cache --reload deno.json

# Copy source code
COPY ../../../ .

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD deno eval "fetch('http://localhost:8080/health').then(() => Deno.exit(0)).catch(() => Deno.exit(1))"

WORKDIR /supabase/functions/kuala
# Start the application
CMD ["deno", "task", "start"]
