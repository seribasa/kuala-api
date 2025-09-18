import { Hono } from "jsr:@hono/hono";
import { logger } from "jsr:@hono/hono/logger";
import { handleAuthorize } from "./handlers/auth/authorize.ts";
import { handleExchangeToken } from "./handlers/auth/exchange-token.ts";
import { handleRefreshToken } from "./handlers/auth/refresh-token.ts";
import { handleLogout } from "./handlers/auth/logout.ts";
import { handleMe } from "./handlers/auth/me.ts";

const auth = new Hono().basePath(`/auth`);
auth.get("/authorize", handleAuthorize);
auth.post("/exchange-token", handleExchangeToken);
auth.post("/refresh-token", handleRefreshToken);
auth.post("/logout", handleLogout);
auth.get("/me", handleMe);

const app = new Hono();
app.use(logger());
app.route("/", auth);

// HANDLE 404
app.notFound((c) => {
  return c.json(
    {
      is_successful: false,
      message: "Not Found",
    },
    404,
  );
});

Deno.serve(app.fetch);
