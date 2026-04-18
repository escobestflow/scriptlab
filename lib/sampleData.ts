// Sample project data for first-time users.
// Uses the legacy top-level shape; normalizeStoryPublic() migrates it into
// the layered drafts[] structure the app actually renders from.

import type { Story } from "./story";
import { normalizeStoryPublic } from "./storage";

export interface Moment {
  id: string;
  text: string;
  type: "scene" | "dialogue" | "joke" | "memory" | "character" | "image" | "note" | "dream";
  tags: string[];
  createdAt: string;
  linkedProjectId?: string;
}

// Full-field character helper — every Character field populated so the
// Characters tab renders with no blank sections.
function chFull(args: {
  id: string; name: string; role: string; archetype: string;
  backstory: string; motivations: string; flaws: string;
  want: string; need: string; voice: string; arc: string; notes: string;
  relationships?: { characterId: string; description: string }[];
}) {
  return {
    id: args.id,
    name: args.name,
    role: args.role,
    archetype: args.archetype,
    backstory: args.backstory,
    motivations: args.motivations,
    flaws: args.flaws,
    want: args.want,
    need: args.need,
    relationships: args.relationships ?? [],
    voice: args.voice,
    arc: args.arc,
    notes: args.notes,
  };
}

// ── "Pending Review" — sci-fi comedy sample project ────────────────────────

