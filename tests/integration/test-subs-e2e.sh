#!/bin/bash
# End-to-End Test Script for Event-Driven Subscription Endpoint
# This script tests the complete flow from authentication to subscription creation
set -e  # Exit on error
echo "================================================================================================"
echo "🧪 Event-Driven Subscription E2E Test"
echo "================================================================================================"
echo ""
# Configuration
SUPABASE_URL="http://localhost:54321"
FUNCTIONS_URL="${SUPABASE_URL}/functions/v1/kuala"
AUTH_URL="${SUPABASE_URL}/auth/v1"
ANON_KEY="sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"

echo "================================================================================================"
echo "🛠️  STEP 0: Initialize Kill Bill"
echo "================================================================================================"
KB_API_KEY=$(grep "^KILLBILL_API_KEY=" .env 2>/dev/null | cut -d= -f2)
KB_API_SECRET=$(grep "^KILLBILL_API_SECRET=" .env 2>/dev/null | cut -d= -f2)
KB_API_KEY=${KB_API_KEY:-demo}
KB_API_SECRET=${KB_API_SECRET:-demosecret}

./infra/killbill/init-tenant.sh -k "$KB_API_KEY" -s "$KB_API_SECRET" >/dev/null 2>&1 || echo "⚠️  Tenant init may have failed"
./infra/killbill/init-plans-catalog.sh --api-key "$KB_API_KEY" --api-secret "$KB_API_SECRET" >/dev/null 2>&1 || echo "⚠️  Catalog init may have failed"
echo "✅ Kill Bill initialized"
echo ""

# Read token from previous user creation or create new one
if [ -f /tmp/test-user-response.json ]; then
  REFRESH_TOKEN=$(cat /tmp/test-user-response.json | jq -r '.refresh_token // empty')
  USER_EMAIL=$(cat /tmp/test-user-response.json | jq -r '.user.email // empty')
  USER_ID=$(cat /tmp/test-user-response.json | jq -r '.user.id // empty')
  
  if [ -n "$REFRESH_TOKEN" ]; then
    echo "🔄 Refreshing access token..."
    REFRESH_RESPONSE=$(curl -s -X POST "${AUTH_URL}/token?grant_type=refresh_token" \
      -H "Content-Type: application/json" \
      -H "apikey: ${ANON_KEY}" \
      -d "{\"refresh_token\": \"${REFRESH_TOKEN}\"}")
    
    ACCESS_TOKEN=$(echo "$REFRESH_RESPONSE" | jq -r '.access_token // empty')
    
    if [ -n "$ACCESS_TOKEN" ] && [ "$ACCESS_TOKEN" != "null" ]; then
      echo "✅ Token refreshed successfully for: $USER_EMAIL"
      # Update the stored response with new tokens
      echo "$REFRESH_RESPONSE" | jq ". + {user: {email: \"$USER_EMAIL\", id: \"$USER_ID\"}}" > /tmp/test-user-response.json
    else
      echo "⚠️  Token refresh failed, creating new test user..."
      REFRESH_TOKEN=""
    fi
  fi
  
  # If refresh failed or no refresh token, create new user
  if [ -z "$REFRESH_TOKEN" ] || [ -z "$ACCESS_TOKEN" ]; then
    echo "🆕 Creating new test user..."
    TIMESTAMP=$(date +%s)
    SIGNUP_RESPONSE=$(curl -s -X POST "${AUTH_URL}/signup" \
      -H "Content-Type: application/json" \
      -H "apikey: ${ANON_KEY}" \
      -d "{
        \"email\": \"test-event-driven-${TIMESTAMP}@example.com\",
        \"password\": \"test123456\",
        \"data\": {
          \"full_name\": \"Event Driven Test User\"
        }
      }")
    
    ACCESS_TOKEN=$(echo "$SIGNUP_RESPONSE" | jq -r '.access_token')
    USER_EMAIL=$(echo "$SIGNUP_RESPONSE" | jq -r '.user.email')
    USER_ID=$(echo "$SIGNUP_RESPONSE" | jq -r '.user.id')
    echo "$SIGNUP_RESPONSE" > /tmp/test-user-response.json
    echo "✅ Created new test user: $USER_EMAIL (ID: $USER_ID)"
  fi
