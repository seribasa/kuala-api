#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: init-plans-catalog.sh [options]

Upload a catalog XML file to Kill Bill for the specified tenant.

Optional arguments:
      --catalog-file <path> Path to catalog XML file (default: plans.xml in script directory).
      --killbill-url <url>  Base URL for Kill Bill (default: http://127.0.0.1:8080).
      --admin-user <user>   Kill Bill admin username for authentication (default: admin).
      --admin-password <pw> Kill Bill admin password for authentication (default: password).
      --api-key <key>       Tenant API key (X-Killbill-ApiKey header).
      --api-secret <secret> Tenant API secret (X-Killbill-ApiSecret header).
      --created-by <name>   Value for X-Killbill-CreatedBy header (default: kuala-bootstrap).
      --reason <text>       Value for X-Killbill-Reason header (default: catalog-upload).
      --comment <text>      Value for X-Killbill-Comment header (default: Initial catalog upload).
  -h, --help                Show this help message and exit.

Environment variables:
  KILLBILL_URL      Alternative way to set --killbill-url.
  ADMIN_USER        Alternative way to set --admin-user.
  ADMIN_PASSWORD    Alternative way to set --admin-password.
  KILLBILL_API_KEY     Alternative way to set --api-key.
  KILLBILL_API_SECRET  Alternative way to set --api-secret.
  CREATED_BY        Alternative way to set --created-by.

Examples:
  ./init-plans-catalog.sh --api-key demo --api-secret demosecret
  ./init-plans-catalog.sh --catalog-file custom-plans.xml --api-key demo --api-secret demosecret
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

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEFAULT_CATALOG="${SCRIPT_DIR}/plans.xml"

CATALOG_FILE="${DEFAULT_CATALOG}"
KILLBILL_URL=${KILLBILL_URL:-"http://127.0.0.1:8080"}
ADMIN_USER=${ADMIN_USER:-"admin"}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-"password"}
API_KEY=${KILLBILL_API_KEY:-""}
API_SECRET=${KILLBILL_API_SECRET:-""}
CREATED_BY=${CREATED_BY:-"kuala-bootstrap"}
REASON="catalog-upload"
COMMENT="Initial catalog upload"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --catalog-file)
      [[ $# -ge 2 ]] || error "--catalog-file requires a value"
      CATALOG_FILE="$2"
      shift 2
      ;;
    --killbill-url)
      [[ $# -ge 2 ]] || error "--killbill-url requires a value"
      KILLBILL_URL="$2"
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
    --api-key)
      [[ $# -ge 2 ]] || error "--api-key requires a value"
      API_KEY="$2"
      shift 2
      ;;
    --api-secret)
      [[ $# -ge 2 ]] || error "--api-secret requires a value"
      API_SECRET="$2"
      shift 2
      ;;
    --created-by)
      [[ $# -ge 2 ]] || error "--created-by requires a value"
      CREATED_BY="$2"
      shift 2
      ;;
    --reason)
      [[ $# -ge 2 ]] || error "--reason requires a value"
      REASON="$2"
      shift 2
      ;;
    --comment)
      [[ $# -ge 2 ]] || error "--comment requires a value"
      COMMENT="$2"
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

[[ -n "$API_KEY" ]] || { usage; error "--api-key is required"; }
[[ -n "$API_SECRET" ]] || { usage; error "--api-secret is required"; }

require_command curl

[[ -f "$CATALOG_FILE" ]] || error "Catalog file not found: ${CATALOG_FILE}"

echo "[INFO] Uploading catalog from ${CATALOG_FILE} to Kill Bill at ${KILLBILL_URL}"

response_body=$(mktemp)
response_headers=$(mktemp)
trap 'rm -f "$response_body" "$response_headers"' EXIT

# Read catalog file content into a variable
catalog_content=$(cat "${CATALOG_FILE}")

curl_exit=0
http_status=$(curl -sS -w "%{http_code}" -o "$response_body" -D "$response_headers" \
  -X POST "${KILLBILL_URL}/1.0/kb/catalog/xml" \
  -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
  -H "X-Killbill-ApiKey: ${API_KEY}" \
  -H "X-Killbill-ApiSecret: ${API_SECRET}" \
  -H "Content-Type: text/xml" \
  -H "Accept: application/json" \
  -H "X-Killbill-CreatedBy: ${CREATED_BY}" \
  -H "X-Killbill-Reason: ${REASON}" \
  -H "X-Killbill-Comment: ${COMMENT}" \
  -d "${catalog_content}") || curl_exit=$?

if (( curl_exit != 0 )); then
  echo "[ERROR] Unable to reach Kill Bill at ${KILLBILL_URL}." >&2
  echo "[ERROR] curl exit code: ${curl_exit}" >&2
  echo "[ERROR] Ensure the Kill Bill service is running and reachable." >&2
  exit "$curl_exit"
fi

if [[ "$http_status" == "201" ]]; then
  echo "[SUCCESS] Catalog uploaded successfully."
  exit 0
else
  echo "[ERROR] Failed to upload catalog (HTTP ${http_status})." >&2
  if [[ -s "$response_body" ]]; then
    echo "[ERROR] Response:" >&2
    cat "$response_body" >&2
  fi
  exit 1
fi
