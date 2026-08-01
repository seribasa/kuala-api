import { Hono } from "@hono/hono";
import { handleAuthorize } from "../handlers/auth/authorize.ts";
import { handleExchangeToken } from "../handlers/auth/exchange-token.ts";
import { handleRefreshToken } from "../handlers/auth/refresh-token.ts";
import { handleLogout } from "../handlers/auth/logout.ts";
import { handleMe } from "../handlers/auth/me.ts";

export const authRoutes = new Hono().basePath("/auth");
authRoutes.get("/authorize", handleAuthorize);
authRoutes.post("/exchange-token", handleExchangeToken);
authRoutes.post("/refresh-token", handleRefreshToken);
authRoutes.post("/logout", handleLogout);
authRoutes.get("/me", handleMe);
