"use client";

// Usage dashboard — admin-only view of every AI provider call the app
// has made in the last 30 days. Pulls raw rows from /api/admin/usage
// (which gates on the same hardcoded admin email) and aggregates
// client-side into:
//
//   1. KPI strip      — spend today, spend this month, total calls
//   2. By user        — table of users, calls, $, with a "trusted" badge
//                       for the two expected high-usage emails
//   3. By action      — what features are burning the most $
//   4. Daily timeline — last 14 days, stacked by provider
//   5. Recent calls   — the last 200 rows, filterable
//
// This is observability tooling, not a production UI surface — the
// styling is deliberately utilitarian. Numbers > polish.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { isAdmin, isTrusted } from "@/lib/adminEmails";

type Row = {
  id: string;
  created_at: string;
  user_id: string | null;
  user_email: string;
  project_id: string | null;
  project_name: string | null;
  target_id: string | null;
  target_name: string | null;
  draft_id: string | null;
  draft_label: string | null;
  provider: "anthropic" | "openai";
  kind: "text" | "image" | "audio";
  model: string;
  action: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  image_count: number | null;
  image_size: string | null;
  audio_chars: number | null;
  est_cost_usd: number | null;
  error: string | null;
};

const fmtUsd = (n: number) =>
  n >= 100 ? `$${n.toFixed(0)}`
  : n >= 10 ? `$${n.toFixed(1)}`
  : n >= 1  ? `$${n.toFixed(2)}`
            : `$${n.toFixed(3)}`;

const fmtInt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const dayKey = (iso: string) => iso.slice(0, 10); // "2026-05-17"