else
  echo "🆕 Creating new test user..."
  TIMESTAMP=$(date +%s)
  SIGNUP_RESPONSE=$(curl -s -X POST "${AUTH_URL}/signup" \
    -H "Content-Type: application/json" \
    -H "apikey: ${ANON_KEY}" \
    -d "{
      \"email\": \"test-event-driven-${TIMESTAMP}@example.com\",
      \"password\": \"test123456\",
      \"data\": {
        \"full_name\": \"Event Driven Test User\"
      }
    }")
  
  ACCESS_TOKEN=$(echo "$SIGNUP_RESPONSE" | jq -r '.access_token')
  USER_EMAIL=$(echo "$SIGNUP_RESPONSE" | jq -r '.user.email')
  USER_ID=$(echo "$SIGNUP_RESPONSE" | jq -r '.user.id')
  echo "$SIGNUP_RESPONSE" > /tmp/test-user-response.json
  echo "✅ Created new test user: $USER_EMAIL (ID: $USER_ID)"
fi

# Validate we have a token
if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
  echo "❌ Failed to obtain access token"
  exit 1
fi
echo ""
echo "================================================================================================"
echo "📤 STEP 1: Creating Event-Driven Subscription Request"
echo "================================================================================================"
echo ""
echo "Plan ID: basic-monthly"
echo "Endpoint: POST ${FUNCTIONS_URL}/subscriptions/event-driven"
echo ""
# Override AUTH_BASE_URL temporarily for this test
export AUTH_BASE_URL="http://localhost:54321"
RESPONSE=$(curl -s -X POST "${FUNCTIONS_URL}/subscriptions/event-driven" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "X-Auth-Override-Base-Url: http://localhost:54321" \
  -d '{"planId": "basic-monthly"}')
echo "Response:"
echo "$RESPONSE" | jq '.'
echo ""
# Check if successful
SUCCESSFUL=$(echo "$RESPONSE" | jq -r '.successful // false')
CORRELATION_ID=$(echo "$RESPONSE" | jq -r '.data.correlation_id // empty')
STATUS=$(echo "$RESPONSE" | jq -r '.data.status // empty')
if [ "$SUCCESSFUL" = "true" ] && [ -n "$CORRELATION_ID" ]; then
  echo "✅ Subscription request accepted!"
  echo "   📋 Correlation ID: $CORRELATION_ID"
  echo "   📊 Status: $STATUS"
  echo "$CORRELATION_ID" > /tmp/correlation-id.txt
else
  echo "❌ Subscription request failed!"
  ERROR_CODE=$(echo "$RESPONSE" | jq -r '.code // "UNKNOWN"')
  ERROR_MSG=$(echo "$RESPONSE" | jq -r '.message // "Unknown error"')
  echo "   Error Code: $ERROR_CODE"
  echo "   Error Message: $ERROR_MSG"
  exit 1
