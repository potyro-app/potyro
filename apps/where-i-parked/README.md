# Where I parked

One tap keeps the spot where the car is. When you come back, the screen says how far it is and which
way to walk — "340 m to the north-east", with an arrow — and opens the pin in a map. A note ("Level 2,
near the stairs"), a photo of the level sign and the meter's time are one tap each; the meter starts
a countdown the shell keeps. "Found it" puts the spot in the history.

```
where-i-parked.app.tsx   the app: the Park screen, the map, the history, the tile, the demo
geo.ts                   distance (haversine), bearing, the eight compass points, "340 m", the map link
words.ts                 every word on the screens, in six languages
test/                    the arithmetic and the app's shape
```

With no car parked the whole screen is one button. Where you are comes only through `ctx.caps.geo`;
a device that will not say still gets a spot, without a pin, so a note can find it. A photo comes
only through `ctx.caps.camera`. The route is the map app's job: "Open in a map" is a link to the pin
on OpenStreetMap, as Places does.
