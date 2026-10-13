# Event-Driven Subscription & Payment Flow

This document details the end-to-end sequence diagram of the subscription and payment process, starting from the Frontend (FE) to the creation of the subscription, payment processing via Stripe, webhook handling through Hookdeck Outpost, and back to the FE.

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    
    actor FE as Frontend (User)
    participant Kuala as Kuala API (Backend)
    participant KB as Kill Bill (Billing)
    participant Bayeu as Bayeu (Payment Proxy)
    participant Stripe as Stripe (Payment Gateway)
    participant Outpost as Hookdeck Outpost
    
    %% Phase 1: Subscription Request
    rect rgb(240, 248, 255)
        note right of FE: 1. Subscription Creation Phase
        FE->>Kuala: POST /subscriptions/event-driven (Plan ID)
        Kuala-->>FE: Returns Correlation ID (Status: processing)
        
        Kuala->>KB: Create Account & Subscription (Async Events)
        
        alt Creation Success
            KB-->>Kuala: SubscriptionCreated & InvoiceGenerated Events
        else Creation Failure (e.g., Validation Error)
            KB-->>Kuala: Error Event
        end
        
        loop Polling Status
            FE->>Kuala: GET /subscriptions/status/:correlationId
            alt Processing
                Kuala-->>FE: Status: processing
            else Success
                Kuala-->>FE: Status: completed (Returns Subscription ID & Invoice ID)
            else Failure
                Kuala-->>FE: Status: failed (Returns Error Details)
            end
        end
    end

    %% Phase 2: Payment Initiation
    rect rgb(255, 245, 238)
        note right of FE: 2. Payment Initiation Phase
        FE->>Kuala: POST /invoices/:invoiceId/pay
        
        Kuala->>KB: GET Invoice Details (Account ID, Balance)
        KB-->>Kuala: Returns Invoice Balance (e.g. 49.99)
        
        Kuala->>Bayeu: POST /initiate-payment (Amount, Invoice ID)
        Bayeu->>Stripe: Create Payment Intent
        Stripe-->>Bayeu: Client Secret / Token
        Bayeu-->>Kuala: Token & Order ID
        Kuala-->>FE: Returns Payment Token (pi_xxx_secret_xxx)
    end

    %% Phase 3: Client-side Payment
    rect rgb(240, 255, 240)
        note right of FE: 3. User Checkout
        FE->>Stripe: Confirm Payment (using Stripe.js & Token)
        
        alt Payment Success
            Stripe-->>FE: Payment Result (Success)
        else Payment Fails (e.g., Insufficient Funds, Declined)
            Stripe-->>FE: Payment Result (Error)
            FE->>FE: Display Error UI to User
        end
    end

    %% Phase 4: Webhook Processing
    rect rgb(255, 250, 240)
        note right of FE: 4. Webhook & Fulfillment Phase
        Stripe->>Bayeu: Webhook (payment_intent.succeeded / failed)
        
        alt Valid Webhook Signature
            Bayeu->>Outpost: Publish Event (tenant_id, payment.success/failed, data)
            Outpost-->>Bayeu: 200 OK
            Bayeu-->>Stripe: 200 OK
            
            Outpost->>Kuala: Forward Webhook (data wrapper) -> /webhooks/bayeu
            
            alt Payment Success Webhook
                Kuala->>KB: payInvoiceExternal(Invoice ID, Amount)
                KB-->>Kuala: Updates Invoice Status to PAID (Balance: 0)
                Kuala-->>Outpost: 200 OK
            else Payment Failed Webhook
                Kuala->>KB: Optionally log failure or keep invoice OPEN
                Kuala-->>Outpost: 200 OK (Acknowledged)
            end
        else Invalid Webhook Signature
            Bayeu-->>Stripe: 400 Bad Request
        end
    end
    
    %% Phase 5: Verification
    rect rgb(245, 245, 255)
        note right of FE: 5. Completion
        FE->>Kuala: GET /invoices/:invoiceId (or via WebSocket)
        
        alt Invoice Paid
            Kuala-->>FE: Invoice Status: PAID
            FE->>FE: Display Success UI to User
        else Invoice Unpaid / Open
            Kuala-->>FE: Invoice Status: OPEN
            FE->>FE: Display "Payment Pending or Failed" UI to User
        end
    end
```

## Flow Description

1. **Subscription Creation Phase**: The Frontend (FE) initiates an event-driven subscription request. The Kuala API acknowledges the request with a correlation ID and processes the Kill Bill subscription asynchronously. The FE polls the status until the subscription and initial invoice are fully generated.
   - *Negative Flow*: If Kill Bill fails to create the account or subscription (e.g., validation error), the error event is recorded. The FE polling will receive a `failed` status, and the user can be notified.
2. **Payment Initiation Phase**: The FE requests to pay the generated invoice. Kuala API fetches the invoice balance from Kill Bill and requests a payment initiation from the Bayeu payment proxy. Bayeu communicates with Stripe to create a Payment Intent and returns the client secret to the FE.
3. **User Checkout**: The FE securely captures the user's payment details (e.g., using Stripe Elements) and confirms the payment directly with Stripe.
   - *Negative Flow*: If the card is declined or has insufficient funds, Stripe returns an error directly to the FE. The FE displays an error message to the user, allowing them to retry with a different payment method.
4. **Webhook & Fulfillment Phase**: Upon payment resolution, Stripe fires a webhook to Bayeu. Bayeu standardizes the event and publishes it to Hookdeck Outpost. Outpost reliably routes the event back to Kuala API's webhook endpoint. Kuala API then marks the invoice as externally paid in Kill Bill, reducing its balance to zero.
   - *Negative Flow*: If the webhook signature is invalid or tampered with, Bayeu rejects it with a `400 Bad Request`. If a valid payment *failure* webhook is received, Kuala API acknowledges it but leaves the invoice in an `OPEN` state.
5. **Completion**: The FE either polls or is notified about the invoice status.
   - *Negative Flow*: If the invoice is still `OPEN` (due to payment failure or a delayed webhook), the FE displays a "Payment Pending or Failed" UI instead of the final success screen, prompting the user to check their payment status.
