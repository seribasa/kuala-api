#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: init-invoice-template.sh [options]

Upload custom HTML Mustache invoice template to Kill Bill for the specified tenant.

Optional arguments:
      --killbill-url <url>  Base URL for Kill Bill (default: http://127.0.0.1:8080).
      --admin-user <user>   Kill Bill admin username for authentication (default: admin).
      --admin-password <pw> Kill Bill admin password for authentication (default: password).
      --api-key <key>       Tenant API key (X-Killbill-ApiKey header).
      --api-secret <secret> Tenant API secret (X-Killbill-ApiSecret header).
      --created-by <name>   Value for X-Killbill-CreatedBy header (default: kuala-bootstrap).
  -h, --help                Show this help message and exit.

Environment variables:
  KILLBILL_URL      Alternative way to set --killbill-url.
  ADMIN_USER        Alternative way to set --admin-user.
  ADMIN_PASSWORD    Alternative way to set --admin-password.
  KILLBILL_API_KEY     Alternative way to set --api-key.
  KILLBILL_API_SECRET  Alternative way to set --api-secret.
  CREATED_BY        Alternative way to set --created-by.
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

KILLBILL_URL=${KILLBILL_URL:-"http://127.0.0.1:8080"}
ADMIN_USER=${ADMIN_USER:-"admin"}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-"password"}
API_KEY=${KILLBILL_API_KEY:-""}
API_SECRET=${KILLBILL_API_SECRET:-""}
CREATED_BY=${CREATED_BY:-"kuala-bootstrap"}

while [ $# -gt 0 ]; do
  case "$1" in
    --killbill-url)
      [ $# -ge 2 ] || error "--killbill-url requires a value"
      KILLBILL_URL="$2"
      shift 2
      ;;
    --admin-user)
      [ $# -ge 2 ] || error "--admin-user requires a value"
      ADMIN_USER="$2"
      shift 2
      ;;
    --admin-password)
      [ $# -ge 2 ] || error "--admin-password requires a value"
      ADMIN_PASSWORD="$2"
      shift 2
      ;;
    --api-key)
      [ $# -ge 2 ] || error "--api-key requires a value"
      API_KEY="$2"
      shift 2
      ;;
    --api-secret)
      [ $# -ge 2 ] || error "--api-secret requires a value"
      API_SECRET="$2"
      shift 2
      ;;
    --created-by)
      [ $# -ge 2 ] || error "--created-by requires a value"
      CREATED_BY="$2"
      shift 2
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

TEMPLATE_FILE="${SCRIPT_DIR}/HtmlInvoiceTemplate.mustache"
[ -f "$TEMPLATE_FILE" ] || error "Template file not found: ${TEMPLATE_FILE}"

echo "[INFO] Uploading invoice template to Kill Bill at ${KILLBILL_URL}"

response_body=$(mktemp)
response_headers=$(mktemp)

curl_exit=0
http_status=$(curl -sS -w "%{http_code}" -o "$response_body" -D "$response_headers" \
  -X POST "${KILLBILL_URL}/1.0/kb/invoices/template" \
  -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
  -H "X-Killbill-ApiKey: ${API_KEY}" \
  -H "X-Killbill-ApiSecret: ${API_SECRET}" \
  -H "Content-Type: text/html" \
  -H "Accept: application/json" \
  -H "X-Killbill-CreatedBy: ${CREATED_BY}" \
  -H "X-Killbill-Reason: kuala-bootstrap" \
  -H "X-Killbill-Comment: initializing custom invoice template" \
  --data-binary @"${TEMPLATE_FILE}") || curl_exit=$?

if [ "$curl_exit" -ne 0 ]; then
  echo "[ERROR] Unable to reach Kill Bill at ${KILLBILL_URL}." >&2
  echo "[ERROR] curl exit code: ${curl_exit}" >&2
  rm -f "$response_body" "$response_headers"
  exit "$curl_exit"
fi

if [ "$http_status" = "201" ]; then
  echo "[SUCCESS] Invoice template uploaded successfully."
else
  echo "[ERROR] Failed to upload invoice template (HTTP ${http_status})." >&2
  if [ -s "$response_body" ]; then
    echo "[ERROR] Response:" >&2
    cat "$response_body" >&2
  fi
  rm -f "$response_body" "$response_headers"
  exit 1
fi

rm -f "$response_body" "$response_headers"
exit 0