const PENDING_REVIEW_RAW = {
  id: "p_pending_review",
  title: "Pending Review",
  projectType: "feature",
  logline: "When Earth is flagged for voluntary extinction by an intergalactic customer experience committee, a mediocre Amazon warehouse manager has four business days to justify humanity's continued operation — or be politely discontinued.",
  settings: {
    framework: "save-the-cat",
    genres: ["sci-fi", "comedy"],
    subGenres: ["sci-fi:speculative", "comedy:satire", "comedy:dark-comedy"],
    references: [
      { id: "ref_office_space", title: "Office Space", aspects: ["tone", "humor", "dialogue"] },
      { id: "ref_arrival", title: "Arrival", aspects: ["pacing", "emotional register", "structure"] },
      { id: "ref_severance", title: "Severance", aspects: ["production design", "atmosphere", "themes"] },
    ],
    writerStyles: ["Armando Iannucci", "Mike Schur", "Charlie Brooker"],
    vibe: "fluorescent-lit, deadpan, end-of-the-world bureaucracy",
    unpredictability: 6,
    darkness: 7,
    pace: 6,
    endingTypes: ["bittersweet"],
  },
  concept: {
    summary: "Earth has been quietly enrolled in a galactic civilization program for 300,000 years. Nobody asked us. Nobody told us. Today, the program is up for renewal — and a mid-level alien auditor has arrived to conduct humanity's exit interview. She chooses the first English-speaker her scanner locks onto: MARTIN KOWALSKI, assistant shift supervisor at an Amazon fulfillment center in Sparks, Nevada. Martin has four business days to defend the species. He does not know what a species is, technically. He does know how to hit a quarterly throughput target. It turns out these are not as different as you'd hope.",
    tone: "Deadpan corporate satire against a looming apocalypse. Office Space energy, Arrival stakes. Jokes land harder because nobody in the room thinks anything is funny.",
    themes: [
      "The dignity of ordinary work when nothing matters",
      "Bureaucracy as a form of kindness",
      "Why the universe would reasonably want us gone, and why that's not the whole story",
      "Fatherhood as a rehearsal for advocacy",
    ],
  },
  characters: [
    chFull({
      id: "c1",
      name: "Martin Kowalski",
      role: "protagonist",
      archetype: "the reluctant everyman",
      backstory: "42. Divorced, one daughter (Kayla, 11, primary custody on weekends). Community college dropout. Nine years at the warehouse, promoted to assistant shift supervisor eighteen months ago. Quietly proud of a framed Employee of the Month certificate from 2019. Reads Clive Cussler novels at lunch. Once wrote a half-chapter of his own novel; the file is named 'Untitled.docx'.",
      motivations: "To not let his daughter down. To finish a single thing in his life. To prove — mostly to himself — that he is a fundamentally decent person whose smallness is a circumstance, not a verdict.",
      flaws: "Conflict-avoidant to the point of invisibility. Says 'no worries' when there are, in fact, worries. Apologizes reflexively and then resents himself for it. Believes deep down that he deserves his life exactly as it is, and this belief quietly kills him.",
      want: "For the Auditor to please pick literally anyone else.",
      need: "To advocate — loudly, publicly, for the first time in his life — for something he cannot guarantee deserves it.",
      voice: "Polite, self-deprecating, pathologically reasonable. Undersells everything. Slips into warehouse jargon under stress ('we can totally pick-path this').",
      arc: "From 'I'm the wrong guy' to 'there is no right guy, there's just whoever is here.' Ends the film not as a hero, but as a person who can finish a sentence without flinching.",
      notes: "Wedding ring still on, four years after the divorce. He doesn't know why.",
      relationships: [
        { characterId: "c2", description: "The Auditor picked him out of eight billion people. He assumes this is a clerical error. She does not correct him." },
        { characterId: "c3", description: "Kayla is the only person whose opinion of him he cannot bear to lose." },
      ],
    }),
    chFull({
      id: "c2",
      name: "Vel-Nor-8 (\"The Auditor\")",
      role: "catalyst",
      archetype: "the unflappable bureaucrat",
      backstory: "Employee of the Galactic Civilization Review Board for 1,400 standard years. This is her 94th exit audit. She has never had a species successfully appeal. She is due for promotion after this one. She has a partner back home and two molted offspring she rarely mentions.",
      motivations: "To complete the audit on schedule. To be fair. To go home.",
      flaws: "Cannot process sarcasm, metaphor, or the phrase 'just kidding.' Has a sincere, slowly-dawning fondness for Martin that she classifies internally as 'data contamination' and tries to suppress. Writes everything down, including things that shouldn't be written down.",
      want: "A clean file and a timely departure.",
      need: "To discover that her own long career has been a species-level act of decency, not detachment. That caring was always the job.",
      voice: "Flat, precise, HR-manual cadence. Uses 'noted' the way other people use 'interesting.' Occasionally produces a phrase of startling poetry and then asks Martin if that was correctly formatted.",
      arc: "From 'this is paperwork' to 'paperwork is a choice you make about people.' Files a recommendation that is not the one she was sent to file.",
      notes: "Her scanner chose Martin because he was the closest English-speaker with a pulse above 60 bpm. She does not tell him this until Act III.",
      relationships: [
        { characterId: "c1", description: "Her assigned subject. Initially: a data point. Eventually: the reason she's going to lose her promotion and not mind." },
      ],
    }),
    chFull({
      id: "c3",
      name: "Kayla Kowalski",
      role: "ally",
      archetype: "the wiser-than-her-age kid",
      backstory: "11. Lives with her mom and stepdad in a nicer house than Martin's. Sees Martin every other weekend. Loves him. Is starting to notice that the adults around her treat him as slightly beneath them, and is furious about it.",
      motivations: "To be seen by her dad as someone capable of hearing the truth. To not be protected from the alien.",
      flaws: "Performs maturity. Sometimes cruel to Martin in the specific way kids are to parents they're afraid of losing.",
      want: "To spend the weekend.",
      need: "To see her dad stand up for something, so she can stop apologizing for him at school.",
      voice: "Direct, clipped, occasionally devastating. Uses vocabulary two years ahead of her age and deploys it like a small weapon.",
      arc: "Stops being embarrassed of him.",
      notes: "The only human other than Martin that The Auditor interacts with at length. They accidentally become pen pals.",
      relationships: [
        { characterId: "c1", description: "Her dad. The person she is most afraid of turning into, and most afraid of losing." },
        { characterId: "c2", description: "The alien. She is not afraid of her, which disarms everyone including the alien." },
      ],
    }),
    chFull({
      id: "c4",
      name: "Dr. Susan Chen",
      role: "mentor",
      archetype: "the burned-out expert",
      backstory: "SETI researcher, 58. Spent her entire career waiting for exactly this moment. Got it, and discovered she was not ready. Drinks now. The government has her on a short leash.",
      motivations: "To be the one who figures it out. To matter before she retires.",
      flaws: "Resents Martin for being chosen over her. This resentment is the engine of a good decision she eventually makes anyway.",
      want: "To take over the audit.",
      need: "To let the amateur do the job, and to make peace with a career spent preparing for a part someone else got.",
      voice: "Dry, tired, briefly luminous when the science is interesting. Swears with the weariness of someone who has given up on being impressive.",
      arc: "Hands Martin the one piece of information that wins the case, and does not ask for credit.",
      notes: "Has a daughter Kayla's age she never sees. Notices this.",
      relationships: [
        { characterId: "c1", description: "Professionally beneath her in every way. She hates this. She also, against her will, starts rooting for him." },
      ],
    }),
    chFull({
      id: "c5",
      name: "Doug Abernathy",
      role: "antagonist",
      archetype: "the ladder-climbing middle manager",
      backstory: "Martin's boss. 37. Believes, completely sincerely, that he is the hero of his own life and that Martin is a supporting character in it. Recently divorced, very online about it.",
      motivations: "To use the alien contact for a LinkedIn post. To be promoted above the site manager within the fiscal year.",
      flaws: "Mistakes volume for authority. Cannot read a room. Projects the insecurities he has about his own competence onto Martin and then confuses that projection for 'management.'",
      want: "To insert himself into the audit as the official human representative.",
      need: "(He does not get what he needs. He is not the movie's project.)",
      voice: "Sports-radio cadence. Says 'at the end of the day' at the beginning of sentences. Reads motivational quotes out loud to rooms that did not ask.",
      arc: "Exists to make Martin's path harder, then to be, in the end, a mildly embarrassed footnote.",
      notes: "The only character who tries to sell the alien a timeshare.",
      relationships: [
        { characterId: "c1", description: "Treats Martin as a subordinate. Is deeply confused when the alien will only speak to Martin." },
      ],
    }),
  ],
  ingredients: [
    { id: "i1", label: "setting", description: "An Amazon fulfillment center in Sparks, Nevada — 1.2 million square feet of fluorescent light, conveyor belts, and motivational posters nobody reads", locked: true },
    { id: "i2", label: "rule", description: "The Auditor can only receive testimony from the specific human her scanner locked onto — no substitutions, no co-counsel", locked: true },
    { id: "i3", label: "object", description: "A laminated, galactic-standard feedback form (47 questions, 5-point Likert scale) that will decide Earth's fate", locked: true },
    { id: "i4", label: "motif", description: "Polite customer-service language used in catastrophic contexts: 'please rate your experience'", locked: false },
    { id: "i5", label: "constraint", description: "Four business days. The Committee observes weekends.", locked: true },
    { id: "i6", label: "image", description: "A Post-it note from Kayla on Martin's fridge: 'you are good at stuff'", locked: false },
  ],
  snippets: [],
  beats: [
    {
      id: "b1", name: "Opening Image", position: 0, momentIds: [], status: "written",
      summary: "Martin scans his badge, walks onto the warehouse floor, delivers a flat 7am motivational speech to twenty people who are not listening. A conveyor belt jams. He fixes it himself. Nobody thanks him. He sips a lukewarm coffee and writes it up on the incident log.",
      purpose: "Establish Martin's baseline: competent, invisible, quietly depleted. A man who expects nothing and receives exactly that.",
      sceneContent: "INT. AMAZON FULFILLMENT CENTER — SORT FLOOR — DAWN\n\nFluorescents flicker on in sequence, a full city block of them, like a slow yawn.\n\nMARTIN KOWALSKI (42, polo shirt one size too big, lanyard, resigned posture) stands on a yellow-taped square and raises a clipboard.\n\nMARTIN\nMorning, team. Two quick things. One: the new pick-path is live, so if you see a red tag, that's a dupe, not a damage. Two: Kevin brought donuts. They are in the break room. That is all.\n\nHe waits. Nobody reacts. A forklift beeps in the distance.\n\nMARTIN (CONT'D)\nOkay. Great chat.\n\nHe steps down. His coffee is cold. He drinks it anyway.\n\nA conveyor belt SHUDDERS and stops. Everyone looks at it. Nobody moves.\n\nMARTIN (CONT'D)\nI got it.\n\nHe climbs up, reaches into the mechanism, pulls out a crushed cardboard box. The belt GROANS back to life. Someone somewhere claps, once, sarcastically. Martin pretends not to hear it.\n\nHe walks to his desk — a folding table with a laptop — and opens the incident log. He types: 06:47 AM. JAM. RESOLVED.\n\nHe stares at it for a moment.\n\nHe types, then deletes: BY ME.",
    },
    {
      id: "b2", name: "Theme Stated", position: 1, momentIds: [], status: "design",
      summary: "At lunch, a new hire asks Martin how he's stayed nine years. Martin says: 'You just keep showing up. That's pretty much the whole trick.' He means it as advice. It lands as an epitaph. Camera holds on him chewing.",
      purpose: "Plant the theme: showing up IS the thing, but there's a version of 'showing up' that's just survival and a version that's advocacy. Martin currently only knows the first one.",
    },
    {
      id: "b3", name: "Set-Up", position: 2, momentIds: [], status: "design",
      summary: "Intercut Martin's week: an awkward call with Kayla confirming the weekend ('we could get pizza'), Doug taking credit for Martin's throughput numbers in a meeting, Martin reheating the same Tupperware dinner three nights in a row. On Thursday night, a blue light appears over the parking lot. Nobody notices.",
      purpose: "Build the ordinary world. Make the stakes personal (Kayla) and the obstacles clear (Doug, inertia).",
    },
    {
      id: "b4", name: "Catalyst", position: 3, momentIds: [], status: "written",
      summary: "Friday, 6:02 AM. Martin is alone on the sort floor doing pre-shift. A humanoid figure in a crisp gray suit materializes next to the returns conveyor. She is holding a clipboard that is somehow also her.",
      purpose: "Inciting incident. The impossible enters Martin's most ordinary space and immediately behaves like HR.",
      sceneContent: "INT. WAREHOUSE — SORT FLOOR — 6:02 AM\n\nMartin is alone. Very faint hum of the building. He's counting pallets against a manifest, lips moving.\n\nA soft CHIME. Not alarming. Like a microwave finishing.\n\nHe looks up.\n\nVEL-NOR-8 stands six feet away. She is, at a glance, a woman in her forties in a perfectly tailored gray suit. At a second glance, something about her outline is wrong. Her shadow falls in a direction the lights don't support.\n\nShe holds what appears to be a clipboard. The clipboard appears to be holding her back.\n\nMartin blinks. He sets down the manifest very carefully.\n\nMARTIN\nUh. The visitor sign-in is at the front. I can — is Doug expecting you?\n\nVEL-NOR-8\nMartin Kowalski.\n\nMARTIN\nYes?\n\nVEL-NOR-8\nI am Vel-Nor-8, Auditor Class Three, Galactic Civilization Review Board. You have been selected as humanity's designated respondent for Earth's scheduled 300,000-year operational review. The audit window opens now and closes Wednesday at 5 PM your local time. Your cooperation is appreciated.\n\nA long beat. A forklift beeps, somewhere. Martin's brain is trying several doors at once.\n\nMARTIN\nI'm sorry, I'm — I'm assistant supervisor. You probably want someone —\n\nVEL-NOR-8\nYou have been selected.\n\nMARTIN\nRight, but, like. A senator? Or —\n\nVEL-NOR-8\nThe selection is final. Please confirm receipt by stating your full name.\n\nMartin looks around. The warehouse is enormous and he is, in every way that matters, entirely alone in it.\n\nMARTIN\n(quiet)\nMartin Joseph Kowalski.\n\nVEL-NOR-8\nNoted.\n\nShe taps her clipboard. Somewhere deep in the building, a conveyor belt starts up that Martin did not turn on.",
    },
    {
      id: "b5", name: "Debate", position: 4, momentIds: [], status: "design",
      summary: "Martin tries to punt: to Doug (who tries to promote himself onto the case and is politely ignored by the Auditor's scanner), to the government (Dr. Chen arrives within 90 minutes and is told she cannot speak for him). He is the designated respondent. He cannot delegate. He spends a long night on his couch drafting things to say and scrapping them.",
      purpose: "Deny the call. Establish the Rule: only Martin can testify. Force the character who avoids conflict to realize he cannot avoid this one.",
    },
    {
      id: "b6", name: "Break Into Two", position: 5, momentIds: [], status: "design",
      summary: "Saturday morning. Kayla is at his apartment (scheduled weekend). Martin tries to hide the alien in his bedroom. Kayla finds her within four minutes. Kayla, eleven, asks the Auditor what questions are on the form. The Auditor, bewildered, shows her. Kayla reads the first one aloud. Martin realizes he has to actually do this.",
      purpose: "Commitment. The daughter accidentally converts the task from 'survival' to 'representation.' He is not defending Earth. He is defending Earth in front of his kid.",
    },
    {
      id: "b7", name: "B Story", position: 6, momentIds: [], status: "design",
      summary: "The Auditor, watching Martin interact with Kayla, starts taking notes that are not on the official form. Dr. Chen, sidelined, becomes Martin's coach — reluctantly, then sincerely, arriving at his apartment with a binder and a bottle of wine.",
      purpose: "Two parallel relational threads that will pay off in the finale: the Auditor's data contamination, and Chen's choice to help instead of compete.",
    },
    {
      id: "b8", name: "Fun and Games", position: 7, momentIds: [], status: "design",
      summary: "Question 3: Describe a typical day for your species. Martin takes the Auditor on a road trip around Sparks. A Costco. A Little League game. An argument at a DMV that resolves with an apology. A vigil for a stranger. She takes notes on everything. She does not understand 60% of it. She records all of it anyway. Meanwhile Doug is doing cable news hits claiming he is Earth's ambassador.",
      purpose: "The promise of the premise. An alien doing ride-alongs through American mundanity, scored like a nature documentary.",
    },
    {
      id: "b9", name: "Midpoint", position: 8, momentIds: [], status: "design",
      summary: "Question 24: Rate your species' long-term viability as stewards of this planet. Martin, asked directly, says 'probably a 2.' The Auditor records it. Then she shows him her running score. Earth is currently at 1.4. Passing is 2.5. He has done more damage being honest than he realizes. He panics. Kayla, listening from the hallway, quietly leaves.",
      purpose: "False defeat. The turn from 'fun audit' to 'I am actually killing our chances.' Raise the stakes and fracture the Martin-Kayla thread.",
    },
    {
      id: "b10", name: "Bad Guys Close In", position: 9, momentIds: [], status: "design",
      summary: "Tuesday. Doug leaks the Auditor's location. Media descends on the warehouse. The government wants to move the audit to a secure facility. The Auditor refuses — protocol requires the respondent's 'native operational environment.' Martin has to testify in the break room while Good Morning America livestreams outside.",
      purpose: "External pressure pile-on. The audit gets harder because the humans make it harder.",
    },
    {
      id: "b11", name: "All Is Lost", position: 10, momentIds: [], status: "design",
      summary: "Wednesday, 3 PM. Final question: Why should this species be renewed? Martin has rehearsed a speech. He opens his mouth and nothing comes out. The Auditor waits. Twenty seconds of silence. She begins to mark the form 'No Response — Recommendation: Discontinue.' Kayla, who is there — she snuck in — says, loudly, 'Dad.' He looks at her. She just looks back.",
      purpose: "Dark night of the soul, compressed. The failure is not malicious — it's the lifetime of not-speaking catching up in the worst possible moment.",
    },
    {
      id: "b12", name: "Break Into Three", position: 11, momentIds: [], status: "written",
      summary: "Martin does not give a speech. He tells the Auditor about the conveyor belt jam on Monday. About Kevin's donuts. About his coworker's mom. About the DMV apology. About the Little League kid who struck out and tipped his hat to the pitcher anyway. About the incident log line he didn't write. He is not arguing for humanity. He is describing it.",
      purpose: "The synthesis. The character who could only do small, invisible things has been handed a planet-sized moment, and he meets it by telling the truth about the small things. Not despite his smallness — through it.",
      sceneContent: "INT. WAREHOUSE BREAK ROOM — LATE AFTERNOON\n\nFolding table. Vending machine. A clock that ticks. Martin across from Vel-Nor-8. Kayla against the wall, arms crossed, watching.\n\nMartin sets down the speech he printed out. Four pages, 14-point font. He doesn't look at it.\n\nMARTIN\nCan I just — can I just tell you about Monday.\n\nVEL-NOR-8\nMonday is outside the audit window.\n\nMARTIN\nI know. I'm asking anyway.\n\nA pause. She tilts her head the way she does when her scanner is confused.\n\nVEL-NOR-8\nProceed.\n\nMARTIN\nA conveyor belt jammed at 6:47. I fixed it. Nobody saw. I wrote it up on the log. I almost added 'by me.' I didn't. That was Monday.\n\nBeat.\n\nMARTIN (CONT'D)\nKevin brought donuts. Kevin always brings donuts. He doesn't have to, we don't even have a donut fund, he just does it. His mom has cancer, by the way. I don't know why he keeps bringing donuts. I think that's the answer to your question.\n\nHe looks at Kayla. She doesn't move.\n\nMARTIN (CONT'D)\nLast month I saw a kid strike out at a Little League game. He was maybe nine. He walked back to the dugout and he tipped his hat to the pitcher. The pitcher was also nine. I don't know why he did that. Nobody taught him to do that.\n\nVEL-NOR-8\nSpecify the relevance.\n\nMARTIN\nI don't know. I'm not — I'm not good at this. I know we're a 1.4. I know we throw out food. I know we've been —\n\n(he falters)\n\nI know. But if you're going to discontinue us can you at least write down that Kevin brought donuts. I'd like that to be in the file. Please.\n\nHe stops. He's been talking for a long time. The clock ticks.\n\nVel-Nor-8 looks at her form. She looks at Martin. She looks at Kayla. Her scanner makes a very small sound.\n\nShe does not write anything down.\n\nShe sets the clipboard on the table, face-up, pen beside it, and places her hands — if they are hands — flat on the table on either side of it.\n\nVEL-NOR-8\nContinue.\n\nMartin swallows. He keeps going.",
    },
    {
      id: "b13", name: "Finale — Gathering the Team", position: 12, momentIds: [], status: "design",
      summary: "Martin's testimony runs 90 minutes past the audit window. The Auditor does not stop it. Doug bursts in with a press crew; the Auditor, without looking up, turns his microphone into a small decorative plant. Dr. Chen quietly tells Martin the galactic scoring rubric weights 'observed mundane pro-sociality' at 3x — a thing she read in the Auditor's leaked briefing papers and never mentioned until now. Martin realizes Chen has been feeding him the winning play all along.",
      purpose: "Payoffs. Doug dismissed. Chen's arc lands (she chose to help). Martin is not alone on the floor anymore.",
    },
    {
      id: "b14", name: "Finale — Final Verdict", position: 13, momentIds: [], status: "design",
      summary: "The Auditor submits the form. Earth clears 2.5 by 0.04 points. Renewal granted — probationary, five-year review cycle. She tells Martin, privately: 'I filed a recommendation outside protocol. I will likely not be promoted.' He says, 'I'm sorry.' She says, 'Noted.' It is, for her, a joke. It is the first one she has ever made.",
      purpose: "The win, with a cost. Earth survives. The Auditor is changed. The stakes were real.",
    },
    {
      id: "b15", name: "Final Image", position: 14, momentIds: [], status: "design",
      summary: "Monday morning, 7 AM. Martin on the yellow-taped square with his clipboard. Same speech. Same lukewarm coffee. The belt jams. He fixes it. He walks to his desk, opens the incident log, types '06:47 AM. JAM. RESOLVED.' He pauses. Types: 'BY ME.' Does not delete it. Saves the file. Kayla's Post-it — 'you are good at stuff' — is on his monitor now. He did not put it there.",
      purpose: "Mirror of the opening. The ordinary world is exactly the same. Martin is not. The change is two words long.",
    },
  ],
  script: { scenes: [] as any[], syncStatus: "synced" as const },
  syncState: {},
  updatedAt: "2026-04-18T09:00:00.000Z",
};

