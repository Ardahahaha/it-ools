import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/Navbar";
import {
  isAdmin,
  discoveryStats,
  listDiscovered,
  runDiscoveryNow,
  reviewTool,
  bulkApproveSafe,
  setDailyTool,
  autoPickDailyTool,
} from "@/lib/discovery.functions";
import { Play, ShieldCheck, Sparkles, Check, X, Star, ExternalLink, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/discovery")({
  head: () => ({ meta: [{ title: "Discovery — IT-ools admin" }] }),
  component: AdminDiscovery,
});

function AdminDiscovery() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const checkAdmin = useServerFn(isAdmin);
  const getStats = useServerFn(discoveryStats);
  const getList = useServerFn(listDiscovered);
  const runNow = useServerFn(runDiscoveryNow);
  const review = useServerFn(reviewTool);
  const bulk = useServerFn(bulkApproveSafe);
  const setDaily = useServerFn(setDailyTool);
  const pickDaily = useServerFn(autoPickDailyTool);

  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [search, setSearch] = useState("");

  const admin = useQuery({ queryKey: ["admin-check"], queryFn: () => checkAdmin() });

  useEffect(() => {
    if (admin.data && !admin.data.admin) {
      // Show inline message instead of redirect
    }
  }, [admin.data]);

  const stats = useQuery({
    queryKey: ["discovery-stats"],
    queryFn: () => getStats(),
    enabled: !!admin.data?.admin,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
  const list = useQuery({
    queryKey: ["discovery-list", status, search],
    queryFn: () => getList({ data: { status, search: search || undefined, limit: 100 } }),
    enabled: !!admin.data?.admin,
    refetchInterval: 30000,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["discovery-stats"] });
    qc.invalidateQueries({ queryKey: ["discovery-list"] });
  };

  const runMut = useMutation({
    mutationFn: () => runNow(),
    onSuccess: invalidateAll,
  });
  const reviewMut = useMutation({
    mutationFn: (vars: { id: string; action: "approve" | "reject" }) =>
      review({ data: vars }),
    onSuccess: invalidateAll,
  });
  const bulkMut = useMutation({
    mutationFn: () => bulk({ data: { minScore: 80 } }),
    onSuccess: invalidateAll,
  });
  const dailyMut = useMutation({
    mutationFn: (toolId: string) => setDaily({ data: { toolId } }),
    onSuccess: invalidateAll,
  });
  const pickMut = useMutation({ mutationFn: () => pickDaily(), onSuccess: invalidateAll });

  const logout = async () => {
    await supabase.auth.signOut();
    nav({ to: "/auth" });
  };

  if (admin.isLoading) return <Shell>Chargement…</Shell>;
  if (!admin.data?.admin)
    return (
      <Shell>
        <div className="mx-auto max-w-lg rounded-xl border border-border bg-gradient-card p-6">
          <h1 className="font-display text-xl font-bold">Accès refusé</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ton compte est connecté mais n'a pas le rôle <code>admin</code>. Demande à un admin d'ajouter ton user_id dans la table <code>user_roles</code>.
          </p>
          <button onClick={logout} className="mt-4 rounded-md border border-border px-3 py-1.5 text-xs">
            Se déconnecter
          </button>
        </div>
      </Shell>
    );

  const s = stats.data;
  return (
    <Shell>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-cyber-cyan">discovery · admin</div>
          <h1 className="mt-1 font-display text-3xl font-bold">Veille automatique</h1>
        </div>
        <button onClick={logout} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          Déconnexion
        </button>
      </div>

      {/* KPIs */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label="Détectés aujourd'hui" value={s?.detectedToday ?? "—"} />
        <Kpi label="En attente" value={s?.pending ?? "—"} accent="text-cyber-cyan" />
        <Kpi label="Approuvés" value={s?.approved ?? "—"} accent="text-cyber-emerald" />
        <Kpi label="Rejetés" value={s?.rejected ?? "—"} accent="text-destructive" />
        <Kpi label="Score moyen" value={s?.avgPendingScore ?? "—"} />
        <Kpi label="Total" value={s?.total ?? "—"} />
      </div>

      {/* Répartition outils approuvés (en ligne) */}
      {(s?.categories?.length || s?.levels?.length) ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-gradient-card p-4">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-widest text-cyber-cyan">
                outils en ligne · par catégorie
              </p>
              <span className="font-mono text-[10px] text-muted-foreground">
                {s?.approved ?? 0} approuvés
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {(s?.categories ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">Aucun outil approuvé.</p>
              )}
              {(s?.categories ?? []).map((c: { name: string; count: number }) => {
                const max = Math.max(...(s?.categories ?? []).map((x: any) => x.count), 1);
                const pct = Math.round((c.count / max) * 100);
                return (
                  <div key={c.name}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-foreground/80 truncate">{c.name}</span>
                      <span className="font-mono text-cyber-emerald">{c.count}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-secondary/40">
                      <div className="h-full bg-primary/70" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-gradient-card p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
              outils en ligne · par niveau
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(s?.levels ?? []).map((l: { name: string; count: number }) => (
                <div key={l.name} className="rounded-lg border border-border bg-background/40 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {l.name}
                  </p>
                  <p className="mt-1 font-display text-2xl font-bold">{l.count}</p>
                </div>
              ))}
              {(s?.levels ?? []).length === 0 && (
                <p className="col-span-full text-xs text-muted-foreground">
                  Aucun niveau renseigné sur les outils approuvés.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => runMut.mutate()}
          disabled={runMut.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-glow-blue hover:bg-primary/90 disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" /> {runMut.isPending ? "Analyse en cours…" : "Lancer une analyse"}
        </button>
        <button
          onClick={() => bulkMut.mutate()}
          disabled={bulkMut.isPending}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs hover:border-primary/40"
        >
          <ShieldCheck className="h-3.5 w-3.5" /> Valider tous (score ≥ 80, non sensibles)
        </button>
        <button
          onClick={() => pickMut.mutate()}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs hover:border-primary/40"
        >
          <Sparkles className="h-3.5 w-3.5" /> Choisir Tool du jour (auto)
        </button>
        <button
          onClick={() => qc.invalidateQueries()}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs hover:border-primary/40"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Rafraîchir
        </button>
        {runMut.data && (
          <span className="text-xs text-muted-foreground self-center">
            Fetched {runMut.data.totalFetched}, ajoutés {runMut.data.totalKept}
            {runMut.data.errors.length ? `, erreurs ${runMut.data.errors.length}` : ""}
          </span>
        )}
        {bulkMut.data && (
          <span className="text-xs text-cyber-emerald self-center">{bulkMut.data.approved} approuvés</span>
        )}
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map((st) => (
          <button
            key={st}
            onClick={() => setStatus(st)}
            className={`rounded-md border px-3 py-1.5 text-xs font-mono uppercase tracking-wider ${
              status === st ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {st}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Recherche par nom…"
          className="ml-auto h-9 w-64 rounded-md border border-border bg-background/70 px-3 text-xs"
        />
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-background/50">
        <table className="w-full text-xs">
          <thead className="bg-secondary/40 text-left font-mono uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Outil</th>
              <th className="px-3 py-2">Catégorie</th>
              <th className="px-3 py-2">Lang</th>
              <th className="px-3 py-2">Stars</th>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Chargement…</td></tr>
            )}
            {list.data?.rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Aucun outil.</td></tr>
            )}
            {list.data?.rows.map((t: any) => (
              <tr key={t.id} className="border-t border-border hover:bg-secondary/20">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Link
                      to="/outils/discovered/$id"
                      params={{ id: t.id }}
                      className="font-semibold hover:text-primary"
                    >
                      {t.name}
                    </Link>
                    <a href={t.github_url} target="_blank" rel="noreferrer" title="Voir sur GitHub">
                      <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-primary" />
                    </a>
                    {t.ethical && (
                      <span className="rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[9px] font-mono uppercase text-destructive">
                        sensible
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-muted-foreground">{t.description}</p>
                </td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{t.suggested_category}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{t.language ?? "—"}</td>
                <td className="px-3 py-2 font-mono">{t.stars}</td>
                <td className="px-3 py-2 font-mono">
                  <span className={t.score >= 80 ? "text-cyber-emerald" : t.score >= 60 ? "text-cyber-cyan" : "text-muted-foreground"}>
                    {t.score}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {t.status !== "approved" && (
                      <button
                        onClick={() => reviewMut.mutate({ id: t.id, action: "approve" })}
                        className="inline-flex items-center gap-1 rounded border border-cyber-emerald/40 bg-cyber-emerald/10 px-2 py-1 text-[10px] text-cyber-emerald hover:bg-cyber-emerald/20"
                      >
                        <Check className="h-3 w-3" /> approuver
                      </button>
                    )}
                    {t.status !== "rejected" && (
                      <button
                        onClick={() => reviewMut.mutate({ id: t.id, action: "reject" })}
                        className="inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] text-destructive hover:bg-destructive/20"
                      >
                        <X className="h-3 w-3" /> rejeter
                      </button>
                    )}
                    {t.status === "approved" && (
                      <button
                        onClick={() => dailyMut.mutate(t.id)}
                        className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] text-primary hover:bg-primary/20"
                      >
                        <Star className="h-3 w-3" /> tool du jour
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Logs */}
      {s?.recentRuns?.length ? (
        <div className="mt-8">
          <h2 className="font-display text-lg font-bold">Dernières exécutions</h2>
          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-background/50 text-xs">
            <table className="w-full">
              <thead className="bg-secondary/40 text-left font-mono uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Quand</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Query</th>
                  <th className="px-3 py-2">Fetched</th>
                  <th className="px-3 py-2">Kept</th>
                  <th className="px-3 py-2">Erreur</th>
                </tr>
              </thead>
              <tbody>
                {s.recentRuns.map((r: any) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-muted-foreground">{new Date(r.run_at).toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-2 font-mono">{r.source}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{r.query}</td>
                    <td className="px-3 py-2 font-mono">{r.fetched_count}</td>
                    <td className="px-3 py-2 font-mono text-cyber-emerald">{r.kept_count}</td>
                    <td className="px-3 py-2 text-destructive">{r.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">{children}</div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="rounded-xl border border-border bg-gradient-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold ${accent ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}
