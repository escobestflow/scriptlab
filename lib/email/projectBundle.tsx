// Project-bundle email — HTML body renderer + companion serializers.
//
// Three artifacts are emitted per send:
//   1. HTML body       — React Email template, rendered server-side.
//                        This is what the user SEES in their inbox.
//   2. Fountain file   — industry-standard screenplay plaintext,
//                        attached. Opens in Final Draft, WriterDuet,
//                        Highland, etc. See lib/fountain.ts.
//   3. JSON snapshot   — the complete Story object, attached.
//                        Belongs to the user as a portable backup
//                        and doubles as a re-import seed for later.
//
// The HTML template deliberately uses only inline-ish styles via
// React Email's `style` props — email clients (Outlook especially)
// strip <style> tags and ignore classes. React Email handles the
// interop quirks for us.

import {
  Html, Head, Preview, Body, Container, Section, Heading,
  Text, Hr, Link, Row, Column,
} from "@react-email/components";
import { render } from "@react-email/render";
import type { Story, Beat, Episode, Character, Scene } from "../story";
import {
  getActiveConceptDraft,
  getActiveCharactersDraft,
  getActiveStoryLayerDraft,
  getActiveScriptDraft,
} from "../story";

// ── Styles ────────────────────────────────────────────────────────
// Inline styles shared across the template. Typed as React.CSSProperties
// so TS catches typos. React Email renders these into attribute strings.

const page: React.CSSProperties = {
  backgroundColor: "#f5f5f4",
  fontFamily: "'Lato', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
  color: "#1c1917",
  margin: 0,
  padding: 0,
};
const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  maxWidth: 640,
  margin: "0 auto",
  padding: "32px 28px 40px",
};
const brand: React.CSSProperties = {
  color: "#000000",
  fontSize: 22,
  fontWeight: 400,
  letterSpacing: "0.02em",
  margin: "0 0 4px",
};
const tagline: React.CSSProperties = {
  color: "#78716c",
  fontSize: 12,
  margin: "0 0 28px",
  letterSpacing: "0.04em",
};
const projectTitle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  margin: "0 0 6px",
  color: "#0a0a0a",
};
const projectMeta: React.CSSProperties = {
  fontSize: 13,
  color: "#57534e",
  margin: "0 0 20px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};
const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#a8a29e",
  margin: "32px 0 10px",
};
const body: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.6,
  color: "#292524",
  margin: "0 0 12px",
};
const hr: React.CSSProperties = {
  borderColor: "#e7e5e4",
  borderStyle: "solid",
  borderWidth: "1px 0 0 0",
  margin: "28px 0",
};
const charBlock: React.CSSProperties = {
  padding: "14px 16px",
  backgroundColor: "#fafaf9",
  border: "1px solid #e7e5e4",
  borderRadius: 8,
  marginBottom: 10,
};
const charName: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  margin: "0 0 2px",
  color: "#0a0a0a",
};
const charRole: React.CSSProperties = {
  fontSize: 12,
  color: "#78716c",
  margin: "0 0 8px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};
const charField: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  margin: "4px 0",
  color: "#44403c",
};
const charFieldLabel: React.CSSProperties = {
  fontWeight: 700,
  color: "#1c1917",
};
const beatBlock: React.CSSProperties = {
  paddingLeft: 16,
  borderLeft: "2px solid #e7e5e4",
  margin: "0 0 14px",
};
const beatName: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  margin: "0 0 4px",
  color: "#0a0a0a",
};
const beatSummary: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  color: "#44403c",
  margin: "0 0 4px",
};
const beatPurpose: React.CSSProperties = {
  fontSize: 12,
  color: "#78716c",
  fontStyle: "italic",
  margin: 0,
};
const sceneHeading: React.CSSProperties = {
  fontFamily: "'Courier New', 'Courier', monospace",
  fontSize: 13,
  fontWeight: 700,
  textTransform: "uppercase",
  margin: "20px 0 8px",
  color: "#0a0a0a",
  letterSpacing: "0.02em",
};
const sceneContent: React.CSSProperties = {
  fontFamily: "'Courier New', 'Courier', monospace",
  fontSize: 13,
  lineHeight: 1.55,
  whiteSpace: "pre-wrap",
  color: "#292524",
  margin: "0 0 4px",
};
const footer: React.CSSProperties = {
  fontSize: 12,
  color: "#a8a29e",
  textAlign: "center",
  margin: "36px 0 0",
  lineHeight: 1.5,
};

