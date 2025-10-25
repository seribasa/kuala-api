import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import handler from "../../supabase/functions/kuala/index.ts";

const port = parseInt(Deno.env.get("PORT") || "54321");

console.log(`🚀 Kuala API server running on port ${port}`);

await serve(handler, { port });
