import { Hono } from "@hono/hono";

import { planRoutes as plans } from "./plans.ts";
import { authRoutes as auth } from "./auth.ts";
import { subscriptionRoutes as subscriptions } from "./subscriptions.ts";
import { invoiceRoutes as invoices } from "./invoices.ts";
import { webhookRoutes as webhooks } from "./webhooks.ts";

export const appRoutes = new Hono().basePath("/");

appRoutes.route("/", plans);
appRoutes.route("/", auth);
appRoutes.route("/", subscriptions);
appRoutes.route("/", invoices);
appRoutes.route("/", webhooks);
