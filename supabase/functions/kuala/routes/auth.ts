import { Hono } from "@hono/hono";
import { handleAuthorize } from "../handlers/auth/authorize.ts";
import { handleExchangeToken } from "../handlers/auth/exchange-token.ts";
import { handleRefreshToken } from "../handlers/auth/refresh-token.ts";
import { handleLogout } from "../handlers/auth/logout.ts";
import { handleMe } from "../handlers/auth/me.ts";
import { validateJson, validateQuery } from "../validators/core.ts";
import {
	authorizeQuerySchema,
	exchangeTokenSchema,
	refreshTokenSchema,
} from "../validators/schemas.ts";

export const authRoutes = new Hono().basePath("/auth");
authRoutes.get(
	"/authorize",
	validateQuery(authorizeQuerySchema),
	handleAuthorize,
);
authRoutes.post(
	"/exchange-token",
	validateJson(exchangeTokenSchema),
	handleExchangeToken,
);
authRoutes.post(
	"/refresh-token",
	validateJson(refreshTokenSchema),
	handleRefreshToken,
);
authRoutes.post("/logout", handleLogout);
authRoutes.get("/me", handleMe);