export default function AdminUsagePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [filterEmail, setFilterEmail] = useState<string>("");
  const [filterAction, setFilterAction] = useState<string>("");

  // Bounce non-admins to "/" once auth loads. While loading, render a
  // blank page so we don't briefly flash the dashboard to anyone who
  // shouldn't see it. (The /api/admin/usage route would refuse them
  // anyway — this is just a polish layer.)
  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin(user?.email)) {
      router.replace("/");
    }
  }, [authLoading, user?.email, router]);

  useEffect(() => {
    if (authLoading || !isAdmin(user?.email)) return;
    let cancelled = false;
    (async () => {
      try {
        // Pass the email header explicitly. The AuthProvider's fetch
        // wrapper normally injects this for /api/* calls, but its
        // useEffect installs the wrapper on a re-render and the
        // page's own useEffect can fire first (React runs child
        // effects before parent effects). Setting it here removes
        // that race entirely.
        const res = await fetch("/api/admin/usage", {
          headers: { "x-user-email": user?.email ?? "" },
        });
        if (!res.ok) {
          const body = await res.text();
          if (!cancelled) setFetchErr(`HTTP ${res.status}: ${body.slice(0, 200)}`);
          return;
        }
        const json = await res.json();
        if (!cancelled) setRows(json.rows as Row[]);
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setFetchErr(msg);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [authLoading, user?.email]);

  // Auth still resolving, or non-admin caught mid-redirect.
  if (authLoading || !isAdmin(user?.email)) {
    return <div style={pageWrap} />;
  }

  if (fetchErr) {
    return (
      <div style={pageWrap}>
        <h1 style={h1}>Usage Dashboard</h1>
        <div style={errBox}>Failed to load: {fetchErr}</div>
      </div>
    );
  }

  if (!rows) {
    return (
      <div style={pageWrap}>
        <h1 style={h1}>Usage Dashboard</h1>
        <div style={dim}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={pageWrap}>
      <h1 style={h1}>Usage Dashboard</h1>
      <div style={subtle}>
        Last 30 days · {rows.length.toLocaleString()} calls · auto-refresh disabled (reload page for fresh data)
      </div>

      <Kpis rows={rows} />
      <SuspectedDuplicates rows={rows} />
      <ByUser rows={rows} filterEmail={filterEmail} setFilterEmail={setFilterEmail} />
      <ByAction rows={rows} filterAction={filterAction} setFilterAction={setFilterAction} />
      <DailyTimeline rows={rows} />
      <RecentTable
        rows={rows}
        filterEmail={filterEmail}
        filterAction={filterAction}
        setFilterEmail={setFilterEmail}
        setFilterAction={setFilterAction}
      />
    </div>
  );
}

// ── KPI strip ───────────────────────────────────────────────────
function Kpis({ rows }: { rows: Row[] }) {
  const { today, month, errors, unknownUsers } = useMemo(() => {
    const today = dayKey(new Date().toISOString());
    const monthPrefix = today.slice(0, 7); // "2026-05"
    let t = 0;
    let m = 0;
    let e = 0;
    const unknown = new Set<string>();
    for (const r of rows) {
      const cost = r.est_cost_usd ?? 0;
      if (dayKey(r.created_at) === today) t += cost;
      if (r.created_at.startsWith(monthPrefix)) m += cost;
      if (r.error) e += 1;
      if (!isTrusted(r.user_email)) unknown.add(r.user_email);
    }
    return { today: t, month: m, errors: e, unknownUsers: unknown };
  }, [rows]);

  return (
    <div style={kpiRow}>
      <Kpi label="Today" value={fmtUsd(today)} hint={`${rows.filter(r => dayKey(r.created_at) === dayKey(new Date().toISOString())).length} calls`} />
      <Kpi label="This month" value={fmtUsd(month)} hint={`${fmtInt(rows.length)} calls total in last 30d`} />
      <Kpi label="Errors (30d)" value={fmtInt(errors)} hint={errors > 0 ? "see Recent calls" : "all clear"} tone={errors > 0 ? "warn" : "ok"} />
      <Kpi
        label="Untrusted users"
        value={fmtInt(unknownUsers.size)}
        hint={
          unknownUsers.size > 0
            ? Array.from(unknownUsers).slice(0, 3).join(", ") + (unknownUsers.size > 3 ? "…" : "")
            : "only Luis + Mike"
        }
        tone={unknownUsers.size > 0 ? "warn" : "ok"}
      />
    </div>
  );
}

function Kpi({
  label, value, hint, tone,
}: { label: string; value: string; hint?: string; tone?: "warn" | "ok" }) {
  const borderColor =
    tone === "warn" ? "#f5a623" :
    tone === "ok"   ? "#1f7a3a" :
    "#2a2a2c";
  return (
    <div style={{ ...kpiBox, borderColor }}>
      <div style={kpiLabel}>{label}</div>
      <div style={kpiValue}>{value}</div>
      {hint && <div style={kpiHint}>{hint}</div>}
    </div>
  );
}

// ── Suspected duplicates ────────────────────────────────────────
// Groups image gens by (project_id, target_id, draft_id). When the
// same (target, draft) shows >1 generation, surfaces it as a likely
// bug — image gens cost ~$0.19 each so accidental dupes are the
// #1 thing the user wants to catch. Same target across DIFFERENT
// drafts is fine (drafts are intentional copies) and not flagged.
function SuspectedDuplicates({ rows }: { rows: Row[] }) {
  const dupes = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      if (r.kind !== "image") continue;
      if (!r.target_id) continue; // Only character/beat images, not project thumbnails
      const key = `${r.project_id ?? "?"}|${r.target_id}|${r.draft_id ?? "?"}`;
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    const out: Array<{
      key: string;
      projectName: string;
      targetName: string;
      draftLabel: string;
      action: string;
      count: number;
      totalCost: number;
      rows: Row[];
    }> = [];
    for (const [key, list] of groups.entries()) {
      if (list.length < 2) continue;
      const first = list[0];
      out.push({
        key,
        projectName: first.project_name ?? "(unknown project)",
        targetName: first.target_name ?? "(unknown target)",
        draftLabel: first.draft_label ?? "(no draft label)",
        action: first.action,
        count: list.length,
        totalCost: list.reduce((s, r) => s + (r.est_cost_usd ?? 0), 0),
        rows: list,
      });
    }
    return out.sort((a, b) => b.count - a.count);
  }, [rows]);

  if (dupes.length === 0) {
    return (
      <section style={section}>
        <h2 style={h2}>Suspected duplicate image generations</h2>
        <div style={{ ...dim, fontSize: 13 }}>
          No duplicates detected. Every (project · target · draft) combination
          has at most one image generation — that&apos;s the expected state.
        </div>
      </section>
    );
  }

  return (
    <section style={{ ...section, borderColor: "#5a3a1a" }}>
      <h2 style={h2}>
        Suspected duplicate image generations
        <span style={{ marginLeft: 10, color: "#f5a623", fontSize: 12, fontWeight: 400, textTransform: "none" }}>
          {dupes.length} group{dupes.length === 1 ? "" : "s"} · same target + draft generated more than once
        </span>
      </h2>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Project</th>
            <th style={th}>Target</th>
            <th style={th}>Draft</th>
            <th style={th}>Action</th>
            <th style={thNum}>Gens</th>
            <th style={thNum}>Wasted</th>
          </tr>
        </thead>
        <tbody>
          {dupes.map(d => (
            <tr key={d.key}>
              <td style={td}>{d.projectName}</td>
              <td style={td}><strong>{d.targetName}</strong></td>
              <td style={td}><span style={dim}>{d.draftLabel}</span></td>
              <td style={td}><code style={code}>{d.action}</code></td>
              <td style={{ ...tdNum, color: "#f5a623", fontWeight: 600 }}>{d.count}</td>
              <td style={{ ...tdNum, color: "#f5a623" }}>
                {fmtUsd(d.totalCost - (d.totalCost / d.count))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ ...dim, fontSize: 11, marginTop: 8 }}>
        &quot;Wasted&quot; estimates the cost of redundant calls beyond the first one in each group.
      </div>
    </section>
  );
}

// ── By user ─────────────────────────────────────────────────────
function ByUser({
  rows, filterEmail, setFilterEmail,
}: {
  rows: Row[];
  filterEmail: string;
  setFilterEmail: (e: string) => void;
}) {
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const stats = useMemo(() => {
    const m = new Map<string, { calls: number; cost: number; errors: number }>();
    for (const r of rows) {
      if (!r.created_at.startsWith(monthPrefix)) continue;
      const key = r.user_email;
      const cur = m.get(key) ?? { calls: 0, cost: 0, errors: 0 };
      cur.calls += 1;
      cur.cost += r.est_cost_usd ?? 0;
      if (r.error) cur.errors += 1;
      m.set(key, cur);
    }
    return Array.from(m.entries())
      .map(([email, s]) => ({ email, ...s }))
      .sort((a, b) => b.cost - a.cost);
  }, [rows, monthPrefix]);

  return (
    <section style={section}>
      <h2 style={h2}>By user (this month)</h2>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Email</th>
            <th style={thNum}>Calls</th>
            <th style={thNum}>Cost</th>
            <th style={thNum}>Errors</th>
            <th style={th}>Status</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {stats.map(s => (
            <tr key={s.email}>
              <td style={td}>{s.email}</td>
              <td style={tdNum}>{fmtInt(s.calls)}</td>
              <td style={tdNum}>{fmtUsd(s.cost)}</td>
              <td style={{ ...tdNum, color: s.errors > 0 ? "#f5a623" : undefined }}>{fmtInt(s.errors)}</td>
              <td style={td}>
                {isTrusted(s.email)
                  ? <span style={{ ...pill, background: "#1a2e1f", color: "#7ad48e" }}>trusted</span>
                  : <span style={{ ...pill, background: "#2e1a1a", color: "#f5a623" }}>unexpected</span>
                }
              </td>
              <td style={td}>
                <button
                  type="button"
                  style={linkBtn}
                  onClick={() => setFilterEmail(filterEmail === s.email ? "" : s.email)}
                >
                  {filterEmail === s.email ? "clear filter" : "see calls →"}
                </button>
              </td>
            </tr>
          ))}
          {stats.length === 0 && (
            <tr><td style={td} colSpan={6}><span style={dim}>No usage this month yet.</span></td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

// ── By action ───────────────────────────────────────────────────
function ByAction({
  rows, filterAction, setFilterAction,
}: {
  rows: Row[];
  filterAction: string;
  setFilterAction: (a: string) => void;
}) {
  const stats = useMemo(() => {
    const m = new Map<string, { calls: number; cost: number; model: string }>();
    for (const r of rows) {
      const cur = m.get(r.action) ?? { calls: 0, cost: 0, model: r.model };
      cur.calls += 1;
      cur.cost += r.est_cost_usd ?? 0;
      m.set(r.action, cur);
    }
    return Array.from(m.entries())
      .map(([action, s]) => ({ action, ...s }))
      .sort((a, b) => b.cost - a.cost);
  }, [rows]);

  return (
    <section style={section}>
      <h2 style={h2}>By action (last 30d)</h2>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Action</th>
            <th style={th}>Model</th>
            <th style={thNum}>Calls</th>
            <th style={thNum}>Cost</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {stats.map(s => (
            <tr key={s.action}>
              <td style={td}><code style={code}>{s.action}</code></td>
              <td style={td}><span style={dim}>{s.model}</span></td>
              <td style={tdNum}>{fmtInt(s.calls)}</td>
              <td style={tdNum}>{fmtUsd(s.cost)}</td>
              <td style={td}>
                <button
                  type="button"
                  style={linkBtn}
                  onClick={() => setFilterAction(filterAction === s.action ? "" : s.action)}
                >
                  {filterAction === s.action ? "clear filter" : "see calls →"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── Daily timeline ──────────────────────────────────────────────
function DailyTimeline({ rows }: { rows: Row[] }) {
  const days = useMemo(() => {
    // Build a map: day → { anthropicCost, openaiCost }
    const m = new Map<string, { anthropic: number; openai: number }>();
    // Pre-seed last 14 days (chronological, oldest first).
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      m.set(d.toISOString().slice(0, 10), { anthropic: 0, openai: 0 });
    }
    for (const r of rows) {
      const k = dayKey(r.created_at);
      const cur = m.get(k);
      if (!cur) continue; // older than 14d
      const cost = r.est_cost_usd ?? 0;
      if (r.provider === "anthropic") cur.anthropic += cost;
      else if (r.provider === "openai") cur.openai += cost;
    }
    return Array.from(m.entries()).map(([day, v]) => ({ day, ...v, total: v.anthropic + v.openai }));
  }, [rows]);

  const maxDay = Math.max(0.0001, ...days.map(d => d.total));

  return (
    <section style={section}>
      <h2 style={h2}>Daily timeline (last 14 days)</h2>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 160, padding: "8px 0" }}>
        {days.map(d => {
          const totalPct = (d.total / maxDay) * 100;
          const aPct = d.total > 0 ? (d.anthropic / d.total) * totalPct : 0;
          const oPct = d.total > 0 ? (d.openai    / d.total) * totalPct : 0;
          return (
            <div key={d.day} title={`${d.day}\nAnthropic: ${fmtUsd(d.anthropic)}\nOpenAI: ${fmtUsd(d.openai)}\nTotal: ${fmtUsd(d.total)}`}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column-reverse",
                position: "relative",
                minWidth: 0,
              }}
            >
              <div style={{ height: `${aPct}%`, background: "#5a8dc0", borderTopLeftRadius: aPct > 0 && oPct === 0 ? 3 : 0, borderTopRightRadius: aPct > 0 && oPct === 0 ? 3 : 0 }} />
              <div style={{ height: `${oPct}%`, background: "#c08e5a", borderTopLeftRadius: oPct > 0 ? 3 : 0, borderTopRightRadius: oPct > 0 ? 3 : 0 }} />
              <div style={{
                position: "absolute",
                bottom: -22,
                left: 0,
                right: 0,
                textAlign: "center",
                fontSize: 10,
                color: "#888",
              }}>
                {d.day.slice(5)}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 30, fontSize: 12, color: "#999" }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#5a8dc0", marginRight: 6, verticalAlign: "middle" }} /> Anthropic</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#c08e5a", marginRight: 6, verticalAlign: "middle" }} /> OpenAI</span>
      </div>
    </section>
  );
}

// ── Recent calls table ──────────────────────────────────────────
function RecentTable({
  rows, filterEmail, filterAction, setFilterEmail, setFilterAction,
}: {
  rows: Row[];
  filterEmail: string;
  filterAction: string;
  setFilterEmail: (e: string) => void;
  setFilterAction: (a: string) => void;
}) {
  const filtered = useMemo(() => {
    return rows.filter(r =>
      (!filterEmail || r.user_email === filterEmail) &&
      (!filterAction || r.action === filterAction)
    ).slice(0, 200);
  }, [rows, filterEmail, filterAction]);

  return (
    <section style={section}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ ...h2, margin: 0 }}>Recent calls</h2>
        <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
          {filterEmail && (
            <span style={chip}>
              email: <strong>{filterEmail}</strong>
              <button type="button" style={chipClear} onClick={() => setFilterEmail("")}>×</button>
            </span>
          )}
          {filterAction && (
            <span style={chip}>
              action: <strong>{filterAction}</strong>
              <button type="button" style={chipClear} onClick={() => setFilterAction("")}>×</button>
            </span>
          )}
        </div>
      </div>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Time</th>
            <th style={th}>User</th>
            <th style={th}>Project</th>
            <th style={th}>Target</th>
            <th style={th}>Draft</th>
            <th style={th}>Action</th>
            <th style={thNum}>Tokens / count</th>
            <th style={thNum}>Cost</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(r => (
            <tr key={r.id} style={r.error ? { background: "#1e1612" } : undefined}>
              <td style={td}>
                <span style={dim}>
                  {new Date(r.created_at).toLocaleString("en-US", {
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                  })}
                </span>
              </td>
              <td style={td}>
                <button type="button" style={linkBtn} onClick={() => setFilterEmail(r.user_email)}>
                  {r.user_email}
                </button>
                {!isTrusted(r.user_email) && (
                  <span style={{ ...pill, background: "#2e1a1a", color: "#f5a623", marginLeft: 6 }}>!</span>
                )}
              </td>
              <td style={td}>
                {r.project_name
                  ? <span>{r.project_name}</span>
                  : <span style={dim}>—</span>}
              </td>
              <td style={td}>
                {r.target_name
                  ? <strong>{r.target_name}</strong>
                  : <span style={dim}>—</span>}
              </td>
              <td style={td}>
                {r.draft_label
                  ? <span style={dim}>{r.draft_label}</span>
                  : <span style={dim}>—</span>}
              </td>
              <td style={td}>
                <button type="button" style={linkBtn} onClick={() => setFilterAction(r.action)}>
                  <code style={code}>{r.action}</code>
                </button>
              </td>
              <td style={tdNum}>
                {r.kind === "text" && (
                  <span style={dim}>
                    {fmtInt((r.input_tokens ?? 0) + (r.cache_read_input_tokens ?? 0))}
                    {" in / "}
                    {fmtInt(r.output_tokens ?? 0)}
                    {" out"}
                  </span>
                )}
                {r.kind === "image" && (
                  <span style={dim}>{r.image_count ?? 1} × {r.image_size ?? "—"}</span>
                )}
                {r.kind === "audio" && (
                  <span style={dim}>{fmtInt(r.audio_chars ?? 0)} chars</span>
                )}
              </td>
              <td style={tdNum}>{fmtUsd(r.est_cost_usd ?? 0)}</td>
              <td style={td}>
                {r.error
                  ? <span style={{ color: "#f5a623", fontSize: 11 }} title={r.error}>error</span>
                  : <span style={{ ...dim, fontSize: 11 }}>ok</span>}
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td style={td} colSpan={9}><span style={dim}>No calls match these filters.</span></td></tr>
          )}
        </tbody>
      </table>
      {rows.length > filtered.length && !filterEmail && !filterAction && (
        <div style={{ ...dim, fontSize: 11, marginTop: 8 }}>
          Showing 200 of {fmtInt(rows.length)} rows. Apply a filter to narrow down further.
        </div>
      )}
    </section>
  );
}

// ── Styles ──────────────────────────────────────────────────────
// Inline styles intentionally — the dashboard is a single utilitarian
// page and doesn't need to share visual language with the rest of the
// app. Dark surface, simple typography, dense tables.

const pageWrap: React.CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  padding: "32px 24px 80px",
  fontFamily: "-apple-system, system-ui, sans-serif",
  color: "#e8e8e8",
};
const h1: React.CSSProperties = { margin: 0, fontSize: 24, fontWeight: 600 };
const h2: React.CSSProperties = { margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#bdbdbd", textTransform: "uppercase", letterSpacing: 0.5 };
const subtle: React.CSSProperties = { color: "#777", fontSize: 12, margin: "4px 0 24px" };
const dim: React.CSSProperties = { color: "#888" };
const code: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 };
const section: React.CSSProperties = { margin: "32px 0", padding: "20px 22px", background: "#141416", borderRadius: 10, border: "1px solid #1f1f22" };
const errBox: React.CSSProperties = { padding: "12px 16px", background: "#2e1a1a", color: "#f5a623", borderRadius: 8, marginTop: 16, fontSize: 13 };

const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #2a2a2c", color: "#999", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 };
const thNum: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "8px 8px", borderBottom: "1px solid #1f1f22", verticalAlign: "middle" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

const kpiRow: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 8 };
const kpiBox: React.CSSProperties = { padding: "14px 16px", background: "#141416", border: "1px solid #2a2a2c", borderRadius: 10 };
const kpiLabel: React.CSSProperties = { fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 };
const kpiValue: React.CSSProperties = { fontSize: 22, fontWeight: 600, fontVariantNumeric: "tabular-nums" };
const kpiHint: React.CSSProperties = { marginTop: 4, fontSize: 11, color: "#777" };

const pill: React.CSSProperties = { display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 };
const linkBtn: React.CSSProperties = { background: "none", border: 0, color: "#9bb7d4", cursor: "pointer", padding: 0, font: "inherit", textAlign: "left" };
const chip: React.CSSProperties = { padding: "3px 8px", background: "#22252a", borderRadius: 999, color: "#bbb", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 };
const chipClear: React.CSSProperties = { background: "none", border: 0, color: "#999", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1 };