// ── Template ─────────────────────────────────────────────────────

interface ProjectBundleEmailProps {
  story: Story;
  appUrl: string;
}

function CharacterCard({ c }: { c: Character }) {
  return (
    <Section style={charBlock}>
      <Text style={charName}>{c.name || "Unnamed character"}</Text>
      {c.role && <Text style={charRole}>{c.role}</Text>}
      {c.archetype && (
        <Text style={charField}><span style={charFieldLabel}>Archetype · </span>{c.archetype}</Text>
      )}
      {c.want && (
        <Text style={charField}><span style={charFieldLabel}>Want · </span>{c.want}</Text>
      )}
      {c.need && (
        <Text style={charField}><span style={charFieldLabel}>Need · </span>{c.need}</Text>
      )}
      {c.flaws && (
        <Text style={charField}><span style={charFieldLabel}>Flaws · </span>{c.flaws}</Text>
      )}
      {c.backstory && (
        <Text style={charField}><span style={charFieldLabel}>Backstory · </span>{c.backstory}</Text>
      )}
      {c.voice && (
        <Text style={charField}><span style={charFieldLabel}>Voice · </span>{c.voice}</Text>
      )}
      {c.arc && (
        <Text style={charField}><span style={charFieldLabel}>Arc · </span>{c.arc}</Text>
      )}
    </Section>
  );
}

function BeatRow({ b }: { b: Beat }) {
  return (
    <Section style={beatBlock}>
      <Text style={beatName}>{b.position + 1}. {b.name || "Untitled beat"}</Text>
      {b.summary && <Text style={beatSummary}>{b.summary}</Text>}
      {b.purpose && <Text style={beatPurpose}>{b.purpose}</Text>}
    </Section>
  );
}

function SceneBlock({ s }: { s: Scene }) {
  return (
    <>
      <Text style={sceneHeading}>{s.heading || "UNTITLED SCENE"}</Text>
      {s.content && <Text style={sceneContent}>{s.content}</Text>}
    </>
  );
}

