"use client";

import { Story } from "@/lib/story";

export function Home({
  projects,
  onNew,
  onOpen,
}: {
  projects: Story[];
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="page-enter">
      <div className="topbar">
        <div>
          <div className="eyebrow">ScriptWriter</div>
          <div className="display-sm iris-text" style={{ marginTop: 2 }}>
            Your stories
          </div>
        </div>
      </div>

      <div className="screen-scroll">
        {projects.length === 0 ? (
          <div className="neu-raised card" style={{ textAlign: "center", padding: "36px 24px" }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>✦</div>
            <div className="display-sm">Begin a new story</div>
            <div className="hero-sub">
              ScriptWriter walks you through shaping your script, step by step.
              Tap below to start your first one.
            </div>
          </div>
        ) : (
          <>
            <div className="eyebrow" style={{ marginBottom: 12, display: "block" }}>
              Projects · {projects.length}
            </div>
            {projects.map(p => (
              <button
                key={p.id}
                className="neu-raised project-card"
                onClick={() => onOpen(p.id)}
                style={{ width: "100%", textAlign: "left" }}
              >
                <div className="dot">{initials(p.title)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {p.title || "Untitled"}
                  </div>
                  <div className="meta">
                    {p.settings.genre} · {p.settings.framework.replace(/-/g, " ")}
                    {p.beats.length > 0 && ` · ${p.beats.length} beats`}
                  </div>
                </div>
                <div style={{ fontSize: 18, color: "var(--ink-mute)" }}>›</div>
              </button>
            ))}
          </>
        )}

        <div style={{ height: 40 }} />
      </div>

      {/* Bottom action */}
      <div className="wizard-bar">
        <button className="btn-chrome" onClick={onNew}>
          ✦ &nbsp;Start a new story
        </button>
      </div>
    </div>
  );
}

function initials(title: string) {
  if (!title) return "✦";
  const words = title.trim().split(/\s+/).slice(0, 2);
  return words.map(w => w[0]?.toUpperCase() ?? "").join("") || "✦";
}
