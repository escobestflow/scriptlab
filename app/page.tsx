"use client";

import { useEffect, useState } from "react";
import { Story } from "@/lib/story";
import { loadProjects, saveProjects, newBlankProject } from "@/lib/storage";
import { Home } from "@/components/Home";
import { Wizard } from "@/components/Wizard";
import { Studio } from "@/components/Studio";

type View =
  | { kind: "home" }
  | { kind: "wizard"; draft: Story }
  | { kind: "studio"; projectId: string };

export default function Page() {
  const [projects, setProjects] = useState<Story[]>([]);
  const [view, setView] = useState<View>({ kind: "home" });
  const [hydrated, setHydrated] = useState(false);

  // hydrate from localStorage
  useEffect(() => {
    setProjects(loadProjects());
    setHydrated(true);
  }, []);

  // persist on change
  useEffect(() => {
    if (hydrated) saveProjects(projects);
  }, [projects, hydrated]);

  const updateProject = (id: string, u: (s: Story) => Story) =>
    setProjects(ps =>
      ps.map(p =>
        p.id === id
          ? { ...u(p), updatedAt: new Date().toISOString() }
          : p
      )
    );

  if (!hydrated) {
    return (
      <div className="app">
        <div className="screen-scroll" />
      </div>
    );
  }

  return (
    <div className="app">
      {view.kind === "home" && (
        <Home
          projects={projects}
          onNew={() => setView({ kind: "wizard", draft: newBlankProject() })}
          onOpen={(id) => setView({ kind: "studio", projectId: id })}
        />
      )}

      {view.kind === "wizard" && (
        <Wizard
          draft={view.draft}
          setDraft={(u) => setView(v => v.kind === "wizard" ? { ...v, draft: u(v.draft) } : v)}
          onCancel={() => setView({ kind: "home" })}
          onFinish={() => {
            const saved = view.draft;
            setProjects(ps => [saved, ...ps]);
            setView({ kind: "studio", projectId: saved.id });
          }}
        />
      )}

      {view.kind === "studio" && (() => {
        const project = projects.find(p => p.id === view.projectId);
        if (!project) {
          setView({ kind: "home" });
          return null;
        }
        return (
          <Studio
            story={project}
            setStory={(u) => updateProject(project.id, u)}
            onBack={() => setView({ kind: "home" })}
          />
        );
      })()}
    </div>
  );
}
