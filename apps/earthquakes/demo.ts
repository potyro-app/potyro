// The demo's earthquakes: real events EMSC reported on 13–15 October 2026 (CC BY 4.0), kept as they
// were except for their time, which the demo squeezes into the last day. `DEMO_BACKLOG` is that day
// (minutes before the demo starts); `DEMO_LIVE` arrives one by one, as the feed would send them.
// Generated from fixtures/fdsn-recent.json; the last live one is a revision of an earlier one,
// as EMSC sends them (`action: "update"`).

export interface DemoEvent {
  uid: string;
  region: string;
  mag: number;
  magtype: string;
  depth: number;
  lat: number;
  lon: number;
  auth: string;
  minutesAgo: number;
  action?: "create" | "update";
}

export const DEMO_BACKLOG: DemoEvent[] = [
  {"uid": "20261015_0000160", "region": "VANUATU", "mag": 5.2, "magtype": "mb", "depth": 37.0, "lat": -13.9158, "lon": 166.0866, "auth": "EMSC", "minutesAgo": 174},
  {"uid": "20261015_0000139", "region": "OFF COAST OF ECUADOR", "mag": 4.8, "magtype": "mb", "depth": 18.0, "lat": 0.9903, "lon": -85.2618, "auth": "EMSC", "minutesAgo": 217},
  {"uid": "20261015_0000135", "region": "CENTRAL ALASKA", "mag": 5.0, "magtype": "mw", "depth": 10.0, "lat": 64.1958, "lon": -152.7238, "auth": "EMSC", "minutesAgo": 221},
  {"uid": "20261015_0000128", "region": "HINDU KUSH REGION, AFGHANISTAN", "mag": 4.4, "magtype": "mb", "depth": 62.0, "lat": 37.274, "lon": 70.2996, "auth": "EMSC", "minutesAgo": 250},
  {"uid": "20261015_0000066", "region": "NORTH ISLAND OF NEW ZEALAND", "mag": 5.1, "magtype": "mw", "depth": 280.2, "lat": -38.6348, "lon": 175.3695, "auth": "EMSC", "minutesAgo": 352},
  {"uid": "20261015_0000067", "region": "ETHIOPIA", "mag": 4.6, "magtype": "mb", "depth": 10.0, "lat": 9.1109, "lon": 39.8674, "auth": "EMSC", "minutesAgo": 369},
  {"uid": "20261015_0000068", "region": "BABUYAN ISL REGION, PHILIPPINES", "mag": 4.6, "magtype": "mb", "depth": 10.0, "lat": 19.1, "lon": 121.58, "auth": "GFZ", "minutesAgo": 369},
  {"uid": "20261015_0000049", "region": "SAMOA ISLANDS", "mag": 5.1, "magtype": "mb", "depth": 13.0, "lat": -13.4293, "lon": -171.9426, "auth": "EMSC", "minutesAgo": 394},
  {"uid": "20261015_0000074", "region": "SAMOA ISLANDS", "mag": 4.8, "magtype": "mb", "depth": 13.5, "lat": -13.4327, "lon": -172.1174, "auth": "NEIC", "minutesAgo": 394},
  {"uid": "20261015_0000029", "region": "NEAR EAST COAST OF HONSHU, JAPAN", "mag": 4.4, "magtype": "mb", "depth": 36.1, "lat": 36.4152, "lon": 141.7775, "auth": "NEIC", "minutesAgo": 429},
  {"uid": "20261014_0000416", "region": "NEAR EAST COAST OF KAMCHATKA", "mag": 4.5, "magtype": "mb", "depth": 183.0, "lat": 53.9346, "lon": 158.1776, "auth": "EMSC", "minutesAgo": 492},
  {"uid": "20261014_0000439", "region": "CENTRAL MID-ATLANTIC RIDGE", "mag": 4.7, "magtype": "mb", "depth": 10.0, "lat": -0.343, "lon": -19.2064, "auth": "NEIC", "minutesAgo": 701},
  {"uid": "20261014_0000232", "region": "NEAR EAST COAST OF HONSHU, JAPAN", "mag": 4.4, "magtype": "mb", "depth": 50.0, "lat": 38.6456, "lon": 141.9859, "auth": "EMSC", "minutesAgo": 724},
  {"uid": "20261014_0000192", "region": "FIJI REGION", "mag": 5.9, "magtype": "mw", "depth": 581.5, "lat": -20.9925, "lon": -178.7975, "auth": "EMSC", "minutesAgo": 781},
  {"uid": "20261014_0000171", "region": "SOUTHERN PERU", "mag": 4.4, "magtype": "mb", "depth": 163.0, "lat": -15.443, "lon": -72.058, "auth": "GFZ", "minutesAgo": 806},
  {"uid": "20261014_0000164", "region": "TANZANIA", "mag": 4.6, "magtype": "mb", "depth": 10.0, "lat": -5.4382, "lon": 35.0544, "auth": "EMSC", "minutesAgo": 817},
  {"uid": "20261014_0000165", "region": "TANZANIA", "mag": 4.5, "magtype": "mw", "depth": 10.0, "lat": -5.429, "lon": 34.962, "auth": "GFZ", "minutesAgo": 842},
  {"uid": "20261014_0000119", "region": "NEW BRITAIN REGION, P.N.G.", "mag": 4.9, "magtype": "mb", "depth": 35.0, "lat": -5.4019, "lon": 152.2469, "auth": "EMSC", "minutesAgo": 882},
  {"uid": "20261014_0000096", "region": "PANAMA", "mag": 4.7, "magtype": "mb", "depth": 12.0, "lat": 7.5442, "lon": -80.6172, "auth": "EMSC", "minutesAgo": 912},
  {"uid": "20261014_0000085", "region": "PANAMA", "mag": 4.4, "magtype": "m", "depth": 5.0, "lat": 7.6266, "lon": -81.349, "auth": "IGC", "minutesAgo": 916},
  {"uid": "20261014_0000082", "region": "PANAMA", "mag": 4.4, "magtype": "m", "depth": 10.0, "lat": 7.3789, "lon": -80.0907, "auth": "IGC", "minutesAgo": 923},
  {"uid": "20261014_0000048", "region": "OFFSHORE TARAPACA, CHILE", "mag": 4.9, "magtype": "mw", "depth": 47.0, "lat": -20.3021, "lon": -70.2407, "auth": "EMSC", "minutesAgo": 957},
  {"uid": "20261014_0000053", "region": "NORTH ATLANTIC OCEAN", "mag": 4.8, "magtype": "mb", "depth": 10.0, "lat": 4.9878, "lon": -27.6049, "auth": "EMSC", "minutesAgo": 961},
  {"uid": "20261014_0000044", "region": "PANAMA", "mag": 4.7, "magtype": "mb", "depth": 12.0, "lat": 7.7774, "lon": -80.4248, "auth": "EMSC", "minutesAgo": 961},
  {"uid": "20261014_0000072", "region": "NEW BRITAIN REGION, P.N.G.", "mag": 4.7, "magtype": "mb", "depth": 10.0, "lat": -5.5165, "lon": 152.3971, "auth": "EMSC", "minutesAgo": 962},
  {"uid": "20261014_0000036", "region": "NEW BRITAIN REGION, P.N.G.", "mag": 4.6, "magtype": "mb", "depth": 10.0, "lat": -4.4488, "lon": 152.9436, "auth": "NEIC", "minutesAgo": 980},
  {"uid": "20261014_0000006", "region": "OFFSHORE COQUIMBO, CHILE", "mag": 5.0, "magtype": "mb", "depth": 30.0, "lat": -29.2377, "lon": -71.7357, "auth": "EMSC", "minutesAgo": 1017},
  {"uid": "20261014_0000007", "region": "OFFSHORE COQUIMBO, CHILE", "mag": 5.1, "magtype": "mw", "depth": 20.4, "lat": -29.2467, "lon": -71.7873, "auth": "EMSC", "minutesAgo": 1019},
  {"uid": "20261013_0000445", "region": "ANTOFAGASTA, CHILE", "mag": 4.4, "magtype": "mb", "depth": 125.0, "lat": -21.8757, "lon": -68.7303, "auth": "EMSC", "minutesAgo": 1044},
  {"uid": "20261013_0000414", "region": "NORTHERN COLOMBIA", "mag": 4.8, "magtype": "mb", "depth": 160.0, "lat": 6.7709, "lon": -73.0284, "auth": "EMSC", "minutesAgo": 1091},
  {"uid": "20261013_0000368", "region": "NEW BRITAIN REGION, P.N.G.", "mag": 6.0, "magtype": "mw", "depth": 25.0, "lat": -5.4166, "lon": 152.0336, "auth": "EMSC", "minutesAgo": 1152},
  {"uid": "20261013_0000386", "region": "COLOMBIA", "mag": 4.4, "magtype": "mb", "depth": 10.0, "lat": 1.6816, "lon": -76.3106, "auth": "NEIC", "minutesAgo": 1155},
  {"uid": "20261013_0000404", "region": "PANAMA", "mag": 4.4, "magtype": "m", "depth": 26.0, "lat": 7.05, "lon": -81.3478, "auth": "IGC", "minutesAgo": 1163},
  {"uid": "20261013_0000340", "region": "PANAMA-COSTA RICA BORDER REGION", "mag": 4.7, "magtype": "m", "depth": 6.0, "lat": 9.0222, "lon": -82.2528, "auth": "IGC", "minutesAgo": 1192},
  {"uid": "20261013_0000326", "region": "NEW BRITAIN REGION, P.N.G.", "mag": 5.1, "magtype": "mb", "depth": 53.0, "lat": -5.4274, "lon": 152.1606, "auth": "EMSC", "minutesAgo": 1205},
  {"uid": "20261013_0000322", "region": "PANAMA", "mag": 4.4, "magtype": "m", "depth": 11.0, "lat": 7.4573, "lon": -80.1583, "auth": "IGC", "minutesAgo": 1206},
  {"uid": "20261013_0000347", "region": "MINDANAO, PHILIPPINES", "mag": 4.8, "magtype": "mb", "depth": 65.7, "lat": 5.3478, "lon": 125.5183, "auth": "NEIC", "minutesAgo": 1230},
  {"uid": "20261013_0000490", "region": "PANAMA", "mag": 4.5, "magtype": "m", "depth": 15.0, "lat": 7.533, "lon": -80.7278, "auth": "IGC", "minutesAgo": 1232},
];

