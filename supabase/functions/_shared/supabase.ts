import { config } from "../_shared/config/env.ts";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = config.SUPABASE_URL as string;
const supabaseServiceKey = config.SUPABASE_SERVICE_ROLE_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseServiceKey);
