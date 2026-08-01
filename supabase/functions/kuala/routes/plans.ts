import { Hono } from "@hono/hono";
import { handlePlans } from "../handlers/plans/index.ts";

export const planRoutes = new Hono().basePath("/plans");
planRoutes.get("/", handlePlans);
