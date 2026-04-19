// Project PDF — server-rendered screenplay PDF for email attachments.
//
// Renders a "reader's draft" style PDF: Courier 12pt, US Letter, 1"
// margins, title page + one page per scene group. Not strict Hollywood
// format — we don't parse character names / dialogue out of the
// free-form `scene.content` string, so we emit scene heading + action
// block verbatim. Writers who want strict formatting use the .fountain
// file (also attached), which imports into Final Draft / WriterDuet
// with full formatting preserved.
//
// Deployment notes:
//   - Only built-in @react-pdf fonts are used (Courier, Courier-Bold,
//     Helvetica). We intentionally do NOT `Font.register` anything
//     custom — Vercel serverless can't always fetch remote fonts at
//     cold start, so sticking to built-ins makes the render hermetic.
//   - `pdf(<doc/>).toBuffer()` returns a Node Readable stream in
//     @react-pdf v3; we accumulate it into a Buffer for the Resend
//     attachment payload.

import {
  Document, Page, Text, View, StyleSheet, pdf,
} from "@react-pdf/renderer";
import type { Story, Scene, Beat, Episode, Character } from "../story";
import {
  getActiveConceptDraft,
  getActiveCharactersDraft,
  getActiveStoryLayerDraft,
  getActiveScriptDraft,
} from "../story";

// ── Styles ────────────────────────────────────────────────────────
// US Letter = 612 x 792 pt. 72pt = 1 inch margin on all sides unless
// noted. Screenplay convention: left margin slightly wider for binding.

const styles = StyleSheet.create({
  page: {
    paddingTop: 72,
    paddingBottom: 72,
    paddingLeft: 108, // 1.5" for binding
    paddingRight: 72,
    fontFamily: "Courier",
    fontSize: 12,
    lineHeight: 1.25,
    color: "#000000",
  },
  // Title page — Helvetica so the cover looks like a cover, not a
  // script. Centered block 1/3 down the page.
  titlePage: {
    paddingTop: 72,
    paddingBottom: 72,
    paddingLeft: 72,
    paddingRight: 72,
    fontFamily: "Helvetica",
    color: "#000000",
    justifyContent: "center",
    alignItems: "center",
  },
  titleBrand: {
    fontSize: 14,
    letterSpacing: 2,
    marginBottom: 48,
    color: "#555555",
  },
  titleMain: {
    fontSize: 32,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginBottom: 12,
  },
  titleFormat: {
    fontSize: 11,
    letterSpacing: 1.5,
    color: "#555555",
    marginBottom: 36,
    textTransform: "uppercase",
  },
  titleLogline: {
    fontSize: 13,
    fontStyle: "italic",
    textAlign: "center",
    maxWidth: 360,
    lineHeight: 1.5,
    marginBottom: 48,
  },
  titleMeta: {
    fontSize: 10,
    color: "#777777",
    textAlign: "center",
    marginTop: 24,
  },
  // Section divider pages — one per tab (concept, characters, etc.)
  sectionHeaderPage: {
    fontFamily: "Helvetica",
    paddingTop: 72,
    paddingBottom: 72,
    paddingLeft: 72,
    paddingRight: 72,
    justifyContent: "center",
    alignItems: "center",
  },
  sectionLabel: {
    fontSize: 10,
    letterSpacing: 2,
    color: "#888888",
    marginBottom: 16,
    textTransform: "uppercase",
  },
  sectionTitle: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
  },
  // Script body
  slug: {
    fontFamily: "Courier-Bold",
    fontSize: 12,
    marginTop: 18,
    marginBottom: 12,
    textTransform: "uppercase",
  },
  action: {
    fontFamily: "Courier",
    fontSize: 12,
    marginBottom: 12,
  },
  sceneNotes: {
    fontFamily: "Courier",
    fontSize: 10,
    color: "#555555",
    marginTop: 8,
    marginBottom: 12,
    fontStyle: "italic",
  },
  // Concept / Characters / Beats pages use Helvetica for readability
  readerPage: {
    paddingTop: 72,
    paddingBottom: 72,
    paddingLeft: 72,
    paddingRight: 72,
    fontFamily: "Helvetica",
    fontSize: 11,
    lineHeight: 1.5,
    color: "#000000",
  },
  readerH1: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    marginBottom: 12,
  },
  readerH2: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    marginTop: 18,
    marginBottom: 6,
  },
  readerBody: {
    fontSize: 11,
    marginBottom: 8,
  },
  readerMuted: {
    fontSize: 10,
    color: "#666666",
    marginBottom: 8,
  },
  charBlock: {
    borderLeft: "2pt solid #cccccc",
    paddingLeft: 12,
    marginBottom: 14,
  },
  charName: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  charRole: {
    fontSize: 9,
    letterSpacing: 1,
    color: "#666666",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  charField: {
    fontSize: 10,
    marginBottom: 3,
  },
  charFieldLabel: {
    fontFamily: "Helvetica-Bold",
  },
  beatRow: {
    marginBottom: 10,
    paddingLeft: 12,
    borderLeft: "2pt solid #cccccc",
  },
  beatName: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
  },
  beatSummary: {
    fontSize: 10,
    marginTop: 2,
  },
  beatPurpose: {
    fontSize: 9,
    color: "#666666",
    fontStyle: "italic",
    marginTop: 2,
  },
  footer: {
    position: "absolute",
    bottom: 36,
    left: 72,
    right: 72,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#aaaaaa",
    textAlign: "center",
  },
  pageNumber: {
    position: "absolute",
    top: 36,
    right: 72,
    fontSize: 10,
    fontFamily: "Courier",
    color: "#888888",
  },
});