// Legacy samples retained for reference — not seeded. Kept so any future
// "choose a starter template" UI has more than one option to draw from.
export const SAMPLE_PROJECTS: any[] = [PENDING_REVIEW_RAW];

export const SAMPLE_MOMENTS: Moment[] = [
  {
    id: "m_sample_1",
    text: "A mid-level alien auditor arrives at an Amazon warehouse at 6:02 AM holding a clipboard that is somehow also her.",
    type: "scene",
    tags: ["sci-fi", "deadpan", "workplace"],
    createdAt: "2026-04-18T09:00:00.000Z",
    linkedProjectId: "p_pending_review",
  },
  {
    id: "m_sample_2",
    text: "\"You just keep showing up. That's pretty much the whole trick.\"",
    type: "dialogue",
    tags: ["theme", "sample"],
    createdAt: "2026-04-18T09:00:00.000Z",
  },
];

// Freshly-id'd copy of the sample so multiple seed operations (or a
// "reset samples" feature) don't collide on the same primary key.
function cloneWithFreshIds(raw: any): any {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return {
    ...raw,
    id: `p_sample_${rand()}`,
    updatedAt: new Date().toISOString(),
    characters: raw.characters.map((c: any) => ({ ...c })),
    ingredients: raw.ingredients.map((i: any) => ({ ...i })),
    beats: raw.beats.map((b: any) => ({ ...b, momentIds: [...(b.momentIds ?? [])] })),
    snippets: [...(raw.snippets ?? [])],
  };
}

/** Returns a fully-normalized Story for the sci-fi comedy sample project,
 *  ready to be dropped straight into state and saved to the DB. */
export function makeSampleSciFiComedy(): Story {
  const raw = cloneWithFreshIds(PENDING_REVIEW_RAW);
  return normalizeStoryPublic(raw);
}