export function ProjectBundleEmail({ story, appUrl }: ProjectBundleEmailProps) {
  const concept = getActiveConceptDraft(story);
  const characters = getActiveCharactersDraft(story).characters;
  const storyLayer = getActiveStoryLayerDraft(story);
  const scriptDraft = getActiveScriptDraft(story);
  const episodes: Episode[] = storyLayer.episodes ?? [];
  const beats: Beat[] = storyLayer.beats ?? [];
  const isTv = story.projectType === "tv-show";
  // ScriptLayerDraft nests scenes under .script.scenes
  const scenes: Scene[] = scriptDraft.script?.scenes ?? [];

  const genreList = concept.settings?.genres?.join(" · ").toUpperCase() || "";
  const format =
    story.projectType === "feature" ? "Feature" :
    story.projectType === "short"   ? "Short"   :
    story.projectType === "tv-show" ? "TV Show" :
    "Project";

  return (
    <Html>
      <Head />
      <Preview>{`Your ${format.toLowerCase()} "${story.title || "Untitled"}" — project bundle from Unfold`}</Preview>
      <Body style={page}>
        <Container style={container}>
          {/* Brand header */}
          <Heading as="h1" style={brand}>unfold</Heading>
          <Text style={tagline}>Let your story unfold</Text>

          {/* Project header */}
          <Heading as="h2" style={projectTitle}>{story.title || "Untitled"}</Heading>
          <Text style={projectMeta}>
            {format}{genreList ? ` · ${genreList}` : ""}
          </Text>

          {concept.logline && (
            <Text style={{ ...body, fontStyle: "italic", color: "#44403c" }}>
              {concept.logline}
            </Text>
          )}

          <Hr style={hr} />

          {/* Concept */}
          <Heading as="h3" style={sectionTitle}>Concept</Heading>
          {concept.concept.summary && (
            <Text style={body}>{concept.concept.summary}</Text>
          )}
          {concept.concept.tone && (
            <Text style={body}>
              <strong>Tone: </strong>{concept.concept.tone}
            </Text>
          )}
          {concept.concept.themes?.length > 0 && (
            <Text style={body}>
              <strong>Themes: </strong>{concept.concept.themes.join(", ")}
            </Text>
          )}
          {!concept.concept.summary && !concept.concept.tone && !concept.concept.themes?.length && (
            <Text style={{ ...body, color: "#a8a29e", fontStyle: "italic" }}>
              No concept content yet.
            </Text>
          )}

          {/* Characters */}
          <Heading as="h3" style={sectionTitle}>Characters ({characters.length})</Heading>
          {characters.length === 0 ? (
            <Text style={{ ...body, color: "#a8a29e", fontStyle: "italic" }}>
              No characters yet.
            </Text>
          ) : (
            characters.map(c => <CharacterCard key={c.id} c={c} />)
          )}

          {/* Beats / Episodes */}
          <Heading as="h3" style={sectionTitle}>
            {isTv ? `Episodes (${episodes.length})` : `Beat outline (${beats.length})`}
          </Heading>
          {isTv ? (
            episodes.length === 0 ? (
              <Text style={{ ...body, color: "#a8a29e", fontStyle: "italic" }}>
                No episodes yet.
              </Text>
            ) : (
              episodes.map(ep => (
                <Section key={ep.id} style={{ marginBottom: 20 }}>
                  <Text style={{ ...beatName, fontSize: 16, marginBottom: 8 }}>
                    Episode {ep.number}: {ep.title}
                  </Text>
                  {(ep.beats ?? []).map(b => <BeatRow key={b.id} b={b} />)}
                </Section>
              ))
            )
          ) : (
            beats.length === 0 ? (
              <Text style={{ ...body, color: "#a8a29e", fontStyle: "italic" }}>
                No beats yet.
              </Text>
            ) : (
              beats.map(b => <BeatRow key={b.id} b={b} />)
            )
          )}

          {/* Script */}
          <Heading as="h3" style={sectionTitle}>Script ({scenes.length} scenes)</Heading>
          {scenes.length === 0 ? (
            <Text style={{ ...body, color: "#a8a29e", fontStyle: "italic" }}>
              No scenes yet.
            </Text>
          ) : (
            scenes.map(s => <SceneBlock key={s.id} s={s} />)
          )}

          <Hr style={hr} />

          {/* Footer */}
          <Text style={footer}>
            Attached to this email: <br />
            <strong>{slugify(story.title || "project")}.fountain</strong> — opens in Final Draft, WriterDuet, Highland <br />
            <strong>{slugify(story.title || "project")}.json</strong> — complete project snapshot (backup) <br />
            <br />
            <Link href={appUrl} style={{ color: "#57534e" }}>Open in Unfold →</Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

// ── Render helpers ────────────────────────────────────────────────

export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";
}

export async function renderProjectBundleHtml(
  story: Story,
  appUrl: string,
): Promise<string> {
  // @react-email/render's `render` is async in recent versions.
  return await render(<ProjectBundleEmail story={story} appUrl={appUrl} />);
}

// JSON snapshot — pretty-printed for human readability, but also a
// round-trippable Story object (no schema changes, no stripped fields).
export function serializeProjectJson(story: Story): string {
  return JSON.stringify(story, null, 2);
}
