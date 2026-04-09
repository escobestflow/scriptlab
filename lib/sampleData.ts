import { Story } from "./story";

export interface Moment {
  id: string;
  text: string;
  type: "scene" | "dialogue" | "joke" | "memory" | "character" | "image";
  tags: string[];
  createdAt: string;
  linkedProjectId?: string;
}

export const SAMPLE_PROJECTS: Story[] = [
  {
    id: "p_quiet_room",
    title: "The Quiet Room",
    logline: "A reclusive woman is forced to confront her past when a stranger moves into the apartment next door and starts playing the same song her late sister used to sing.",
    settings: {
      framework: "save-the-cat",
      genre: "thriller",
      vibe: "neon-lit, rainy, lonely",
      unpredictability: 7,
      darkness: 8,
      pace: 4,
      endingType: "bittersweet",
    },
    characters: [
      { id: "c1", name: "Mae", role: "protagonist", want: "To be left alone", need: "To forgive herself for her sister's death", notes: "Late 30s. Works from home. Hasn't left her apartment in 6 months." },
      { id: "c2", name: "Jonah", role: "catalyst", want: "A fresh start", need: "To stop running from his own grief", notes: "Moves in next door. Musician. Disarmingly kind." },
    ],
    ingredients: [
      { id: "i1", label: "setting", description: "A rent-controlled apartment building with paper-thin walls", locked: true },
      { id: "i2", label: "object", description: "A cassette tape with no label", locked: false },
      { id: "i3", label: "rule", description: "Mae never opens her door for anyone", locked: true },
      { id: "i4", label: "motif", description: "The same melody appearing in different contexts", locked: false },
    ],
    snippets: [
      { id: "s1", title: "Fluorescent hum", tags: ["atmosphere","opening"], content: "The fluorescent lights hum in E-flat. She's counted. She's been counting for an hour.", usedInBeats: ["b1"] },
    ],
    beats: [
      { id: "b1", name: "Opening Image", summary: "Mae sits alone. Curtains drawn. She checks her phone obsessively — no messages. Makes tea, lets it go cold. The silence is her natural state.", purpose: "Establish isolation as both comfort and prison." },
      { id: "b2", name: "Theme Stated", summary: "A knock at the door. Mae freezes. The neighbor's voice: 'Sorry, thin walls. I'll keep it down.' She doesn't answer.", purpose: "The outside world arrives uninvited." },
      { id: "b3", name: "Set-Up", summary: "Mae's routine: remote work, grocery delivery, medication organizer. We see her sister in photos but never named.", purpose: "Show the architecture of avoidance." },
      { id: "b4", name: "Catalyst", summary: "Through the wall, Jonah plays a melody on guitar. Mae drops her mug. It's the song her sister used to sing.", purpose: "The inciting violation of her controlled world." },
      { id: "b5", name: "Debate", summary: "Mae tries to ignore it. Puts on white noise. Earplugs. But the melody finds her everywhere — in the pipes, the elevator music, her dreams.", purpose: "Can she maintain the walls she's built?" },
      { id: "b6", name: "Break Into Two", summary: "Mae slides a note under Jonah's door: 'Where did you learn that song?' He slides one back: 'My mother. Where did you hear it?'", purpose: "She chooses connection over isolation." },
    ],
    updatedAt: "2026-04-08T18:22:00.000Z",
  },
  {
    id: "p_sundown",
    title: "Sundown Motel",
    logline: "Three strangers check into a motel that shouldn't exist on any map, and discover the rooms rearrange themselves to reflect each guest's worst memory.",
    settings: {
      framework: "heros-journey",
      genre: "horror",
      vibe: "desert heat, faded neon, VHS static",
      unpredictability: 9,
      darkness: 9,
      pace: 6,
      endingType: "ambiguous",
    },
    characters: [
      { id: "c1", name: "Delia", role: "protagonist", want: "To find her missing son", need: "To accept what really happened that night", notes: "Driving cross-country for 3 days straight. Running on fumes." },
      { id: "c2", name: "Roy", role: "ally", want: "A place to sleep", need: "To stop lying to himself", notes: "Trucker. Seems normal. Is not." },
      { id: "c3", name: "The Clerk", role: "threshold guardian", want: "Unknown", need: "Unknown", notes: "Knows too much. Never leaves the front desk." },
    ],
    ingredients: [
      { id: "i1", label: "setting", description: "A motel at mile marker 0 on a road that doesn't exist", locked: true },
      { id: "i2", label: "rule", description: "You can check out, but the door opens into a different room", locked: true },
      { id: "i3", label: "object", description: "A guest book with entries dating back to 1953, all in the same handwriting", locked: false },
    ],
    snippets: [],
    beats: [
      { id: "b1", name: "Ordinary World", summary: "Delia drives through endless desert. Radio cuts in and out. A photo of a boy taped to the dash.", purpose: "Ground us in her obsession and exhaustion." },
      { id: "b2", name: "Call to Adventure", summary: "GPS dies. A neon sign flickers to life where there was nothing: SUNDOWN MOTEL. VACANCY.", purpose: "The threshold appears." },
      { id: "b3", name: "Refusal", summary: "Delia almost drives past. But the car stalls. Engine dead. The motel is the only light for miles.", purpose: "Choice is removed." },
    ],
    updatedAt: "2026-04-07T10:15:00.000Z",
  },
  {
    id: "p_last_summer",
    title: "Last Summer Before Everything",
    logline: "Two best friends spend their final summer before college trying to shoot a short film about their friendship, only to discover they remember their shared history completely differently.",
    settings: {
      framework: "three-act",
      genre: "comedy",
      vibe: "golden hour, handheld camera, laughing until it hurts",
      unpredictability: 4,
      darkness: 3,
      pace: 7,
      endingType: "bittersweet",
    },
    characters: [
      { id: "c1", name: "Nora", role: "protagonist", want: "To make a perfect film about their friendship", need: "To let go of the past", notes: "Type-A. Carries a shot list everywhere. Afraid of change." },
      { id: "c2", name: "Benny", role: "co-lead", want: "To have one last wild summer", need: "To tell Nora he's not going to college", notes: "Class clown. Hides real feelings behind humor." },
    ],
    ingredients: [
      { id: "i1", label: "setting", description: "A small beach town that's being gentrified — their favorite spots keep closing", locked: true },
      { id: "i2", label: "object", description: "A cheap camcorder from 2004 that Nora insists on using", locked: false },
      { id: "i3", label: "rule", description: "Every scene they shoot reveals a memory they disagree about", locked: true },
    ],
    snippets: [],
    beats: [],
    updatedAt: "2026-04-09T02:30:00.000Z",
  },
];

