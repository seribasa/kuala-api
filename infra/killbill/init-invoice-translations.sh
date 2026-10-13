#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: init-invoice-translations.sh [options]

Upload invoice translation properties files to Kill Bill for the specified tenant.

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

upload_translation() {
  local locale=$1
  local properties_file=$2

  [ -f "$properties_file" ] || error "Properties file not found: ${properties_file}"
  echo "[INFO] Uploading translation for ${locale} to Kill Bill at ${KILLBILL_URL}"

  local response_body=$(mktemp)
  local response_headers=$(mktemp)

  local curl_exit=0
  local http_status=$(curl -sS -w "%{http_code}" -o "$response_body" -D "$response_headers" \
    -X POST "${KILLBILL_URL}/1.0/kb/invoices/translation/${locale}?deleteIfExists=true" \
    -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
    -H "X-Killbill-ApiKey: ${API_KEY}" \
    -H "X-Killbill-ApiSecret: ${API_SECRET}" \
    -H "Content-Type: text/plain" \
    -H "Accept: text/plain" \
    -H "X-Killbill-CreatedBy: ${CREATED_BY}" \
    -H "X-Killbill-Reason: kuala-bootstrap" \
    -H "X-Killbill-Comment: initializing invoice translations" \
    --data-binary @"${properties_file}") || curl_exit=$?

  if [ "$curl_exit" -ne 0 ]; then
    echo "[ERROR] Unable to reach Kill Bill at ${KILLBILL_URL}." >&2
    echo "[ERROR] curl exit code: ${curl_exit}" >&2
    rm -f "$response_body" "$response_headers"
    exit "$curl_exit"
  fi

  if [ "$http_status" = "201" ]; then
    echo "[SUCCESS] Translation for ${locale} uploaded successfully."
  else
    echo "[ERROR] Failed to upload translation for ${locale} (HTTP ${http_status})." >&2
    if [ -s "$response_body" ]; then
      echo "[ERROR] Response:" >&2
      cat "$response_body" >&2
    fi
    rm -f "$response_body" "$response_headers"
    exit 1
  fi

  rm -f "$response_body" "$response_headers"
}

# Upload EN translation
upload_translation "en_US" "${SCRIPT_DIR}/invoice-translation-en_US.properties"

# Upload ID translation
upload_translation "id_ID" "${SCRIPT_DIR}/invoice-translation-id_ID.properties"

echo "[SUCCESS] All invoice translations uploaded."
exit 0
