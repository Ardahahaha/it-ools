import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: admin role required");
}

export const isAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    return { admin: !!data };
  });

export const runDiscoveryNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { runDiscovery, rotateDailyTool } = await import("@/lib/discovery.server");
    const result = await runDiscovery();
    const daily = await rotateDailyTool();
    return { ...result, dailyToolId: daily.chosen };
  });

export const listDiscovered = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        status: z.enum(["pending", "approved", "rejected", "all"]).default("pending"),
        category: z.string().optional(),
        language: z.string().optional(),
        minScore: z.number().min(0).max(100).optional(),
        search: z.string().max(120).optional(),
        limit: z.number().min(1).max(200).default(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("discovered_tools")
      .select("*")
      .order("score", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.category) q = q.eq("suggested_category", data.category);
    if (data.language) q = q.eq("language", data.language);
    if (typeof data.minScore === "number") q = q.gte("score", data.minScore);
    if (data.search) q = q.ilike("name", `%${data.search}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

export const discoveryStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [{ count: total }, { count: pending }, { count: approved }, { count: rejected }, todayRows, runs, avgRow, approvedBreakdown] =
      await Promise.all([
        supabaseAdmin.from("discovered_tools").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("discovered_tools").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabaseAdmin.from("discovered_tools").select("id", { count: "exact", head: true }).eq("status", "approved"),
        supabaseAdmin.from("discovered_tools").select("id", { count: "exact", head: true }).eq("status", "rejected"),
        supabaseAdmin
          .from("discovered_tools")
          .select("id", { count: "exact", head: true })
          .gte("detected_at", today.toISOString()),
        supabaseAdmin.from("discovery_runs").select("*").order("run_at", { ascending: false }).limit(10),
        supabaseAdmin.from("discovered_tools").select("score").eq("status", "pending"),
        supabaseAdmin
          .from("discovered_tools")
          .select("suggested_category, level")
          .eq("status", "approved"),
      ]);
    const scores = (avgRow.data ?? []).map((r) => r.score);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

    const byCategory: Record<string, number> = {};
    const byLevel: Record<string, number> = { "Débutant": 0, "Intermédiaire": 0, "Avancé": 0, "Non défini": 0 };
    for (const r of approvedBreakdown.data ?? []) {
      const cat = (r as any).suggested_category || "Non catégorisé";
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      const lvl = (r as any).level || "Non défini";
      byLevel[lvl] = (byLevel[lvl] ?? 0) + 1;
    }
    const categories = Object.entries(byCategory)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    const levels = Object.entries(byLevel)
      .map(([name, count]) => ({ name, count }))
      .filter((l) => l.count > 0);

    return {
      total: total ?? 0,
      pending: pending ?? 0,
      approved: approved ?? 0,
      rejected: rejected ?? 0,
      detectedToday: todayRows.count ?? 0,
      avgPendingScore: avgScore,
      recentRuns: runs.data ?? [],
      categories,
      levels,
    };
  });

export const reviewTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(["approve", "reject"]),
        reason: z.string().max(500).optional(),
        patch: z
          .object({
            suggested_category: z.string().max(60).optional(),
            level: z.enum(["Débutant", "Intermédiaire", "Avancé"]).optional(),
            description: z.string().max(1000).optional(),
            install_cmd: z.string().max(300).optional(),
            example_cmd: z.string().max(300).optional(),
            ethical: z.boolean().optional(),
          })
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch = {
      status: data.action === "approve" ? "approved" : "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: context.userId,
      ...(data.action === "reject" && data.reason ? { reject_reason: data.reason } : {}),
      ...(data.patch ?? {}),
    } as never;
    const { error } = await supabaseAdmin.from("discovered_tools").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const bulkApproveSafe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ minScore: z.number().min(50).max(100).default(80) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error, count } = await supabaseAdmin
      .from("discovered_tools")
      .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: context.userId }, { count: "exact" })
      .eq("status", "pending")
      .eq("ethical", false)
      .gte("score", data.minScore);
    if (error) throw new Error(error.message);
    return { approved: count ?? 0 };
  });

export const setDailyTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ toolId: z.string().uuid(), reason: z.string().max(300).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabaseAdmin
      .from("daily_tool")
      .upsert(
        { tool_id: data.toolId, featured_date: today, reason: data.reason ?? null },
        { onConflict: "tool_id,featured_date" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const autoPickDailyTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { rotateDailyTool } = await import("@/lib/discovery.server");
    return rotateDailyTool();
  });

// Public reads (no auth) ---------------------------------------------------

export const getDailyTool = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const today = new Date().toISOString().slice(0, 10);
  const { data: dt } = await supabaseAdmin
    .from("daily_tool")
    .select("featured_date, reason, tool:discovered_tools(*)")
    .eq("featured_date", today)
    .maybeSingle();
  if (dt?.tool) return { daily: dt };
  // Fallback to latest if today not set
  const { data: latest } = await supabaseAdmin
    .from("daily_tool")
    .select("featured_date, reason, tool:discovered_tools(*)")
    .order("featured_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { daily: latest ?? null };
});

export const getApprovedTools = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        limit: z.number().min(1).max(100).default(24),
        category: z.string().optional(),
        search: z.string().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("discovered_tools")
      .select("*")
      .eq("status", "approved")
      .order("detected_at", { ascending: false })
      .limit(data.limit);
    if (data.category) q = q.eq("suggested_category", data.category);
    if (data.search) q = q.ilike("name", `%${data.search}%`);
    const { data: rows } = await q;
    return { rows: rows ?? [] };
  });

export const getDailyTools = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from("daily_tool")
    .select("featured_date, reason, tool:discovered_tools(*)")
    .eq("featured_date", today)
    .order("created_at", { ascending: false });
  if (data && data.length) return { rows: data };
  // Fallback : dernière journée disponible
  const { data: latestDate } = await supabaseAdmin
    .from("daily_tool")
    .select("featured_date")
    .order("featured_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latestDate) return { rows: [] };
  const { data: fallback } = await supabaseAdmin
    .from("daily_tool")
    .select("featured_date, reason, tool:discovered_tools(*)")
    .eq("featured_date", latestDate.featured_date)
    .order("created_at", { ascending: false });
  return { rows: fallback ?? [] };
});

export const getWeeklyTools = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const { data } = await supabaseAdmin
    .from("discovered_tools")
    .select("*")
    .eq("status", "approved")
    .gte("detected_at", since.toISOString())
    .order("score", { ascending: false })
    .limit(12);
  return { rows: data ?? [] };
});

export const getDiscoveredTool = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tool, error } = await supabaseAdmin
      .from("discovered_tools")
      .select("*")
      .eq("id", data.id)
      .eq("status", "approved")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { tool };
  });
