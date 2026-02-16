# KONG API Gateway Setup

KONG API Gateway provides unified routing for all Kuala API microservices.

## Quick Start

```bash
# Start KONG
docker compose up -d

# Verify KONG is running
curl -i http://localhost:8000

# Check KONG Admin API
curl -i http://localhost:8001
```

## Service Routes

| Route | Service | Internal Port | Description |
|-------|---------|---------------|-------------|
| `/api/accounts/*` | account-service | 9001 | Account management |
| `/api/invoices/*` | invoice-service | 9002 | Invoice operations |
| `/api/subscriptions/*` | subscription-service | 9003 | Subscription management |
| `/api/billing/*` | killbill | 8080 | Kill Bill passthrough |
| `/api/v1/*` | supabase-functions | 54321 | Edge Functions API |
| `/admin/rabbitmq/*` | rabbitmq-mgmt | 15672 | RabbitMQ Management |

## Ports

| Port | Protocol | Description |
|------|----------|-------------|
| 8000 | HTTP | Proxy (main entry point) |
| 8443 | HTTPS | Proxy (SSL) |
| 8001 | HTTP | Admin API |
| 8444 | HTTPS | Admin API (SSL) |

## Enabled Plugins

- **CORS**: Cross-origin resource sharing
- **Rate Limiting**: 100 requests/minute per IP
- **Correlation ID**: Request tracing with `X-Correlation-Id`
- **File Log**: Request/response logging to stdout

## Configuration

KONG runs in **DB-less mode** using declarative configuration (`kong.yaml`).

To update routes or plugins:
1. Edit `kong.yaml`
2. Restart KONG: `docker compose restart kong`

## Full Stack Startup

```bash
# 1. Start infrastructure
cd /path/to/kuala-api

# Start RabbitMQ
docker compose -f infra/rabbitMQ/docker-compose.yml up -d

# Start Kill Bill
docker compose -f infra/killbill/docker-compose.yaml up -d

# Start KONG
docker compose -f infra/kong/docker-compose.yaml up -d

# 2. Start services
docker compose -f services/docker-compose.yaml up -d

# 3. Start Supabase (local dev)
supabase start
```

## Testing Routes

```bash
# Test via KONG gateway
curl http://localhost:8000/api/v1/kuala/plans
curl http://localhost:8000/api/billing/1.0/healthcheck
```

## Troubleshooting

```bash
# Check KONG logs
docker logs kong-kuala

# Validate configuration
docker exec kong-kuala kong config parse /kong/kong.yaml

# Check service health
curl http://localhost:8001/status
```
