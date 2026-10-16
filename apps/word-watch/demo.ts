// The demo: invented posts by invented people, in Jetstream's own message format, played through the
// same matcher as the real firehose — mostly posts that mention nothing you watch, as it is live.
// No real person's post is in here, and nothing is sent anywhere.

export const DEMO_WORDS = ["coffee", "rain"];

export const DEMO_PEOPLE = [
  { did: "did:plc:demoana000000000000000", handle: "ana.demo" },
  { did: "did:plc:demobruno0000000000000", handle: "bruno.demo" },
  { did: "did:plc:democlara0000000000000", handle: "clara.demo" },
  { did: "did:plc:demodawid0000000000000", handle: "dawid.demo" },
  { did: "did:plc:demoelena0000000000000", handle: "elena.demo" },
];

/** Posts that mention a demo word. */
const MATCHING = [
  "Morning coffee on the balcony before the rain starts.",
  "Is it just me or does the second coffee of the day always taste better?",
  "Rain all week here. The garden is happy, the dog is not.",
  "Rainy Sunday = soup day, and a big pot of coffee. #rain",
  "Can anyone recommend a coffee grinder that isn't loud?",
  "Football training cancelled because of the rain. Kids devastated.",
  "Cold brew season is over, back to hot coffee.",
  "The rain stopped just long enough for the walk home.",
  "Coffee with an old friend today. Three hours went by like ten minutes.",
  "Listening to the rain on the skylight. Best sound there is.",
];

/** Posts that do not — the bulk of any minute on Bluesky. "brain" is here on purpose: it is not "rain". */
const OTHERS = [
  "Finally fixed the leaking tap. Took three videos and one very patient neighbour.",
  "New bakery opened on our street and the cinnamon rolls are dangerous.",
  "Reading on the train again — forty pages and I missed my stop.",
  "Podcast recommendation thread: what are you listening to this week?",
  "Our team scored in the last minute!!! What a match ⚽",
  "Trying to learn the piano at 40. Scales are humbling.",
  "My brain is fried after this meeting marathon.",
  "Small win: inbox zero before lunch.",
  "My cat has decided the keyboard is the warmest place in the house.",
  "Ten years at this job today. Cake in the kitchen at 3.",
  "The sunset tonight was unreal.",
  "Anyone else's tomatoes still ripening in October?",
];

/** The order the demo plays: two others, then one that matches, round and round. */
export const DEMO_SCRIPT: string[] = (() => {
  const out: string[] = [];
  for (let i = 0; i < MATCHING.length; i++) out.push(OTHERS[(2 * i) % OTHERS.length]!, OTHERS[(2 * i + 1) % OTHERS.length]!, MATCHING[i]!);
  return out;
})();

/** One post as Jetstream sends it. */
export function demoMessage(i: number, now: number): string {
  const who = DEMO_PEOPLE[i % DEMO_PEOPLE.length]!;
  const rkey = `3demo${String(i).padStart(8, "0")}`;
  return JSON.stringify({
    did: who.did,
    time_us: now * 1000,
    kind: "commit",
    commit: {
      rev: rkey,
      operation: "create",
      collection: "app.bsky.feed.post",
      rkey,
      record: { $type: "app.bsky.feed.post", createdAt: new Date(now).toISOString(), langs: ["en"], text: DEMO_SCRIPT[i % DEMO_SCRIPT.length] },
      cid: `bafyreidemo${i}`,
    },
  });
}

/** How many a minute the demo's chart starts with, for the 30 minutes before it began: a quiet line. */
export const DEMO_BACKLOG: Record<string, number[]> = {
  coffee: [2, 3, 1, 4, 2, 5, 3, 2, 4, 6, 3, 2, 1, 3, 4, 2, 5, 7, 4, 3, 2, 3, 5, 4, 3, 2, 4, 3, 5, 6],
  rain: [1, 0, 2, 1, 3, 2, 4, 6, 5, 3, 2, 1, 2, 4, 3, 5, 6, 8, 7, 5, 3, 2, 2, 1, 3, 4, 2, 3, 2, 4],
};
