import { Hono } from "@hono/hono";
import { handleBayeuWebhook } from "../handlers/webhooks/bayeu.ts";

export const webhookRoutes = new Hono().basePath("/webhooks");
webhookRoutes.post("/bayeu", handleBayeuWebhook);