// ── Document ──────────────────────────────────────────────────────

interface ProjectPdfProps {
  story: Story;
}

export function ProjectPdfDocument({ story }: ProjectPdfProps) {
  const concept = getActiveConceptDraft(story);
  const characters = getActiveCharactersDraft(story).characters;
  const storyLayer = getActiveStoryLayerDraft(story);
  const scriptDraft = getActiveScriptDraft(story);
  const beats: Beat[] = storyLayer.beats ?? [];
  const episodes: Episode[] = storyLayer.episodes ?? [];
  const scenes: Scene[] = scriptDraft.script?.scenes ?? [];
  const isTv = story.projectType === "tv-show";
  const format =
    story.projectType === "feature" ? "Feature" :
    story.projectType === "short"   ? "Short"   :
    story.projectType === "tv-show" ? "TV Show" :
    "Project";
  const genreList = (concept.settings?.genres ?? []).join(" · ").toUpperCase();

  return (
    <Document
      title={story.title || "Untitled"}
      author="Unfold"
      creator="Unfold (unfold.app)"
      producer="@react-pdf/renderer"
    >
      {/* ── Title page ── */}
      <Page size="LETTER" style={styles.titlePage}>
        <Text style={styles.titleBrand}>UNFOLD</Text>
        <Text style={styles.titleMain}>{story.title || "Untitled"}</Text>
        <Text style={styles.titleFormat}>
          {format}{genreList ? ` · ${genreList}` : ""}
        </Text>
        {concept.logline ? (
          <Text style={styles.titleLogline}>{concept.logline}</Text>
        ) : null}
        <Text style={styles.titleMeta}>
          Draft · {new Date().toISOString().slice(0, 10)}
        </Text>
      </Page>

      {/* ── Concept ── */}
      {(concept.concept.summary || concept.concept.tone || concept.concept.themes?.length) ? (
        <Page size="LETTER" style={styles.readerPage}>
          <Text style={styles.readerH1}>Concept</Text>
          {concept.concept.summary ? (
            <>
              <Text style={styles.readerH2}>Summary</Text>
              <Text style={styles.readerBody}>{concept.concept.summary}</Text>
            </>
          ) : null}
          {concept.concept.tone ? (
            <>
              <Text style={styles.readerH2}>Tone</Text>
              <Text style={styles.readerBody}>{concept.concept.tone}</Text>
            </>
          ) : null}
          {concept.concept.themes?.length ? (
            <>
              <Text style={styles.readerH2}>Themes</Text>
              <Text style={styles.readerBody}>{concept.concept.themes.join(" · ")}</Text>
            </>
          ) : null}
          <Text style={styles.footer} fixed>
            {story.title || "Untitled"} · Concept
          </Text>
        </Page>
      ) : null}

      {/* ── Characters ── */}
      {characters.length > 0 ? (
        <Page size="LETTER" style={styles.readerPage}>
          <Text style={styles.readerH1}>Characters</Text>
          {characters.map((c: Character) => (
            <View key={c.id} style={styles.charBlock} wrap={false}>
              <Text style={styles.charName}>{c.name || "Unnamed"}</Text>
              {c.role ? <Text style={styles.charRole}>{c.role}</Text> : null}
              {c.archetype ? (
                <Text style={styles.charField}>
                  <Text style={styles.charFieldLabel}>Archetype · </Text>{c.archetype}
                </Text>
              ) : null}
              {c.want ? (
                <Text style={styles.charField}>
                  <Text style={styles.charFieldLabel}>Want · </Text>{c.want}
                </Text>
              ) : null}
              {c.need ? (
                <Text style={styles.charField}>
                  <Text style={styles.charFieldLabel}>Need · </Text>{c.need}
                </Text>
              ) : null}
              {c.flaws ? (
                <Text style={styles.charField}>
                  <Text style={styles.charFieldLabel}>Flaws · </Text>{c.flaws}
                </Text>
              ) : null}
              {c.backstory ? (
                <Text style={styles.charField}>
                  <Text style={styles.charFieldLabel}>Backstory · </Text>{c.backstory}
                </Text>
              ) : null}
              {c.voice ? (
                <Text style={styles.charField}>
                  <Text style={styles.charFieldLabel}>Voice · </Text>{c.voice}
                </Text>
              ) : null}
              {c.arc ? (
                <Text style={styles.charField}>
                  <Text style={styles.charFieldLabel}>Arc · </Text>{c.arc}
                </Text>
              ) : null}
            </View>
          ))}
          <Text style={styles.footer} fixed>
            {story.title || "Untitled"} · Characters
          </Text>
        </Page>
      ) : null}

      {/* ── Beats / Episodes ── */}
      {isTv && episodes.length > 0 ? (
        <Page size="LETTER" style={styles.readerPage}>
          <Text style={styles.readerH1}>Episodes</Text>
          {episodes.map(ep => (
            <View key={ep.id} wrap={false} style={{ marginBottom: 16 }}>
              <Text style={styles.readerH2}>Episode {ep.number}: {ep.title}</Text>
              {(ep.beats ?? []).map(b => (
                <View key={b.id} style={styles.beatRow}>
                  <Text style={styles.beatName}>{b.position + 1}. {b.name || "Untitled"}</Text>
                  {b.summary ? <Text style={styles.beatSummary}>{b.summary}</Text> : null}
                  {b.purpose ? <Text style={styles.beatPurpose}>{b.purpose}</Text> : null}
                </View>
              ))}
            </View>
          ))}
          <Text style={styles.footer} fixed>
            {story.title || "Untitled"} · Episodes
          </Text>
        </Page>
      ) : !isTv && beats.length > 0 ? (
        <Page size="LETTER" style={styles.readerPage}>
          <Text style={styles.readerH1}>Beat outline</Text>
          {beats.map(b => (
            <View key={b.id} style={styles.beatRow} wrap={false}>
              <Text style={styles.beatName}>{b.position + 1}. {b.name || "Untitled"}</Text>
              {b.summary ? <Text style={styles.beatSummary}>{b.summary}</Text> : null}
              {b.purpose ? <Text style={styles.beatPurpose}>{b.purpose}</Text> : null}
            </View>
          ))}
          <Text style={styles.footer} fixed>
            {story.title || "Untitled"} · Beats
          </Text>
        </Page>
      ) : null}

      {/* ── Script divider ── */}
      {scenes.length > 0 ? (
        <Page size="LETTER" style={styles.sectionHeaderPage}>
          <Text style={styles.sectionLabel}>{story.title || "Untitled"}</Text>
          <Text style={styles.sectionTitle}>Screenplay</Text>
        </Page>
      ) : null}

      {/* ── Script body ── */}
      {scenes.length > 0 ? (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.pageNumber} render={({ pageNumber }) => `${pageNumber}.`} fixed />
          {scenes.map(s => (
            <View key={s.id} wrap={true}>
              <Text style={styles.slug}>{s.heading || "UNTITLED SCENE"}</Text>
              {s.content ? <Text style={styles.action}>{s.content}</Text> : null}
              {s.notes ? <Text style={styles.sceneNotes}>[NOTE: {s.notes}]</Text> : null}
            </View>
          ))}
          <Text style={styles.footer} fixed>
            {story.title || "Untitled"} · Screenplay
          </Text>
        </Page>
      ) : null}
    </Document>
  );
}

// ── Render helper ────────────────────────────────────────────────
// Collect the @react-pdf Node stream into a Buffer for Resend.

export async function renderProjectPdfBuffer(story: Story): Promise<Buffer> {
  const instance = pdf(<ProjectPdfDocument story={story} />);
  // toBuffer() returns a Node Readable stream (despite the name).
  const stream = await instance.toBuffer();
  return await streamToBuffer(stream);
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
