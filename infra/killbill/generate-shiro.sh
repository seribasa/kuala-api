#!/bin/sh
set -e

# Generate shiro.ini from template
envsubst < /tmp/shiro.ini.template > /var/lib/killbill/shiro.ini || true

echo "[INFO] Generated shiro.ini with user: ${ADMIN_USER}"

# Execute the original Kill Bill startup script
exec /var/lib/killbill/killbill.sh
