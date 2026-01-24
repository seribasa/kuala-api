#!/bin/bash
# =============================================================================
# Event-Driven Subscription API - Regression Test Suite
# =============================================================================
# Tests the complete event-driven subscription flow including:
# 1. Authentication and token management
# 2. Subscription creation for new users
# 3. Duplicate subscription prevention
# 4. Event flow through microservices
# 5. Subscription verification
#
# Prerequisites:
# - Supabase running: supabase start
# - Functions server: supabase functions serve --env-file .env
# - Microservices: cd supabase/functions && deno task services:dev
# - RabbitMQ and Kill Bill running
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SUPABASE_URL="${SUPABASE_URL:-http://localhost:54321}"
FUNCTIONS_URL="${SUPABASE_URL}/functions/v1/kuala"
AUTH_URL="${SUPABASE_URL}/auth/v1"
ANON_KEY="${SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzU2NTA0ODAwLCJleHAiOjE5MTQyNzEyMDB9.zbstohWXIZRgD0aE4UVeh3xZRGq4fDOZ7cUzFBV26SU}"
TEST_PLAN_ID="${TEST_PLAN_ID:-basic-monthly}"
EVENT_WAIT_TIME="${EVENT_WAIT_TIME:-10}"

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Temp files
TEST_USER_FILE="/tmp/regression-test-user-$$.json"
trap "rm -f $TEST_USER_FILE" EXIT

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[PASS]${NC} $1"
}

log_error() {
  echo -e "${RED}[FAIL]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_section() {
  echo ""
  echo "============================================================================="
  echo -e "${BLUE}$1${NC}"
  echo "============================================================================="
}

assert_equals() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  
  if [ "$expected" = "$actual" ]; then
    log_success "$message"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    log_error "$message (expected: $expected, got: $actual)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

assert_not_empty() {
  local value="$1"
  local message="$2"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  
  if [ -n "$value" ] && [ "$value" != "null" ]; then
    log_success "$message"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    log_error "$message (value was empty or null)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  
  if echo "$haystack" | grep -q "$needle"; then
    log_success "$message"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    log_error "$message (expected to contain: $needle)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

create_test_user() {
  local timestamp=$(date +%s%N | cut -c1-13)
  local email="regression-test-${timestamp}@example.com"
  
  # Use stderr for logs so they don't get captured in variable
  echo -e "${BLUE}[INFO]${NC} Creating test user: $email" >&2
  
  local response=$(curl -s -X POST "${AUTH_URL}/signup" \
    -H "Content-Type: application/json" \
    -H "apikey: ${ANON_KEY}" \
    -d "{
      \"email\": \"${email}\",
      \"password\": \"test123456\",
      \"data\": {
        \"full_name\": \"Regression Test User\"
      }
    }")
  
  echo "$response" > "$TEST_USER_FILE"
  
  local access_token=$(echo "$response" | jq -r '.access_token // empty')
  if [ -n "$access_token" ] && [ "$access_token" != "null" ]; then
    echo -e "${BLUE}[INFO]${NC} Test user created successfully" >&2
    echo "$access_token"
  else
    echo -e "${RED}[FAIL]${NC} Failed to create test user" >&2
    echo "$response" | jq '.' >&2
    return 1
  fi
}

get_access_token() {
  if [ -f "$TEST_USER_FILE" ]; then
    local refresh_token=$(cat "$TEST_USER_FILE" | jq -r '.refresh_token // empty')
    
    if [ -n "$refresh_token" ]; then
      local response=$(curl -s -X POST "${AUTH_URL}/token?grant_type=refresh_token" \
        -H "Content-Type: application/json" \
        -H "apikey: ${ANON_KEY}" \
        -d "{\"refresh_token\": \"${refresh_token}\"}")
      
      local access_token=$(echo "$response" | jq -r '.access_token // empty')
      if [ -n "$access_token" ] && [ "$access_token" != "null" ]; then
        echo "$access_token"
        return 0
      fi
    fi
  fi
  
  # Create new user if refresh failed
  create_test_user
}

# =============================================================================
# Pre-flight Checks
# =============================================================================

