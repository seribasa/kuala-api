#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: init-tenant.sh --api-key <key> --api-secret <secret> [options]

Create a Kill Bill tenant against a local or remote instance.

Required arguments:
  -k, --api-key <key>       Tenant API key to register.
  -s, --api-secret <secret> Tenant API secret to register.

Optional arguments:
      --killbill-url <url>  Base URL for Kill Bill (default: http://127.0.0.1:8080).
      --created-by <name>   Value for X-Killbill-CreatedBy header (default: kuala-bootstrap).
      --admin-user <user>   Kill Bill admin username for authentication (default: admin).
      --admin-password <pw> Kill Bill admin password for authentication (default: password).
      --use-global-default  Configure tenant with the default catalog.
  -h, --help                Show this help message and exit.

Environment variables:
  KILLBILL_URL      Alternative way to set --killbill-url.
  CREATED_BY        Alternative way to set --created-by.
  ADMIN_USER        Alternative way to set --admin-user.
  ADMIN_PASSWORD    Alternative way to set --admin-password.

Examples:
  ./init-tenant.sh --api-key demo --api-secret demosecret
  ./init-tenant.sh -k demo -s demosecret
EOF
}

error() {
  echo "[ERROR] $*" >&2
  exit 1
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    error "Missing required command: $1"
  fi
}

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yaml"

KILLBILL_URL=${KILLBILL_URL:-"http://127.0.0.1:8080"}
CREATED_BY=${CREATED_BY:-"kuala-bootstrap"}
ADMIN_USER=${ADMIN_USER:-"admin"}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-"password"}

API_KEY=""
API_SECRET=""
EXTERNAL_KEY=""
USE_GLOBAL_DEFAULT="false"

while [ $# -gt 0 ]; do
  case "$1" in
    -k|--api-key)
      [ $# -ge 2 ] || error "--api-key requires a value"
      API_KEY="$2"
      shift 2
      ;;
    -s|--api-secret)
      [ $# -ge 2 ] || error "--api-secret requires a value"
      API_SECRET="$2"
      shift 2
      ;;
    --killbill-url)
      [[ $# -ge 2 ]] || error "--killbill-url requires a value"
      KILLBILL_URL="$2"
      shift 2
      ;;
    --created-by)
      [[ $# -ge 2 ]] || error "--created-by requires a value"
      CREATED_BY="$2"
      shift 2
      ;;
    --admin-user)
      [[ $# -ge 2 ]] || error "--admin-user requires a value"
      ADMIN_USER="$2"
      shift 2
      ;;
    --admin-password)
      [[ $# -ge 2 ]] || error "--admin-password requires a value"
      ADMIN_PASSWORD="$2"
      shift 2
      ;;
    --use-global-default)
      USE_GLOBAL_DEFAULT="true"
      shift 1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      error "Unknown option: $1"
      ;;
  esac
done

[ -n "$API_KEY" ] || { usage; error "--api-key is required"; }
[ -n "$API_SECRET" ] || { usage; error "--api-secret is required"; }

require_command curl

query_suffix=""
if [ "${USE_GLOBAL_DEFAULT}" = "true" ]; then
  query_suffix="?useGlobalDefault=true"
fi

payload=$(mktemp)
response_body=$(mktemp)
response_headers=$(mktemp)
trap 'rm -f "$payload" "$response_body" "$response_headers"' EXIT

if [ -n "$EXTERNAL_KEY" ]; then
  cat >"$payload" <<EOF
{
  "apiKey": "${API_KEY}",
  "apiSecret": "${API_SECRET}",
  "externalKey": "${EXTERNAL_KEY}"
}
EOF
else
  cat >"$payload" <<EOF
{
  "apiKey": "${API_KEY}",
  "apiSecret": "${API_SECRET}"
}
EOF
fi

http_status=$(curl -sS -w "%{http_code}" -o "$response_body" -D "$response_headers" \
  -X POST "${KILLBILL_URL}/1.0/kb/tenants${query_suffix}" \
  -H "Content-Type: application/json" \
  -H "X-Killbill-CreatedBy: ${CREATED_BY}" \
  -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
  -d @"$payload")

if [ "$http_status" = "201" ]; then
  location_header=$(awk -F': ' 'BEGIN{IGNORECASE=1} /^Location:/ {print $2}' "$response_headers" | tail -n1 | tr -d '\r\n')
  echo "[SUCCESS] Tenant created successfully."
  if [ -n "$location_header" ]; then
    echo "[INFO] Tenant URL: ${location_header}"
  else
    echo "[INFO] Location header not returned; check Kill Bill logs if needed."
  fi
  exit 0
elif [ "$http_status" = "409" ]; then
  # Tenant already exists - treat as success for idempotency
  echo "[INFO] Tenant already exists (HTTP 409). Continuing..."
  if [ -s "$response_body" ]; then
    echo "[INFO] Response:" 
    cat "$response_body"
  fi
  exit 0
else
  echo "[ERROR] Failed to create tenant (HTTP ${http_status})." >&2
  if [ -s "$response_body" ]; then
    echo "[ERROR] Response:" >&2
    cat "$response_body" >&2
  fi
  exit 1
fi