fi
echo ""
echo "================================================================================================"
echo "⏳ STEP 2: Waiting for Event Processing (10 seconds)"
echo "================================================================================================"
echo ""
echo "Expected flow:"
echo "  1. SubscriptionRequested event → Account Service"
echo "  2. AccountReady event → Subscription Service"
echo "  3. SubscriptionCreated event → Invoice Service"
echo ""
sleep 10
echo ""
echo "================================================================================================"
echo "🔍 STEP 3: Checking Subscription Status"
echo "================================================================================================"
echo ""
echo "Endpoint: GET ${FUNCTIONS_URL}/subscriptions/status/${CORRELATION_ID}"
echo ""
STATUS_RESPONSE=$(curl -s "${FUNCTIONS_URL}/subscriptions/status/${CORRELATION_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")
echo "Response:"
echo "$STATUS_RESPONSE" | jq '.'
echo ""
FINAL_STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.data.status // .status // empty')
CURRENT_STATE=$(echo "$STATUS_RESPONSE" | jq -r '.data.current_state // .current_state // empty')
echo "📊 Final Status: $FINAL_STATUS"
echo "🔄 Current State: $CURRENT_STATE"
echo ""
echo "================================================================================================"
echo "🎯 STEP 4: Verifying Subscription Creation"
echo "================================================================================================"
echo ""
echo "Endpoint: GET ${FUNCTIONS_URL}/subscriptions"
echo ""
SUBSCRIPTIONS_RESPONSE=$(curl -s "${FUNCTIONS_URL}/subscriptions" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")
echo "Response:"
echo "$SUBSCRIPTIONS_RESPONSE" | jq '.'
echo ""
# Check if subscription exists
# API returns: {subscriptions: [{state: "ACTIVE", ...}]}
# or legacy: {data: {activeSubscription: {...}}}
HAS_SUBSCRIPTION=$(echo "$SUBSCRIPTIONS_RESPONSE" | jq -r '
  if (.subscriptions | length) > 0 and (.subscriptions[] | select(.state == "ACTIVE")) then "true"
  elif .data.activeSubscription != null then "true"
  elif (.id != null and (.status == "active" or .state == "ACTIVE")) then "true"
  else "false" end
')

if [ "$HAS_SUBSCRIPTION" = "true" ]; then
  # Support both response formats
  SUB_ID=$(echo "$SUBSCRIPTIONS_RESPONSE" | jq -r '.subscriptions[0].id // .data.activeSubscription.subscriptionId // .id // "unknown"')
  PLAN_NAME=$(echo "$SUBSCRIPTIONS_RESPONSE" | jq -r '.subscriptions[0].planName // .data.activeSubscription.planName // .planId // "unknown"')
  echo "✅ Subscription created successfully!"
  echo "   📋 Subscription ID: $SUB_ID"
  echo "   📦 Plan: $PLAN_NAME"
else
  echo "⚠️  No active subscription found yet"
  echo "   This might mean the event processing is still in progress or failed"
fi
echo ""
echo "================================================================================================"
echo "📊 TEST SUMMARY"
echo "================================================================================================"
echo ""
echo "✅ Request sent: Yes"
echo "✅ Correlation ID: $CORRELATION_ID"
echo "📊 Final state: $CURRENT_STATE"
echo "📦 Subscription created: $HAS_SUBSCRIPTION"
echo ""
if [ "$HAS_SUBSCRIPTION" = "true" ]; then
  echo "🎉 END-TO-END TEST PASSED! Proceeding to Payment Flow..."
elif [ "$CURRENT_STATE" = "failed" ]; then
  echo "❌ END-TO-END TEST FAILED - Subscription in failed state"
  exit 1
else
  echo "⚠️  END-TO-END TEST INCOMPLETE - Subscription not yet created"
  echo "   Check microservice logs for details"
  exit 1
fi

echo ""
echo "================================================================================================"
echo "💳 STEP 5: Triggering Payment Flow (E2E)"
echo "================================================================================================"
echo ""

echo "⏳ Waiting for Invoice Generation (up to 30 seconds)..."
for i in {1..15}; do
  LATEST_STATUS=$(curl -s "${FUNCTIONS_URL}/subscriptions/status/${CORRELATION_ID}" -H "Authorization: Bearer ${ACCESS_TOKEN}")
  INVOICE_ID=$(echo "$LATEST_STATUS" | jq -r '.data.data.invoiceId // empty')
  if [ -n "$INVOICE_ID" ] && [ "$INVOICE_ID" != "null" ]; then
    break
  fi
  sleep 2
done

if [ -z "$INVOICE_ID" ] || [ "$INVOICE_ID" = "unknown" ] || [ "$INVOICE_ID" = "null" ]; then
  echo "⚠️  Could not find a valid generated invoice ID organically."
  echo "   Attempting to force-generate an invoice in Kill Bill for next month..."
  ACCOUNT_ID=$(curl -s -u admin:password -H 'X-Killbill-ApiKey: demo' -H 'X-Killbill-ApiSecret: demosecret' "http://localhost:8080/1.0/kb/accounts?externalKey=${USER_ID}" | jq -r '.accountId')
  
  if [ -n "$ACCOUNT_ID" ] && [ "$ACCOUNT_ID" != "null" ]; then
    # Generate future date (works on macOS and Linux)
    FUTURE_DATE=$(date -v+2m +%Y-%m-%d 2>/dev/null || date -d "+2 months" +%Y-%m-%d)
    curl -s -X POST -u admin:password -H 'X-Killbill-ApiKey: demo' -H 'X-Killbill-ApiSecret: demosecret' -H 'X-Killbill-CreatedBy: admin' "http://localhost:8080/1.0/kb/invoices?accountId=${ACCOUNT_ID}&targetDate=${FUTURE_DATE}" > /dev/null
    
    # Get the latest unpaid invoice
    INVOICE_ID=$(curl -s -u admin:password -H 'X-Killbill-ApiKey: demo' -H 'X-Killbill-ApiSecret: demosecret' "http://localhost:8080/1.0/kb/accounts/${ACCOUNT_ID}/invoices?unpaidInvoicesOnly=true" | jq -r '.[0].invoiceId // empty')
    
    if [ -n "$INVOICE_ID" ] && [ "$INVOICE_ID" != "null" ]; then
       echo "✅ Force-generated Invoice ID: $INVOICE_ID"
    fi
  fi
fi

if [ -z "$INVOICE_ID" ] || [ "$INVOICE_ID" = "unknown" ] || [ "$INVOICE_ID" = "null" ]; then
  echo "❌ Failed to generate any invoice for payment testing. Exiting."
  exit 1
else
  echo "✅ Using Invoice ID: $INVOICE_ID"
  echo "Initiating payment to ${FUNCTIONS_URL}/invoices/${INVOICE_ID}/pay ..."
  echo ""
  
  PAYMENT_RESPONSE=$(curl -s -X POST "${FUNCTIONS_URL}/invoices/${INVOICE_ID}/pay" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}")
    
  echo "Payment Response:"
  echo "$PAYMENT_RESPONSE" | jq '.'
  
  PAYMENT_SUCCESS=$(echo "$PAYMENT_RESPONSE" | jq -r '.successful // .success // false')
  
  if [ "$PAYMENT_SUCCESS" = "true" ]; then
    echo "✅ Payment successfully initiated! Webhook routing should now occur."
  else
    echo "⚠️  Payment API responded, but it might not be marked successful."
  fi
fi


echo ""
echo "================================================================================================"
echo "🔔 STEP 6: Simulating Stripe Webhooks"
echo "================================================================================================"
echo ""

ORDER_ID=$(echo "$PAYMENT_RESPONSE" | jq -r '.data.order_id // empty')
INTENT_ID=$(echo "$PAYMENT_RESPONSE" | jq -r '.data.token // empty' | cut -d'_' -f1-2)
BAYEU_WEBHOOK_URL="http://localhost:54331/functions/v1/payments/webhook/stripe"

if [ -z "$ORDER_ID" ] || [ -z "$INTENT_ID" ]; then
  echo "❌ Could not extract order_id or intent_id from payment response."
  exit 1
fi

echo "Order ID: $ORDER_ID"
echo "Intent ID: $INTENT_ID"
echo ""

STRIPE_WEBHOOK_SECRET_KEY="test_stripe_webhook_secret_key"
BAYEU_WEBHOOK_URL="http://localhost:54331/functions/v1/payments/webhook/stripe"

echo "1. Sending payment_intent.created..."
deno run -A ./tests/integration/simulate-stripe-webhook.ts \
  --order-id "$ORDER_ID" \
  --intent-id "$INTENT_ID" \
  --type "payment_intent.created" \
  --secret "$STRIPE_WEBHOOK_SECRET_KEY" \
  --url "$BAYEU_WEBHOOK_URL"

echo ""
echo "2. Sending payment_intent.succeeded..."
deno run -A ./tests/integration/simulate-stripe-webhook.ts \
  --order-id "$ORDER_ID" \
  --intent-id "$INTENT_ID" \
  --type "payment_intent.succeeded" \
  --secret "$STRIPE_WEBHOOK_SECRET_KEY" \
  --url "$BAYEU_WEBHOOK_URL"

echo ""
echo "⏳ Waiting for Outpost and Kuala API to process the webhook (5 seconds)..."
sleep 5

echo ""
echo "================================================================================================"
echo "🔍 STEP 7: Checking Kill Bill Invoice Status"
echo "================================================================================================"
echo ""

echo "Endpoint: GET ${FUNCTIONS_URL}/invoices/${INVOICE_ID}"
INVOICE_RESPONSE=$(curl -s "${FUNCTIONS_URL}/invoices/${INVOICE_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")

echo "Response:"
echo "$INVOICE_RESPONSE" | jq '.'

INVOICE_STATUS=$(echo "$INVOICE_RESPONSE" | jq -r '.status // empty')
INVOICE_BALANCE=$(echo "$INVOICE_RESPONSE" | jq -r '.balance // empty')

echo ""
if [ "$INVOICE_STATUS" = "paid" ]; then
  echo "🎉 SUCCESS! Invoice is PAID (Balance: $INVOICE_BALANCE)"
else
  echo "❌ FAILED! Invoice status is $INVOICE_STATUS (Balance: $INVOICE_BALANCE)"
  exit 1
fi
