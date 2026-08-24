import { Hono } from "@hono/hono";
import { handlePlans } from "../handlers/plans/index.ts";
import { validateQuery } from "../validators/core.ts";
import { getPlansQuerySchema } from "../validators/schemas.ts";

export const planRoutes = new Hono().basePath("/plans");
planRoutes.get("/", validateQuery(getPlansQuerySchema), handlePlans);
