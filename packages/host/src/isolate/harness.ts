// The in-VM harness (plain ES2020 for QuickJS). Concatenated after the app bundle, which must
// set `globalThis.__kartaApp` to the app definition. The host injects two bridges:
//   - `__host(opJson) -> resultJson`  : ASYNCIFIED (host-async ops). Always `await`ed here so
//                                       asyncify suspensions only ever happen at await points.
//   - `__hostSync(opJson) -> void`    : SYNCHRONOUS fire-and-forget (toast/log/nav). Not
//                                       asyncified, so it is safe inside promise continuations.
//
// The isolate has NO ambient authority: no fetch, DOM, or globals beyond QuickJS + these two
// bridges. `ctx` is the only way out.

import { MARSHAL_SOURCE } from "./marshal.js";

export const HARNESS_SOURCE = `${MARSHAL_SOURCE}
(function(){
  async function bridge(obj){ return __deserialize(await __host(__serialize(obj))); }
  function bridgeSync(obj){ __hostSync(__serialize(obj)); }

  function findView(app, pageId){
    var page = (app.pages||[]).find(function(p){ return p.id === pageId; });
    return page ? page.view : null;
  }

  // async so computed may be async (and call ctx.query). Sequential in declaration order so a
  // computed can read an earlier one.
  async function evalComputed(app, entity, row, ctx){
    var def = app.entities[entity];
    if (!def || !def.computed) return row;
    var keys = Object.keys(def.computed);
    for (var i=0;i<keys.length;i++){ row[keys[i]] = await def.computed[keys[i]](row, ctx); }
    return row;
  }

  function makeCtx(app, params, nowIso, capsAvailable, me, space, scope){
    var fixedNow = new Date(nowIso);
    var ctx = {
      params: params || {},
      // Always present, exactly as in a trusted app — so one app source behaves the same either way.
      me: me || { id: "local", name: "Me" },
      space: space,
      scope: scope || {},
      now: function(){ return new Date(nowIso); },
      today: function(){ return new Date(fixedNow.getFullYear(), fixedNow.getMonth(), fixedNow.getDate()); },
      log: function(){ var a=[].slice.call(arguments).map(String); bridgeSync({op:"log", args:a}); },
      query: async function(entity, spec){
        var rows = await bridge({op:"data.all", entity:entity});
        for (var i=0;i<rows.length;i++) await evalComputed(app, entity, rows[i], ctx);
        if (spec && spec.filter) rows = rows.filter(spec.filter);
        if (spec && spec.sort) rows = rows.slice().sort(spec.sort);
        var offset = (spec && spec.offset) || 0;
        var end = (spec && spec.limit != null) ? offset + spec.limit : undefined;
        return (offset || end != null) ? rows.slice(offset, end) : rows;
      },
      get: async function(entity, id){
        var row = await bridge({op:"data.get", entity:entity, id:id});
        return row ? await evalComputed(app, entity, row, ctx) : null;
      },
      create: async function(entity, data){
        var row = await bridge({op:"data.create", entity:entity, data:data});
        return await evalComputed(app, entity, row, ctx);
      },
      patch: async function(entity, id, data){
        var row = await bridge({op:"data.patch", entity:entity, id:id, data:data});
        return await evalComputed(app, entity, row, ctx);
      },
      increment: async function(entity, id, field, delta){
        var row = await bridge({op:"data.increment", entity:entity, id:id, field:field, delta:delta});
        return await evalComputed(app, entity, row, ctx);
      },
      delete: async function(entity, id){ await bridge({op:"data.delete", entity:entity, id:id}); },
      transaction: async function(fn){ return fn(ctx); },
      storage: {
        get: async function(k){ return bridge({op:"storage.get", key:k}); },
        set: async function(k,v){ await bridge({op:"storage.set", key:k, value:v}); },
        delete: async function(k){ await bridge({op:"storage.delete", key:k}); },
        keys: async function(prefix){ return bridge({op:"storage.keys", prefix:prefix||null}); }
      },
      media: {
        put: async function(){ throw new Error("ctx.media.put is not available to untrusted apps in v1"); },
        url: async function(ref){ return bridge({op:"media.url", ref:ref}); }
      },
      ui: {
        toast: function(m){ bridgeSync({op:"ui.toast", msg:String(m)}); },
        confirm: async function(m){ return bridge({op:"ui.confirm", msg:String(m)}); },
        prompt: async function(m,o){ return bridge({op:"ui.prompt", msg:String(m), opts:o||null}); },
        pick: async function(items,o){ return bridge({op:"ui.pick", items:items, opts:{multi: !!(o&&o.multi)}}); }
      },
      navigate: function(page, params){ bridgeSync({op:"nav", page:page, params:params||{}}); },
      caps: {}
    };
    var capNames = capsAvailable || [];
    function has(n){ return capNames.indexOf(n) >= 0; }
    if (has("camera")) ctx.caps.camera = { capture: async function(){ throw new Error("camera capture is not marshalable in isolate v1"); } };
    if (has("geo")) ctx.caps.geo = { current: async function(){ return bridge({op:"cap.geo.current"}); } };
    if (has("notifications")) ctx.caps.notifications = {
      supportsExactScheduling: false,
      schedule: async function(n){ await bridge({op:"cap.notifications.schedule", n:{id:n.id, at:(n.at instanceof Date ? n.at.toISOString() : n.at), title:n.title, body:n.body}}); },
      cancel: async function(id){ await bridge({op:"cap.notifications.cancel", id:id}); }
    };
    if (has("haptics")) ctx.caps.haptics = { vibrate: function(pattern){ bridgeSync({op:"cap.haptics.vibrate", pattern: pattern == null ? 30 : pattern}); } };
    if (has("network")) ctx.caps.network = { fetch: async function(){ throw new Error("network fetch is not marshalable in isolate v1"); } };
    if (has("filesystem")) ctx.caps.filesystem = {
      pick: async function(){ throw new Error("filesystem pick is not marshalable in isolate v1"); },
      save: async function(){ throw new Error("filesystem save is not marshalable in isolate v1"); }
    };
    return ctx;
  }

  function resolveBinding(app, p, record, ctx){
    if (p.refKind === "reminder"){
      var rem = (app.reminders||[]).find(function(r){ return r.id === p.id; });
      var b = rem ? rem[p.path] : null;
      return typeof b === "function" ? b(record, ctx) : (typeof b === "string" ? record[b] : null);
    }
    var view = findView(app, p.pageId);
    if (!view) return null;
    var b2;
    if (p.path.indexOf("display.") === 0){ var key = p.path.slice(8); b2 = view.display ? view.display[key] : null; }
    else b2 = view[p.path];
    return typeof b2 === "function" ? b2(record, ctx) : (typeof b2 === "string" ? record[b2] : null);
  }

  globalThis.__karta = {
    call: async function(payloadJson){
      var p = __deserialize(payloadJson);
      var app = globalThis.__kartaApp;
      if (!app) return __serialize({ ok:false, error:"no app loaded" });
      var ctx = makeCtx(app, p.params || {}, p.nowIso, p.capsAvailable || [], p.me, p.space, p.scope);
      var record = (p.record !== undefined && p.record !== null) ? p.record : null;
      try {
        var result = null;
        switch (p.kind){
          case "computed": result = await app.entities[p.entity].computed[p.key](record, ctx); break;
          case "action": await app.entities[p.entity].actions[p.key](record, ctx, p.input); result = null; break;
          case "filter": { var v = findView(app, p.pageId); result = (v && v.filter) ? !!(await v.filter(record, ctx)) : true; break; }
          case "sort": { var vs = findView(app, p.pageId); result = (vs && vs.sort) ? Number(vs.sort(p.a, p.b)) : 0; break; }
          case "viewOption": { var vo = findView(app, p.pageId); var opt = vo ? vo[p.key] : undefined; result = (opt === undefined) ? null : (typeof opt === "function" ? await opt(ctx) : opt); break; }
          case "binding": result = await resolveBinding(app, p, record, ctx); break;
          case "summary": {
            var pg = (app.pages||[]).find(function(x){ return x.id === p.pageId; });
            var spec = (pg && pg.summary) ? pg.summary[p.index] : null;
            if (!spec || typeof spec.value !== "function") throw new Error("summary " + p.pageId + "[" + p.index + "] has no value function");
            result = await spec.value(p.rows || [], ctx);
            break;
          }
          case "aggregate": {
            var av = findView(app, p.pageId);
            if (!av || av.type !== "aggregate" || typeof av.rows !== "function") throw new Error("page " + p.pageId + " is not an aggregate view");
            result = await av.rows(p.rows || [], ctx);
            break;
          }
          case "reminderWhen": { var rem = (app.reminders||[]).find(function(r){ return r.id === p.id; }); result = rem ? await rem.when(record, ctx) : null; break; }
          default: return __serialize({ ok:false, error:"unknown kind " + p.kind });
        }
        return __serialize({ ok:true, value: result });
      } catch(e){
        return __serialize({ ok:false, error: String((e && e.message) || e) });
      }
    }
  };
})();
`;
