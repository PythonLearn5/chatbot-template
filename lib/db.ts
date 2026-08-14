// ============================================================================
// Supabase 客户端单例 — 服务端使用 service_role key 绕过 RLS
// ============================================================================

import "server-only"
import { createClient } from "@supabase/supabase-js"

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)
