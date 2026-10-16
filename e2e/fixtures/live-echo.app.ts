// The live-connection fixture (docs/28): an echo connection and a room, each opened by a page action
// and written down as records from inside its callbacks. The spec fills in the ports and the room id.
import { defineApp, type Ctx, type Room, type Socket } from "potyro";

const ECHO = "ws://127.0.0.1:__ECHO_PORT__/echo";
const UNDECLARED = "ws://127.0.0.1:__OTHER_PORT__/not-declared";
const ROOM = "__ROOM_ID__";
/** A device on the person's home network: they type its address (docs/28 §6). */
const HOME = "ws://local:__ECHO_PORT__/home";
/** A server that takes seconds to answer: longer than a sealed call's whole budget. */
const SLOW = "ws://127.0.0.1:__SLOW_PORT__/slow";

let sock: Socket | null = null;
let room: Room | null = null;
const kept: Socket[] = [];

const note = (ctx: Ctx, text: string) => ctx.create("line", { text });
const codeOf = (e: unknown) => String((e as { code?: string }).code ?? (e as Error).message);

function join(name: string) {
  return async (ctx: Ctx) => {
    try {
      room = await ctx.caps.network!.room(ROOM, { name });
    } catch (e) {
      await note(ctx, `room refused ${codeOf(e)}`);
      return;
    }
    const r = room;
    r.onMessage((d) => void note(ctx, `peer ${typeof d === "string" ? d : "bytes"}`));
    r.onPresence((e) => void note(ctx, `${e.type} ${e.member.name}`));
    r.onClose((c) => void note(ctx, `room closed ${c.why}`));
    await note(ctx, `me ${r.me.name} with ${r.members.map((m) => m.name).join(",") || "nobody"}`);
  };
}

export default defineApp({
  id: "live-echo",
  name: "Live Echo",
  version: "1.0.0",
  schemaVersion: 1,
  permissions: { network: { hosts: ["127.0.0.1:__ECHO_PORT__", "127.0.0.1:__SLOW_PORT__", "local"], rooms: true } },
  entities: {
    line: { fields: { text: { type: "text", required: true } } },
  },
  pages: [
    {
      id: "lines",
      title: "Lines",
      view: { type: "list", entity: "line", display: { primary: "text" } },
      actions: [
        {
          label: "Connect",
          run: async (ctx) => {
            try {
              sock = await ctx.caps.network!.socket(ECHO);
            } catch (e) {
              await note(ctx, `refused ${codeOf(e)}`);
              return;
            }
            sock.onMessage((d) => void note(ctx, typeof d === "string" ? `echo ${d}` : `bytes ${Array.from(d).join(",")}`));
            sock.onClose((c) => void note(ctx, `closed ${c.why} ${c.code}`));
            await sock.send("hello");
            await sock.send(new Uint8Array([7, 8, 9]));
          },
        },
        { label: "Hang up", run: async () => sock?.close() },
        {
          label: "Try another host",
          run: async (ctx) => {
            try {
              await ctx.caps.network!.socket(UNDECLARED);
              await note(ctx, "connected to another host");
            } catch (e) {
              await note(ctx, `refused ${codeOf(e)}`);
            }
          },
        },
        {
          label: "Home device",
          run: async (ctx) => {
            let home: Socket;
            try {
              home = await ctx.caps.network!.socket(HOME);
            } catch (e) {
              await note(ctx, `home refused ${codeOf(e)}`);
              return;
            }
            home.onMessage((d) => void note(ctx, `home echo ${typeof d === "string" ? d : "bytes"}`));
            home.onClose((c) => void note(ctx, `home closed ${c.why}`));
            await note(ctx, `home open ${home.url}`);
            await home.send("lights on");
          },
        },
        {
          label: "Slow server",
          run: async (ctx) => {
            try {
              const s = await ctx.caps.network!.socket(SLOW);
              await note(ctx, `slow ${s.readyState}`);
              s.close();
            } catch (e) {
              await note(ctx, `slow refused ${codeOf(e)}`);
            }
          },
        },
        {
          label: "Keep two",
          run: async (ctx) => {
            for (const [name, keepWhileHidden] of [["brief", "1s"], ["chat", "5m"]] as const) {
              const s = await ctx.caps.network!.socket(`${ECHO}?${name}`, { keepWhileHidden });
              s.onClose((c) => void note(ctx, `${name} closed ${c.why}`));
              kept.push(s);
            }
            await note(ctx, "kept two");
          },
        },
        { label: "Join as Ana", run: join("Ana") },
        { label: "Join as Bo", run: join("Bo") },
        {
          label: "Wave",
          run: async () => {
            if (room) await room.send(`wave from ${room.me.name}`);
          },
        },
      ],
    },
  ],
});
