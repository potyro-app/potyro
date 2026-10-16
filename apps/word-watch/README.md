# Word Watch

Pick a few words; every public Bluesky post that mentions one arrives as it is written — who, what,
and a tap away from the post on bsky.app — with how often each word comes up, minute by minute.

```
word-watch.app.ts   the app: Live, Per minute, Words, a post's page, a word's page
feed.ts             the live side: the stream, matching, writing at most every 2 s, handles, pruning, the demo
watch.ts            Jetstream's messages read; the matcher; the sums behind counts and sparklines
live.ts             keeping one live connection (shared by the live apps)
demo.ts             invented posts by invented people, in Jetstream's format
words.ts            how the feed reads, in six languages
fixtures/           Jetstream messages in their real format, people and texts replaced by invented ones
test/               reading, matching, throughput, the stream end to end against a scripted ctx
```

## How it works

- **The stream** is Bluesky's public Jetstream, `wss://jetstream2.us-east.bsky.network/subscribe
  ?wantedCollections=app.bsky.feed.post` (docs/28): every new post on the network, tens to hundreds a
  second. One server, not Bluesky's four in turn: a shared copy is asked once per host, and a second
  question in the middle of a dropped connection would read as something gone wrong.
- **The firehose is dropped, not stored.** Each message is tested as raw text first — does it contain
  any watched word at all? — and nearly every one stops there, unparsed (a test holds that no
  message without a word reaches `JSON.parse`; 20,000 messages take well under a second). Only new
  posts count (no edits, deletes, identity or account events); a word must stand on its own ("rain",
  not "brain"), in any case and script; posts their authors marked adult are left out.
- **Written at most every 2 s.** Every match is counted per word and minute; only the newest 3 posts
  per word per write are kept, at most 150 posts in all, an hour of minutes per word. Handles come
  from Bluesky's public AppView in one `getProfiles` request per write.
- **Text only**: no images, no links followed. A post's page has its whole text and the link to it on
  bsky.app.
- **Per minute**: per word, the rate in the last whole minute, a sparkline of the last 15 minutes and
  the last hour; and a bar per minute for the last 30.
- **Reconnecting, the background, leaving**: as every live app (live.ts, docs/28 §5).
- **The demo** adds two sample words, a quiet half hour of counts, then plays 30 invented posts, one
  in three mentioning a word — through the same matcher, with nothing sent. **Watch live** takes the
  demo's posts away and keeps its words as yours.

## Sealed and yours

Built-in views only, so a shared copy works whole. Sealed it reaches `jetstream2.us-east.bsky.network`
and `public.api.bsky.app` only, asked once each. Words are added with **Add a word**; there is no
other add button (`quickActions: []`).

## Build and check

```
pnpm --filter @potyro/app-word-watch build       # → apps/word-watch/dist/word-watch.potyro-app.zip
pnpm --filter @potyro/app-word-watch test
pnpm e2e e2e/word-watch-trusted.spec.ts
```