export const SAMPLE_MOMENTS: Moment[] = [
  {
    id: "m1",
    text: "A woman hears a song through the wall and drops everything she's holding. The mug shatters. She doesn't clean it up. She just stands there, listening.",
    type: "scene",
    tags: ["emotional", "sound", "memory"],
    createdAt: "2026-04-08T14:30:00.000Z",
    linkedProjectId: "p_quiet_room",
  },
  {
    id: "m2",
    text: "\"You ever notice how the last day of something never feels like the last day? It always feels normal. That's the cruelest part.\"",
    type: "dialogue",
    tags: ["nostalgia", "endings"],
    createdAt: "2026-04-07T22:15:00.000Z",
  },
  {
    id: "m3",
    text: "Two guys arguing about whether a hot dog is a sandwich, and it slowly becomes clear they're actually arguing about something much deeper — one of them is moving away.",
    type: "joke",
    tags: ["subtext", "comedy", "friendship"],
    createdAt: "2026-04-07T11:05:00.000Z",
  },
  {
    id: "m4",
    text: "I remember the exact moment I realized my dad was shorter than me. We were standing in the kitchen and I looked down. He noticed too. Neither of us said anything.",
    type: "memory",
    tags: ["family", "growing-up", "silence"],
    createdAt: "2026-04-06T09:40:00.000Z",
  },
  {
    id: "m5",
    text: "A motel clerk who has been working the front desk for 70 years. Never ages. Knows every guest by name before they sign in.",
    type: "character",
    tags: ["horror", "mystery", "uncanny"],
    createdAt: "2026-04-05T16:20:00.000Z",
    linkedProjectId: "p_sundown",
  },
  {
    id: "m6",
    text: "Shot of a long empty hallway. Flickering fluorescent. A child's shoe in the middle of the floor. No explanation. Move on.",
    type: "image",
    tags: ["atmosphere", "horror", "visual"],
    createdAt: "2026-04-04T20:55:00.000Z",
  },
  {
    id: "m7",
    text: "What if the GPS takes you to a place that doesn't exist on the map, but when you arrive, there's clearly something there? And everyone acts like it's always been there.",
    type: "scene",
    tags: ["uncanny", "disorientation"],
    createdAt: "2026-04-03T13:10:00.000Z",
  },
];