export const DEMO_LIVE: DemoEvent[] = [
  {"uid": "20261015_0000166", "region": "FOX ISLANDS, ALEUTIAN ISLANDS", "mag": 4.8, "magtype": "mb", "depth": 10.0, "lat": 52.1723, "lon": -169.9011, "auth": "EMSC", "minutesAgo": 0},
  {"uid": "20261015_0000168", "region": "TONGA", "mag": 5.3, "magtype": "mb", "depth": 29.0, "lat": -15.2323, "lon": -173.2448, "auth": "EMSC", "minutesAgo": 0},
  {"uid": "20261015_0000192", "region": "PANAMA", "mag": 4.5, "magtype": "mb", "depth": 10.0, "lat": 7.4452, "lon": -80.0893, "auth": "NEIC", "minutesAgo": 0},
  {"uid": "20261015_0000204", "region": "OFF EAST COAST OF KAMCHATKA", "mag": 4.9, "magtype": "mb", "depth": 10.0, "lat": 51.52, "lon": 159.78, "auth": "GSRAS", "minutesAgo": 0},
  {"uid": "20261015_0000244", "region": "PANAMA", "mag": 4.7, "magtype": "mb", "depth": 10.0, "lat": 7.754, "lon": -81.155, "auth": "GFZ", "minutesAgo": 0},
  {"uid": "20261015_0000252", "region": "SOUTH OF FIJI ISLANDS", "mag": 4.4, "magtype": "mb", "depth": 522.8, "lat": -25.1841, "lon": -179.7319, "auth": "NEIC", "minutesAgo": 0},
  {"uid": "20261015_0000256", "region": "PANAMA", "mag": 4.4, "magtype": "m", "depth": 15.0, "lat": 7.6507, "lon": -80.9908, "auth": "IGC", "minutesAgo": 0},
  {"uid": "20261015_0000277", "region": "PANAMA", "mag": 4.7, "magtype": "m", "depth": 8.0, "lat": 7.6522, "lon": -81.4242, "auth": "IGC", "minutesAgo": 0},
  {"uid": "20261015_0000277", "region": "PANAMA", "mag": 4.9, "magtype": "m", "depth": 8.0, "lat": 7.6522, "lon": -81.4242, "auth": "IGC", "minutesAgo": 0, "action": "update"},
];

/** One event as the live feed sends it: `{ action, data: Feature }`, its time `minutesAgo` before `now`. */
export function demoMessage(e: DemoEvent, now: number): string {
  const time = new Date(now - e.minutesAgo * 60_000).toISOString();
  return JSON.stringify({
    action: e.action ?? "create",
    data: {
      type: "Feature",
      geometry: { type: "Point", coordinates: [e.lon, e.lat, -e.depth] },
      id: e.uid,
      properties: {
        source_id: e.uid.replace(/\D/g, "").slice(-7),
        source_catalog: "EMSC-RTS",
        lastupdate: new Date(now).toISOString(),
        time,
        flynn_region: e.region,
        lat: e.lat,
        lon: e.lon,
        depth: e.depth,
        evtype: "ke",
        auth: e.auth,
        mag: e.mag,
        magtype: e.magtype,
        unid: `demo-${e.uid}`,
      },
    },
  });
}
