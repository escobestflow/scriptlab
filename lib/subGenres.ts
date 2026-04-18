// Sub-genre catalog.
//
// Organized by the app's canonical Genre keys. Each entry has a human-
// readable name and a short list of well-known film examples. Examples for
// Action / Horror / Sci-Fi / Romance are drawn from NYFA's "Ultimate List
// of Film Sub-Genres" (https://www.nyfa.edu/student-resources/ultimate-
// list-of-film-sub-genres/). Examples for Thriller / Drama / Comedy /
// Mystery — which NYFA doesn't enumerate directly — are curated to match
// the same "three canonical films" pattern.
//
// The UI renders the union of these lists based on which parent genres
// the user has selected on a project. The `id` is what we persist on
// `settings.subGenres`.

import type { Genre } from "./story";

export interface SubGenreOption {
  id: string;          // e.g. "action:spy" — unique across all genres, stable in storage
  name: string;        // "Spy"
  examples: string[];  // ["James Bond", "Salt", "Mission: Impossible"]
}

type SubGenreMap = Record<Genre, SubGenreOption[]>;

function mk(genre: Genre, entries: Array<[string, string[]]>): SubGenreOption[] {
  return entries.map(([name, examples]) => ({
    id: `${genre}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    examples,
  }));
}

export const SUB_GENRES: SubGenreMap = {
  action: mk("action", [
    ["Epic",         ["Ben Hur", "Gone With the Wind", "Lawrence of Arabia"]],
    ["Spy",          ["James Bond", "Salt", "Mission: Impossible"]],
    ["Disaster",     ["Armageddon", "The Day After Tomorrow", "Poseidon"]],
    ["Superhero",    ["The Dark Knight", "Hancock", "Superman"]],
    ["Thriller",     ["Die Hard", "Lethal Weapon", "The Bourne Identity"]],
    ["Martial Arts", ["Enter the Dragon", "Drunken Master", "The Karate Kid"]],
    ["Video Game",   ["Resident Evil", "Tomb Raider", "Prince of Persia"]],
  ]),
  horror: mk("horror", [
    ["Slasher",              ["Nightmare on Elm Street", "Halloween", "Scream"]],
    ["Splatter",             ["Braindead", "Saw", "I Spit on Your Grave"]],
    ["Psychological Horror", ["Silence of the Lambs", "The Shining", "Black Swan"]],
    ["Survival Horror",      ["28 Days Later", "The Crazies", "Cube"]],
    ["Found Footage",        ["Blair Witch Project", "V/H/S", "As Above So Below"]],
    ["Paranormal/Occult",    ["Paranormal Activity", "The Exorcist", "Poltergeist"]],
    ["Monster",              ["Cloverfield", "Alien", "The Thing"]],
  ]),
  "sci-fi": mk("sci-fi", [
    ["Hard Sci-Fi",          ["Jurassic Park", "Gravity", "Europa Report"]],
    ["Apocalyptic",          ["12 Monkeys", "Planet of the Apes", "Terminator 2"]],
    ["Future Noir",          ["The Terminator", "Blade Runner"]],
    ["Space Opera",          ["Star Wars", "Star Trek", "Serenity"]],
    ["Military Sci-Fi",      ["Starship Troopers", "Aliens", "Edge of Tomorrow"]],
    ["Punk Sci-Fi",          ["Total Recall", "Metropolis", "Demolition Man"]],
    ["Speculative",          ["Primer", "Interstellar", "Source Code"]],
  ]),
  romance: mk("romance", [
    ["Romantic Drama",       ["Casablanca", "The English Patient", "A Walk to Remember"]],
    ["Rom-Com",              ["When Harry Met Sally", "Clueless", "Love Actually"]],
    ["Chick Flick",          ["Dirty Dancing", "The Notebook", "The Fault in Our Stars"]],
    ["Romantic Thriller",    ["Knight and Day", "Mr and Mrs Smith"]],
  ]),
  thriller: mk("thriller", [
    ["Psychological Thriller", ["Gone Girl", "Prisoners", "Zodiac"]],
    ["Political Thriller",     ["All the President's Men", "Three Days of the Condor", "Syriana"]],
    ["Techno-Thriller",        ["The Net", "Enemy of the State", "Ex Machina"]],
    ["Crime Thriller",         ["Se7en", "No Country for Old Men", "Nightcrawler"]],
    ["Spy Thriller",           ["Tinker Tailor Soldier Spy", "The Bourne Identity", "Munich"]],
    ["Legal Thriller",         ["A Few Good Men", "The Firm", "Primal Fear"]],
    ["Conspiracy Thriller",    ["The Manchurian Candidate", "JFK", "The Parallax View"]],
    ["Erotic Thriller",        ["Basic Instinct", "Fatal Attraction", "Body Heat"]],
  ]),
  drama: mk("drama", [
    ["Historical Drama",  ["Titanic", "Schindler's List", "Braveheart"]],
    ["Biopic",            ["Lincoln", "The Elephant Man", "Ali"]],
    ["Coming-of-Age",     ["Lady Bird", "Boyhood", "Stand By Me"]],
    ["Family Drama",      ["Kramer vs. Kramer", "Marriage Story", "The Royal Tenenbaums"]],
    ["Social Issue",      ["Spotlight", "Erin Brockovich", "Dallas Buyers Club"]],
    ["Sports Drama",      ["Rocky", "Million Dollar Baby", "Raging Bull"]],
    ["Medical Drama",     ["Awakenings", "Patch Adams", "The Doctor"]],
    ["Workplace Drama",   ["Glengarry Glen Ross", "Wall Street", "Michael Clayton"]],
    ["Period",            ["Sense and Sensibility", "Atonement", "The Age of Innocence"]],
  ]),
  comedy: mk("comedy", [
    ["Romantic Comedy",   ["When Harry Met Sally", "Notting Hill", "Crazy Rich Asians"]],
    ["Dark Comedy",       ["Fargo", "In Bruges", "The Death of Stalin"]],
    ["Satire",            ["Dr. Strangelove", "Network", "Thank You for Smoking"]],
    ["Screwball",         ["Bringing Up Baby", "The Philadelphia Story", "His Girl Friday"]],
    ["Slapstick",         ["Airplane!", "The Naked Gun", "Hot Shots!"]],
    ["Mockumentary",      ["This Is Spinal Tap", "Best in Show", "What We Do in the Shadows"]],
    ["Parody",            ["Spaceballs", "Hot Fuzz", "Scary Movie"]],
    ["Buddy Comedy",      ["21 Jump Street", "Superbad", "Step Brothers"]],
    ["Cringe Comedy",     ["Borat", "Eighth Grade", "The Office"]],
    ["Stoner Comedy",     ["The Big Lebowski", "Pineapple Express", "Harold & Kumar"]],
  ]),
  mystery: mk("mystery", [
    ["Whodunnit",           ["Knives Out", "Murder on the Orient Express", "Clue"]],
    ["Hardboiled Detective",["The Maltese Falcon", "The Big Sleep", "Chinatown"]],
    ["Cozy Mystery",        ["The Thin Man", "Only Murders in the Building", "Murder She Wrote"]],
    ["Noir",                ["Double Indemnity", "L.A. Confidential", "Sunset Boulevard"]],
    ["Supernatural Mystery",["The Sixth Sense", "Donnie Darko", "Mulholland Drive"]],
    ["Conspiracy Mystery",  ["The Da Vinci Code", "National Treasure", "The Ninth Gate"]],
  ]),
};

/** Flat index of every sub-genre by id, for reverse lookups (e.g. showing
 *  the names of currently-selected sub-genres in the collapsed row). */
export const SUB_GENRES_BY_ID: Record<string, SubGenreOption> = (() => {
  const out: Record<string, SubGenreOption> = {};
  (Object.keys(SUB_GENRES) as Genre[]).forEach(g => {
    SUB_GENRES[g].forEach(opt => { out[opt.id] = opt; });
  });
  return out;
})();

/** Returns the ordered union of sub-genre options for the given parent
 *  genres. De-duplicates by id (sub-genres are already scoped per parent,
 *  so collisions only happen if the same user picks, e.g., "Rom-Com"
 *  under both Romance and Comedy — which we model as separate options).
 *  Order matches the order of `genres` and the order within each list. */
export function subGenresFor(genres: Genre[]): SubGenreOption[] {
  const seen = new Set<string>();
  const out: SubGenreOption[] = [];
  for (const g of genres) {
    for (const opt of SUB_GENRES[g] ?? []) {
      if (!seen.has(opt.id)) {
        seen.add(opt.id);
        out.push(opt);
      }
    }
  }
  return out;
}