check_prerequisites() {
  log_section "Pre-flight Checks"
  
  # Check Supabase Functions
  # Check Supabase Functions
  log_info "Checking Supabase Functions..."
  local plans_response=$(curl -s "${FUNCTIONS_URL}/plans" 2>&1)
  
  # Check if response is valid JSON (array or object)
  if echo "$plans_response" | jq -e '.' &>/dev/null; then
    log_success "Supabase Functions server is running"
  else
    log_error "Supabase Functions server not responding or returning invalid JSON"
    echo "Response: $plans_response"
    echo "Please run: supabase functions serve --env-file .env"
    exit 1
  fi
  
  # Check AUTH_BASE_URL
  log_info "Checking AUTH_BASE_URL configuration..."
  local auth_url=$(grep "^AUTH_BASE_URL=" .env 2>/dev/null | cut -d= -f2)
  if echo "$auth_url" | grep -q "host.docker.internal"; then
    log_success "AUTH_BASE_URL correctly configured for Docker"
  elif echo "$auth_url" | grep -q "localhost"; then
    log_warning "AUTH_BASE_URL uses localhost - may not work in Docker"
  else
    log_warning "AUTH_BASE_URL: $auth_url"
  fi
}

# =============================================================================
# Test Cases
# =============================================================================

test_create_subscription_new_user() {
  log_section "Test 1: Create Subscription for New User"
  
  local access_token=$(create_test_user)
  if [ -z "$access_token" ]; then
    log_error "Failed to create test user"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_TOTAL=$((TESTS_TOTAL + 1))
    return 1
  fi
  
  log_info "Creating event-driven subscription..."
  local response=$(curl -s -X POST "${FUNCTIONS_URL}/subscriptions/event-driven" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${access_token}" \
    -d "{\"planId\": \"${TEST_PLAN_ID}\"}")
  
  local successful=$(echo "$response" | jq -r '.successful // false')
  local correlation_id=$(echo "$response" | jq -r '.data.correlation_id // empty')
  local status=$(echo "$response" | jq -r '.data.status // empty')
  
  assert_equals "true" "$successful" "Subscription request accepted"
  assert_not_empty "$correlation_id" "Correlation ID returned"
  assert_equals "processing" "$status" "Status is 'processing'"
  
  if [ "$successful" = "true" ]; then
    log_info "Waiting ${EVENT_WAIT_TIME}s for event processing..."
    sleep "$EVENT_WAIT_TIME"
    
    # Verify subscription was created
    log_info "Verifying subscription..."
    local sub_response=$(curl -s "${FUNCTIONS_URL}/subscriptions" \
      -H "Authorization: Bearer ${access_token}")
    
    local sub_status=$(echo "$sub_response" | jq -r '.status // .data.activeSubscription.status // empty')
    local plan_id=$(echo "$sub_response" | jq -r '.planId // .data.activeSubscription.planName // empty')
    
    assert_equals "active" "$sub_status" "Subscription status is 'active'"
    assert_equals "$TEST_PLAN_ID" "$plan_id" "Subscription plan matches"
  fi
}

test_duplicate_subscription_prevention() {
  log_section "Test 2: Duplicate Subscription Prevention"
  
  local access_token=$(get_access_token)
  
  log_info "Attempting duplicate subscription..."
  local response=$(curl -s -X POST "${FUNCTIONS_URL}/subscriptions/event-driven" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${access_token}" \
    -d "{\"planId\": \"${TEST_PLAN_ID}\"}")
  
  local error_code=$(echo "$response" | jq -r '.code // empty')
  
  assert_equals "DUPLICATE_SUBSCRIPTION" "$error_code" "Duplicate subscription rejected"
}

test_missing_plan_id() {
  log_section "Test 3: Missing Plan ID Validation"
  
  local access_token=$(get_access_token)
  
  log_info "Sending request without planId..."
  local response=$(curl -s -X POST "${FUNCTIONS_URL}/subscriptions/event-driven" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${access_token}" \
    -d "{}")
  
  local error_code=$(echo "$response" | jq -r '.code // empty')
  
  assert_equals "MISSING_PLAN_ID" "$error_code" "Missing plan ID rejected"
}

test_invalid_json() {
  log_section "Test 4: Invalid JSON Validation"
  
  local access_token=$(get_access_token)
  
  log_info "Sending invalid JSON..."
  local response=$(curl -s -X POST "${FUNCTIONS_URL}/subscriptions/event-driven" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${access_token}" \
    -d "not valid json")
  
  local error_code=$(echo "$response" | jq -r '.code // empty')
  
  assert_equals "INVALID_EVENT_STRUCTURE" "$error_code" "Invalid JSON rejected"
}

test_missing_authorization() {
  log_section "Test 5: Missing Authorization Header"
  
  log_info "Sending request without auth header..."
  local response=$(curl -s -X POST "${FUNCTIONS_URL}/subscriptions/event-driven" \
    -H "Content-Type: application/json" \
    -d "{\"planId\": \"${TEST_PLAN_ID}\"}")
  
  local error_code=$(echo "$response" | jq -r '.code // empty')
  
  assert_equals "MISSING_AUTHORIZATION" "$error_code" "Missing auth rejected"
}

test_invalid_token() {
  log_section "Test 6: Invalid Token"
  
  log_info "Sending request with invalid token..."
  local response=$(curl -s -X POST "${FUNCTIONS_URL}/subscriptions/event-driven" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer invalid_token_here" \
    -d "{\"planId\": \"${TEST_PLAN_ID}\"}")
  
  local error_code=$(echo "$response" | jq -r '.code // empty')
  
  assert_equals "UNAUTHORIZED" "$error_code" "Invalid token rejected"
}

test_subscription_status_endpoint() {
  log_section "Test 7: Subscription Status Endpoint"
  
  local access_token=$(get_access_token)
  
  # First create a subscription
  log_info "Creating subscription to track..."
  local new_access_token=$(create_test_user)
  
  local create_response=$(curl -s -X POST "${FUNCTIONS_URL}/subscriptions/event-driven" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${new_access_token}" \
    -d "{\"planId\": \"${TEST_PLAN_ID}\"}")
  
  local correlation_id=$(echo "$create_response" | jq -r '.data.correlation_id // empty')
  
  if [ -n "$correlation_id" ] && [ "$correlation_id" != "null" ]; then
    log_info "Checking status for correlation ID: ${correlation_id:0:8}..."
    sleep 2
    
    local status_response=$(curl -s "${FUNCTIONS_URL}/subscriptions/status/${correlation_id}" \
      -H "Authorization: Bearer ${new_access_token}")
    
    local successful=$(echo "$status_response" | jq -r '.successful // false')
    local returned_correlation=$(echo "$status_response" | jq -r '.data.correlation_id // empty')
    
    assert_equals "true" "$successful" "Status endpoint returns successfully"
    assert_equals "$correlation_id" "$returned_correlation" "Correlation ID matches"
  else
    log_error "Could not create subscription to track"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_TOTAL=$((TESTS_TOTAL + 1))
  fi
}

test_get_available_plans() {
  log_section "Test 8: Get Available Plans"
  
  log_info "Fetching available plans..."
  local response=$(curl -s "${FUNCTIONS_URL}/plans")
  
  local plan_count=$(echo "$response" | jq 'length')
  local has_basic=$(echo "$response" | jq '[.[] | select(.id == "basic-monthly")] | length')
  
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
  if [ "$plan_count" -gt 0 ]; then
    log_success "Plans endpoint returns $plan_count plans"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    log_error "No plans returned"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
  
  assert_equals "1" "$has_basic" "basic-monthly plan exists"
}

# =============================================================================
# Main Execution
# =============================================================================

print_summary() {
  log_section "Test Summary"
  
  echo ""
  echo "Total Tests:  $TESTS_TOTAL"
  echo -e "Passed:       ${GREEN}$TESTS_PASSED${NC}"
  echo -e "Failed:       ${RED}$TESTS_FAILED${NC}"
  echo ""
  
  if [ "$TESTS_FAILED" -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
  else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
  fi
}

main() {
  echo ""
  echo "╔═══════════════════════════════════════════════════════════════════════════╗"
  echo "║      Event-Driven Subscription API - Regression Test Suite                ║"
  echo "╚═══════════════════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Configuration:"
  echo "  SUPABASE_URL: $SUPABASE_URL"
  echo "  TEST_PLAN_ID: $TEST_PLAN_ID"
  echo "  EVENT_WAIT_TIME: ${EVENT_WAIT_TIME}s"
  echo ""
  
  check_prerequisites
  
  # Run test cases in proper order:
  # 1. Tests that don't need auth
  test_get_available_plans
  test_missing_authorization
  test_invalid_token
  
  # 2. Create first user and subscription (needed for subsequent tests)
  test_create_subscription_new_user
  
  # 3. Tests that need a valid auth token (user already created)
  test_missing_plan_id
  test_invalid_json
  test_duplicate_subscription_prevention
  test_subscription_status_endpoint
  
  print_summary
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
