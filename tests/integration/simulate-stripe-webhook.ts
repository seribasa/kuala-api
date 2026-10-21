import { parse } from "https://deno.land/std@0.181.0/flags/mod.ts";

const flags = parse(Deno.args, {
  string: ["order-id", "intent-id", "type", "secret", "url"],
});

if (!flags["order-id"] || !flags["intent-id"] || !flags["type"] || !flags["secret"] || !flags["url"]) {
  console.error("Missing arguments");
  Deno.exit(1);
}

const payload = {
  id: "evt_test_" + Date.now(),
  type: flags.type,
  data: {
    object: {
      id: flags["intent-id"],
      currency: "usd",
      metadata: {
        order_id: flags["order-id"],
      },
    },
  },
};

const payloadString = JSON.stringify(payload);
const timestamp = Math.floor(Date.now() / 1000);
const secret = flags.secret;

// Stripe signature is HMAC SHA256 of "timestamp.payload"
const encoder = new TextEncoder();
const dataToSign = encoder.encode(`${timestamp}.${payloadString}`);

const key = await crypto.subtle.importKey(
  "raw",
  encoder.encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"]
);

const signatureBuffer = await crypto.subtle.sign("HMAC", key, dataToSign);
const signatureArray = Array.from(new Uint8Array(signatureBuffer));
const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');

const stripeSignatureHeader = `t=${timestamp},v1=${signatureHex}`;

console.log(`Sending ${flags.type} to ${flags.url}...`);

const response = await fetch(flags.url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "stripe-signature": stripeSignatureHeader,
  },
  body: payloadString,
});

if (!response.ok) {
  console.error(`Failed: ${response.status} ${response.statusText}`);
  const body = await response.text();
  console.error(body);
  Deno.exit(1);
}

console.log(`Success: ${await response.text()}`);
