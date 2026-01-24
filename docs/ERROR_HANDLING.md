# Error Handling Architecture

This document describes the comprehensive error handling system for the event-driven subscription flow.

## Table of Contents

1. [Overview](#overview)
2. [Error Classification](#error-classification)
3. [Retry Strategy](#retry-strategy)
4. [Dead Letter Queue (DLQ)](#dead-letter-queue-dlq)
5. [State Management](#state-management)
6. [Idempotency](#idempotency)
7. [Compensation Actions](#compensation-actions)
8. [Monitoring & Debugging](#monitoring--debugging)
9. [Error Codes Reference](#error-codes-reference)

---

## Overview

The subscription flow uses an event-driven architecture with the following components:

```BASH
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌────────────────┐     ┌─────────────────┐
│   API       │────▶│   RabbitMQ   │────▶│ Account Service │────▶│  Subscription  │────▶│ Invoice Service │
│   Handler   │     │              │     │                 │     │    Service     │     │                 │
└─────────────┘     └──────────────┘     └─────────────────┘     └────────────────┘     └─────────────────┘
       │                   │                      │                       │                      │
       │                   │                      │                       │                      │
       ▼                   ▼                      ▼                       ▼                      ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                      State Management System                                           │
│                                  (PostgreSQL via Supabase)                                            │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Error Handling Principles

1. **Fail Fast, Retry Smart**: Classify errors immediately and only retry transient failures
2. **State Tracking**: All state transitions are recorded for debugging and recovery
3. **Idempotency**: All handlers can safely process the same event multiple times
4. **Compensation**: Failed operations can be rolled back when needed
5. **Dead Letter Queue**: Permanently failed messages are preserved for analysis

---

## Error Classification

Errors are classified into three categories:

### Error Types

| Type        | Description                                  | Retry? | Example                                 |
| ----------- | -------------------------------------------- | ------ | --------------------------------------- |
| `TRANSIENT` | Temporary failures that may succeed on retry | ✅ Yes | Network timeout, service unavailable    |
| `PERMANENT` | Failures that will never succeed             | ❌ No  | Invalid input, duplicate subscription   |
| `PARTIAL`   | Failures requiring compensation              | ❌ No  | Subscription created but invoice failed |

### Error Codes

```typescript
const ErrorCodes = {
  // Validation errors (PERMANENT)
  MISSING_PLAN_ID: "MISSING_PLAN_ID",
  INVALID_USER_ID: "INVALID_USER_ID",
  INVALID_EVENT_STRUCTURE: "INVALID_EVENT_STRUCTURE",

  // Duplicate/conflict errors (PERMANENT)
  DUPLICATE_SUBSCRIPTION: "DUPLICATE_SUBSCRIPTION",
  PENDING_SUBSCRIPTION_REQUEST: "PENDING_SUBSCRIPTION_REQUEST",

  // External service errors (TRANSIENT)
  KILLBILL_CONNECTION_ERROR: "KILLBILL_CONNECTION_ERROR",
  KILLBILL_TIMEOUT: "KILLBILL_TIMEOUT",
  RABBITMQ_CONNECTION_ERROR: "RABBITMQ_CONNECTION_ERROR",
  RABBITMQ_PUBLISH_ERROR: "RABBITMQ_PUBLISH_ERROR",

  // State management errors
  STATE_TRANSITION_FAILED: "STATE_TRANSITION_FAILED",
  INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",

  // Processing errors
  HANDLER_TIMEOUT: "HANDLER_TIMEOUT",
  MAX_RETRIES_EXCEEDED: "MAX_RETRIES_EXCEEDED",
};
```

### Classification Logic

Errors are automatically classified based on patterns:

```typescript
// Connection/Network errors → TRANSIENT
/connection.*refused|ECONNREFUSED|network.*error/i

// Timeout errors → TRANSIENT
/timeout|ETIMEDOUT|timed out/i

// Service unavailable → TRANSIENT
/503|service.*unavailable|temporarily.*unavailable/i

// Rate limiting → TRANSIENT
/429|rate.*limit|too many requests/i

// Validation errors → PERMANENT
/validation.*failed|invalid.*input|400.*bad.*request/i

// Not found → PERMANENT
/not.*found|404|does not exist/i

// Duplicate errors → PERMANENT
/duplicate|already exists|conflict|409/i
```

---

## Retry Strategy

### Exponential Backoff

Transient errors are retried with exponential backoff:

```typescript
const retryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  useJitter: true,
};

// Delay calculation:
// Attempt 0: 1000ms
// Attempt 1: 2000ms
// Attempt 2: 4000ms
// Attempt 3: 8000ms (capped at maxDelayMs)
```

### Usage Example

```typescript
import { withRetry } from "../_shared/errors/index.ts";

// Wrap any async operation with retry
const result = await withRetry(() => killBillService.createAccount(userId), {
  maxRetries: 3,
  baseDelayMs: 1000,
  onRetry: (error, attempt, delay) => {
    logger.warn(`Retrying operation (attempt ${attempt})`, { delay, error });
  },
});
```

### Message-Level Retries

RabbitMQ messages are retried at the consumer level:

1. Handler processes message
2. If transient error, message is republished with incremented `x-retry-count` header
3. After max retries, message is NACKed and routed to DLQ

---

## Dead Letter Queue (DLQ)

### Architecture

```BASH
┌─────────────────────┐
│ subscription-events │ (main exchange)
│      (topic)        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐     Failed messages
│  subscription-      │────────────────────▶ ┌─────────────────────┐
│  requested          │                      │ subscription-events-│
│  (queue)            │                      │ dlx (dead letter    │
└─────────────────────┘                      │ exchange)           │
                                             └──────────┬──────────┘
                                                        │
                                                        ▼
                                             ┌─────────────────────┐
                                             │ subscription-dead-  │
                                             │ letter (queue)      │
                                             └─────────────────────┘
```

### DLQ Message Headers

Messages in the DLQ include these headers for debugging:

| Header                | Description                                |
| --------------------- | ------------------------------------------ |
| `x-retry-count`       | Number of retry attempts                   |
| `x-original-event-id` | Original event ID                          |
| `x-last-error`        | Last error message                         |
| `x-error-type`        | Error classification (TRANSIENT/PERMANENT) |
| `x-error-code`        | Specific error code                        |
| `x-death`             | RabbitMQ death information                 |

### Processing DLQ Messages

DLQ messages can be:

1. **Analyzed**: Investigate root cause using error headers
2. **Requeued**: Move back to original queue after fixing issue
3. **Archived**: Store for audit purposes
4. **Discarded**: Remove after investigation

---

## State Management

### State Machine

The subscription request follows this state machine:

```BASH
                                    ┌─────────────┐
                                    │  cancelled  │
                                    └─────────────┘
                                          ▲
                                          │ (user cancellation)
                                          │
┌───────────┐     ┌──────────────┐     ┌──────────────────────┐
│ requested │────▶│ account_ready│────▶│ creating_subscription│
└───────────┘     └──────────────┘     └──────────────────────┘
     │                   │                        │
     │                   │                        │
     ▼                   ▼                        ▼
┌─────────┐        ┌─────────┐              ┌─────────┐
│ failed  │◀───────│ failed  │◀─────────────│ failed  │
└─────────┘        └─────────┘              └─────────┘
     │
     │ (retry)
     ▼
┌───────────┐
│ requested │
└───────────┘

     ┌──────────────────────┐     ┌───────────────────┐     ┌───────────┐
     │ subscription_created │────▶│ generating_invoice│────▶│ completed │
     └──────────────────────┘     └───────────────────┘     └───────────┘
                │                          │
                │                          │
                ▼                          ▼
          ┌─────────┐                ┌─────────┐
          │ failed  │                │ failed  │
          └─────────┘                └─────────┘
```

### Valid Transitions

```typescript
const VALID_STATE_TRANSITIONS = {
  "": ["requested"],
  requested: ["account_ready", "failed", "cancelled"],
  account_ready: ["creating_subscription", "failed", "cancelled"],
  creating_subscription: ["subscription_created", "failed", "cancelled"],
  subscription_created: ["generating_invoice", "failed", "cancelled"],
  generating_invoice: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["requested"], // Allow retry
  cancelled: [],
};
```

### Querying State

```typescript
// Get current state
const state = await subscriptionStateManager.getCurrentState(correlationId);

// Get state history
const history = await subscriptionStateManager.getHistory(correlationId);

// Check for pending requests
const hasPending = await subscriptionStateManager.hasPendingSubscriptionRequest(
  userId
);
```

---

## Idempotency

### Handler Idempotency Pattern

Each service handler checks the current state before processing:

```typescript
async handleAccountReady(event: AccountReadyEvent) {
  // IDEMPOTENCY CHECK
  const currentState = await subscriptionStateManager.getCurrentState(
    event.correlationId
  );

  if (currentState) {
    const state = currentState.current_state;

    // Already past this stage - skip
    if (["subscription_created", "generating_invoice", "completed"]
        .includes(state)) {
      logger.info(`Skipping already processed event, state: ${state}`);
      return;
    }

    // In progress - check external state for recovery
    if (state === "creating_subscription") {
      const existing = await killBillService.getSubscription(userId);
      if (existing) {
        // Recover by transitioning state
        await subscriptionStateManager.transitionToSubscriptionCreated(...);
        return;
      }
    }

    // Failed state - allow retry
    if (state === "failed") {
      logger.info("Retrying failed operation");
    }
  }

  // Proceed with normal processing...
}
```

### Event Deduplication

Events include unique identifiers for deduplication:

```typescript
interface DomainEvent {
  eventId: string; // Unique event ID (UUID)
  correlationId: string; // Tracks entire flow
  timestamp: string; // ISO8601 timestamp
}
```

---

## Compensation Actions

When a subscription flow fails after partial completion, compensation actions can roll back changes:

### Available Compensations

| State                  | Compensation Action                  |
| ---------------------- | ------------------------------------ |
| `account_ready`        | None needed - accounts can be reused |
| `subscription_created` | Cancel subscription in KillBill      |
| `generating_invoice`   | Void invoice + cancel subscription   |

### Usage

```typescript
import {
  executeCompensation,
  buildCompensationContext,
} from "../_shared/errors/index.ts";

// Build context from failed state
const context = buildCompensationContext(
  correlationId,
  "subscription_created",
  "Invoice generation failed",
  { subscriptionId, accountId, userId }
);

// Execute compensation
const result = await executeCompensation(context, {
  markAsCancelled: true,
  reason: "Automated compensation after invoice failure",
});

if (result.success) {
  logger.info("Compensation completed successfully");
} else {
  logger.error("Compensation failed", { error: result.error });
}
```

---

## Monitoring & Debugging

### Key Metrics to Monitor

1. **Event Processing Rate**: Events processed per minute
2. **Error Rate**: Percentage of failed events
3. **DLQ Size**: Number of messages in dead letter queue
4. **Retry Rate**: Percentage of events requiring retry
5. **State Duration**: Time spent in each state

### Debugging Failed Requests

1. **Get correlation ID** from error response or logs
2. **Query state history**:

   ```sql
   SELECT * FROM get_entity_state_history(
     'subscription_request',
     'correlation-id-here',
     100
   );
   ```

3. **Check DLQ** for failed messages with same correlation ID
4. **Review error details** in state transitions:

   ```sql
   SELECT error_details, metadata
   FROM state_transitions
   WHERE entity_id = 'correlation-id-here'
   AND to_state = 'failed';
   ```

### Log Correlation

All logs include `correlationId` for tracing:

```typescript
logger.info(handlerName, "Processing event", {
  correlationId: event.correlationId,
  userId: event.userId,
});
```

Search logs with: `correlationId=<uuid>`

---

## Error Codes Reference

### API Error Responses

| HTTP Status | Error Code                     | Description                           |
| ----------- | ------------------------------ | ------------------------------------- |
| 400         | `MISSING_PLAN_ID`              | planId not provided in request        |
| 400         | `INVALID_EVENT_STRUCTURE`      | Invalid JSON or request structure     |
| 409         | `DUPLICATE_SUBSCRIPTION`       | User already has active subscription  |
| 409         | `PENDING_SUBSCRIPTION_REQUEST` | User has pending subscription request |
| 500         | `STATE_TRANSITION_FAILED`      | Failed to record state transition     |
| 500         | `INTERNAL_ERROR`               | Unclassified internal error           |
| 503         | `KILLBILL_CONNECTION_ERROR`    | Cannot connect to KillBill            |
| 503         | `RABBITMQ_PUBLISH_ERROR`       | Failed to publish to RabbitMQ         |

### Response Format

```json
{
  "code": "PENDING_SUBSCRIPTION_REQUEST",
  "message": "You have a pending subscription request in state: account_ready",
  "correlation_id": "550e8400-e29b-41d4-a716-446655440000",
  "details": "Optional additional error details"
}
```

---

## Files Reference

| File                                   | Purpose                           |
| -------------------------------------- | --------------------------------- |
| `_shared/errors/error-types.ts`        | Error classification and types    |
| `_shared/errors/retry-utils.ts`        | Retry with exponential backoff    |
| `_shared/errors/compensation.ts`       | Rollback/compensation actions     |
| `_shared/errors/index.ts`              | Centralized exports               |
| `_shared/rabbitmq.ts`                  | RabbitMQ with DLQ support         |
| `_shared/services/state-management.ts` | State transitions with validation |

---

## Best Practices

1. **Always classify errors** before deciding how to handle them
2. **Use correlation IDs** in all logs and state transitions
3. **Check state before processing** to ensure idempotency
4. **Wrap external calls with retry** for transient failures
5. **Record error details** in state transitions for debugging
6. **Monitor DLQ size** and investigate root causes
7. **Test failure scenarios** with chaos engineering approaches
