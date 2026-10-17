// The in-VM harness (plain ES2020 for QuickJS). Concatenated after the app bundle, which must
// set `globalThis.__potyroApp` to the app definition. The host injects two functions:
//   - `__hostSync(opJson) -> void` : synchronous. Fire-and-forget ops (toast/log/nav) are handled
//                                    on the spot; a host CALL (a query, a patch, a question for
//                                    the person) is registered under an id and answered later
//                                    through `__potyro.settle`, which resolves the waiting promise.
//   - `__hostPure(reqJson) -> json` : synchronous and authority-free (#302): formatting only —
//                                    `ctx.format.*` and `ctx.t(words, vars)` — because the box has
//                                    no `Intl` and a formatter must answer inside a `filter`. It
//                                    reaches no store, cap or person; see `hostPure` in format.ts.
//                                    `ctx.locale` and `ctx.t(words)` without vars never leave the box.
//
// Why not an asyncified function that suspends the VM until the host is done (what this used to
// be): QuickJS's asyncify build allows one suspended call per WebAssembly module, and a suspended
// call cannot be resumed from a pending job. An action that awaited two host calls in a row
// corrupted the VM, and one waiting on a person while the page kept rendering crashed the tab
// (#112). With promises the VM is never suspended; every entry is short and synchronous.
//
// The isolate has NO ambient authority: no fetch, DOM, or globals beyond QuickJS + this bridge.
// `ctx` is the only way out.

import { MARSHAL_SOURCE } from "./marshal.js";

export const HARNESS_SOURCE = `${MARSHAL_SOURCE}
(function(){
  var calls = {}, callSeq = 0;
  // Live connections (docs/28), by the number the host gave each. Kept across calls: a connection
  // outlives the action that opened it.
  var socks = {};
  // Listenings (docs/29), by the number the host gave each.
  var speeches = {};
  function bridge(obj){
    return new Promise(function(resolve, reject){
      var id = "c" + (++callSeq);
      calls[id] = { resolve: resolve, reject: reject };
      __hostSync(__serialize({op:"host.call", id:id, req:obj}));
    });
  }
  function bridgeSync(obj){ __hostSync(__serialize(obj)); }
  // Plain JSON out and a marked string back (see hostPure): no replacer, no reviver — they cost.
  function pureArg(v){ return v instanceof Date ? { __kdate: v.toISOString() } : v; }
  function pure(req){
    req.value = pureArg(req.value);
    if (req.vars && typeof req.vars === "object") { var ks = Object.keys(req.vars), vs = {}; for (var i = 0; i < ks.length; i++) vs[ks[i]] = pureArg(req.vars[ks[i]]); req.vars = vs; }
    var out = __hostPure(JSON.stringify(req));
    if (out.charAt(0) === "+") return out.slice(1);
    throw new Error(out.slice(1));
  }
  // Words cross as they are — a string, or a map the host resolves in ctx.locale (#302).
  function words(w){ return (w !== null && typeof w === "object") ? w : String(w); }
  // The same choice as schema's word(): the language, the app's own, its languages, anything.
  function pick(w, wl){
    if (w === null || w === undefined) return "";
    if (typeof w === "string") return w;
    if (typeof w !== "object" || Array.isArray(w) || w instanceof Date) return String(w);
    if (wl.locale && typeof w[wl.locale] === "string") return w[wl.locale];
    if (wl.language && typeof w[wl.language] === "string") return w[wl.language];
    var ls = wl.languages || [];
    for (var i = 0; i < ls.length; i++) if (typeof w[ls[i]] === "string") return w[ls[i]];
    var ks = Object.keys(w);
    for (var j = 0; j < ks.length; j++) if (typeof w[ks[j]] === "string") return w[ks[j]];
    return "";
  }

  // Bytes cross the bridge as base64: it carries JSON, and QuickJS has neither Blob nor atob (#252).
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function toBase64(u8){
    var out = "", i = 0;
    for (; i + 2 < u8.length; i += 3) {
      var n = (u8[i] << 16) | (u8[i+1] << 8) | u8[i+2];
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    if (i < u8.length) {
      var m = u8[i] << 16 | (i + 1 < u8.length ? u8[i+1] << 8 : 0);
      out += B64[(m >> 18) & 63] + B64[(m >> 12) & 63] + (i + 1 < u8.length ? B64[(m >> 6) & 63] : "=") + "=";
    }
    return out;
  }
  function fromBase64(s){
    var clean = s.replace(/=+$/, ""), bytes = new Uint8Array(Math.floor(clean.length * 3 / 4)), j = 0, buf = 0, bits = 0;
    for (var i = 0; i < clean.length; i++) {
      buf = (buf << 6) | B64.indexOf(clean[i]); bits += 6;
      if (bits >= 8) { bits -= 8; bytes[j++] = (buf >> bits) & 255; }
    }
    return bytes;
  }
  function fileArg(f){ return typeof f === "string" ? f : (f && typeof f === "object" ? {id:f.id, path:f.path, name:f.name, mime:f.mime} : f); }

  // A page ref may name a layout item ("today#1", #105): the same rule as resolveView in the schema.
  function findView(app, pageRef){
    var at = String(pageRef).indexOf("#");
    var pageId = at < 0 ? pageRef : String(pageRef).slice(0, at);
    var page = (app.pages||[]).find(function(p){ return p.id === pageId; });
    if (!page) return null;
    if (at < 0) return page.view || (page.layout && page.layout.items && page.layout.items[0] ? page.layout.items[0].view : null);
    var item = page.layout && page.layout.items ? page.layout.items[Number(String(pageRef).slice(at + 1))] : null;
    return item ? item.view : null;
  }

  // async so computed may be async (and call ctx.query). Sequential in declaration order so a
  // computed can read an earlier one.
  // A computed is a function or { value, label } (#310): the function either way.
  function computedFn(c){ return typeof c === "function" ? c : c.value; }
  async function evalComputed(app, entity, row, ctx){
    var def = app.entities[entity];
    if (!def || !def.computed) return row;
    var keys = Object.keys(def.computed);
    for (var i=0;i<keys.length;i++){ row[keys[i]] = await computedFn(def.computed[keys[i]])(row, ctx); }
    return row;
  }

  var progressSeq = 0;
  var awakeSeq = 0;
  // A timer crosses as data; its three methods are rebuilt here, each one a host call by id.
  function timerOf(d){
    if (!d) return d;
    var ends = d.endsAt ? Date.parse(d.endsAt) : null;
    return Object.freeze({
      id: d.id, label: d.label, seconds: d.seconds, endsAt: d.endsAt ? new Date(d.endsAt) : null, left: d.left, paused: !!d.paused,
      secondsLeft: function(at){
        if (!ends) return d.left;
        var ms = ends - (at == null ? Date.now() : Number(at));
        return Math.max(0, Math.ceil(ms / 1000));
      },
      cancel: async function(){ await bridge({op:"ui.timer.control", id:d.id, verb:"cancel"}); },
      pause: async function(){ await bridge({op:"ui.timer.control", id:d.id, verb:"pause"}); },
      resume: async function(){ await bridge({op:"ui.timer.control", id:d.id, verb:"resume"}); }
    });
  }
  function makeCtx(app, params, nowIso, capsAvailable, me, space, scope, wl, people){
    var fixedNow = new Date(nowIso);
    wl = wl || {};
    var ctx = {
      params: params || {},
      locale: wl.locale || "en",
      t: function(w, vars){ return (vars === undefined || vars === null) ? pick(w, wl) : pure({op:"t", words:w, vars:vars}); },
      format: {
        locale: wl.formatLocale || wl.locale || "en",
        date: function(d, o){ return pure({op:"date", value:d, opts:o || null}); },
        number: function(n, o){ return pure({op:"number", value:n, opts:o || null}); },
        money: function(m, c){ return pure({op:"money", value:m, currency: c == null ? null : c}); },
        relative: function(d, o){ return pure({op:"relative", value:d, opts:o || null}); },
        list: function(items, o){ return pure({op:"list", value:items, opts:o || null}); }
      },
      // Always present, exactly as in a trusted app — so one app source behaves the same either way.
      me: me || { id: "local", name: "Me" },
      space: space,
      people: Object.freeze((people || []).slice()),
      guests: {
        add: function(name){ return bridge({op:"guests.add", name:String(name)}); },
        rename: async function(id, name){ await bridge({op:"guests.rename", id:String(id), name:String(name)}); },
        remove: async function(id){ await bridge({op:"guests.remove", id:String(id)}); }
      },
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
      // The app's own folder (#252): the same surface as a trusted app's, answered by the host.
      files: {
        list: function(folder){ return bridge({op:"files.list", folder: folder == null ? null : String(folder)}); },
        stat: function(f){ return bridge({op:"files.stat", file:fileArg(f)}); },
        text: function(f){ return bridge({op:"files.text", file:fileArg(f)}); },
        json: async function(f){
          var t = await bridge({op:"files.text", file:fileArg(f)});
          if (t == null) return null;
          try { return JSON.parse(t); }
          catch (e) { throw new Error('"' + (typeof f === "string" ? f : (f.path || f.name || f.id)) + '" is not valid JSON: ' + e.message); }
        },
        bytes: async function(f){
          var b = await bridge({op:"files.bytes", file:fileArg(f)});
          return b == null ? null : fromBase64(b);
        },
        url: function(f){ return bridge({op:"files.url", file:fileArg(f)}); },
        write: function(path, data, o){
          var enc = typeof data === "string" ? "text" : "base64";
          if (enc === "base64" && !(data instanceof Uint8Array)) throw new Error("ctx.files.write takes a string or a Uint8Array");
          return bridge({op:"files.write", path:String(path), enc:enc, data: enc === "text" ? data : toBase64(data), mime: (o && o.mime) || null});
        },
        rename: function(f, to){ return bridge({op:"files.rename", file:fileArg(f), to:String(to)}); },
        remove: async function(f){ await bridge({op:"files.remove", file:fileArg(f)}); },
        import: function(o){ return bridge({op:"files.import", opts: o ? {folder:o.folder || null, accept:o.accept || null, multiple: !!o.multiple} : null}); },
        export: async function(f){ await bridge({op:"files.export", file:fileArg(f)}); }
      },
      ui: {
        toast: function(m){ bridgeSync({op:"ui.toast", msg:words(m)}); },
        confirm: function(m,o){ return bridge({op:"ui.confirm", msg:words(m), opts:o||null}); },
        prompt: function(m,o){ return bridge({op:"ui.prompt", msg:words(m), opts:o||null}); },
        pick: function(items,o){ return bridge({op:"ui.pick", items:items, opts:{multi: !!(o&&o.multi)}}); },
        sheet: function(o){ return bridge({op:"ui.sheet", opts:o}); },
        menu: function(o){ return bridge({op:"ui.menu", opts:o}); },
        form: function(o){ return bridge({op:"ui.form", opts:o}); },
        share: function(o){
          // Files cross as data: bytes as base64, a reference by its fields (there is no Blob here).
          if (o && Array.isArray(o.files)) o = Object.assign({}, o, { files: o.files.map(function(f){
            if (f instanceof Uint8Array) return { __bytes: toBase64(f) };
            if (f && typeof f === "object") return f.key !== undefined ? { key: f.key, mime: f.mime } : { id: f.id, path: f.path, name: f.name, mime: f.mime };
            return f;
          }) });
          return bridge({op:"ui.share", opts:o});
        },
        keepAwake: function(){
          var id = "w" + (++awakeSeq);
          bridgeSync({op:"ui.keepAwake", id:id, hold:true});
          return { release: function(){ bridgeSync({op:"ui.keepAwake", id:id, hold:false}); } };
        },
        timer: async function(o){ return timerOf(await bridge({op:"ui.timer", opts: o ? {label:o.label, seconds:o.seconds, id: o.id == null ? null : o.id} : null})); },
        timers: async function(){ var list = await bridge({op:"ui.timers"}); return (list || []).map(timerOf); },
        drawsTimer: function(tid){
          var id = "d" + (++awakeSeq);
          bridgeSync({op:"ui.drawsTimer", id:id, hold:true, timer: String(tid)});
          var done = false;
          return { release: function(){ if (done) return; done = true; bridgeSync({op:"ui.drawsTimer", id:id, hold:false}); } };
        },
        progress: function(label){
          var id = "p" + (++progressSeq);
          bridgeSync({op:"ui.progress", id:id, label:words(label)});
          return {
            update: function(f, d){ bridgeSync({op:"ui.progress", id:id, fraction:Number(f), detail: d == null ? null : String(d)}); },
            done: function(){ bridgeSync({op:"ui.progress", id:id, done:true}); }
          };
        }
      },
      views: {
        map: function(page){
          return {
            flyTo: function(to){ return bridge({op:"views.call", page:String(page), verb:"map.flyTo", arg:to}); },
            fit: function(){ return bridge({op:"views.call", page:String(page), verb:"map.fit", arg:null}); }
          };
        }
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
    // AI (docs/23): plain data out, the validated answer back. Bytes cross as base64; there is no Blob here.
    function aiImg(img){
      if (img instanceof Uint8Array) return { __bytes: toBase64(img) };
      if (typeof img === "string") return img;
      if (img && typeof img === "object") return img.key !== undefined ? { key: img.key, mime: img.mime } : { id: img.id, path: img.path, name: img.name, mime: img.mime };
      throw new Error("ctx.caps.ai: an image is bytes, a file or a photo field's value in a shared app");
    }
    function aiImgs(img){ return img == null ? null : (Array.isArray(img) ? img.map(aiImg) : aiImg(img)); }
    if (has("ai")) ctx.caps.ai = {
      extract: async function(req){
        req = req || {};
        return bridge({op:"cap.ai.extract", req:{ schema: req.schema, instructions: req.instructions == null ? null : req.instructions, text: req.text == null ? null : req.text, image: aiImgs(req.image) }});
      },
      ask: async function(prompt, o){
        return bridge({op:"cap.ai.ask", prompt: String(prompt), opts: o ? { instructions: o.instructions == null ? null : o.instructions, image: aiImgs(o.image) } : null});
      }
    };
    if (has("network")) ctx.caps.network = {
      fetch: async function(){ throw new Error("network fetch is not marshalable in isolate v1"); },
      socket: async function(url, o){
        var p = o && o.protocols;
        var k = o && o.keepWhileHidden;
        var info = await bridge({op:"cap.socket.open", url:String(url), opts: (p == null && k == null) ? null : { protocols: p == null ? null : (Array.isArray(p) ? p.map(String) : [String(p)]), keepWhileHidden: k == null ? null : String(k) }});
        return makeSock(info);
      },
      room: async function(id, o){
        var n = o && o.name, k = o && o.keepWhileHidden;
        var info = await bridge({op:"cap.socket.room", id: id == null ? null : String(id), opts: (n == null && k == null) ? null : { name: n == null ? null : String(n), keepWhileHidden: k == null ? null : String(k) }});
        return makeSock(info);
      }
    };
    if (has("speech")) ctx.caps.speech = {
      listen: async function(o){
        var info = await bridge({op:"cap.speech.listen", opts: o ? { language: o.language == null ? null : String(o.language), interim: o.interim == null ? null : o.interim !== false } : null});
        return makeSpeech(info);
      }
    };
    if (has("filesystem")) ctx.caps.filesystem = {
      pick: async function(){ throw new Error("filesystem pick is not marshalable in isolate v1"); },
      save: async function(){ throw new Error("filesystem save is not marshalable in isolate v1"); }
    };
    return ctx;
  }

  function sockErr(m, code){ var e = new Error(m); e.code = code; return e; }
  function sizeOf(d){ return typeof d === "string" ? d.length : d.byteLength; }
  function each(list, arg, where){
    for (var i = 0; i < list.length; i++) { try { list[i](arg); } catch (e) { bridgeSync({op:"log", args:[where + " threw: " + String((e && e.message) || e)]}); } }
  }
  // A connection as the app holds it: the host has the real one (socket-bridge.ts).
  function makeSock(info){
    var sid = info.sid, msgCbs = [], closeCbs = [], presCbs = [], held = [], closedWith = null;
    var s = { url: info.url, protocol: info.protocol || "", readyState: "open" };
    s.send = function(d){
      if (typeof d !== "string" && !(d instanceof Uint8Array)) return Promise.reject(new TypeError("send takes a string or a Uint8Array"));
      if (s.readyState !== "open") return Promise.reject(sockErr("The connection is not open", "closed"));
      return bridge({op:"cap.socket.send", sid:sid, data: typeof d === "string" ? {t:d} : {b: toBase64(d)}}).then(function(){});
    };
    s.onMessage = function(cb){
      if (typeof cb !== "function") throw new TypeError("onMessage takes a function");
      if (closedWith) return function(){};
      msgCbs.push(cb);
      if (held.length) {
        var h = held; held = [];
        Promise.resolve().then(function(){
          var bytes = 0;
          for (var i = 0; i < h.length; i++) { bytes += sizeOf(h[i]); try { cb(h[i]); } catch (e) { bridgeSync({op:"log", args:["a socket's onMessage threw: " + String((e && e.message) || e)]}); } }
          bridgeSync({op:"cap.socket.ack", sid:sid, n:h.length, bytes:bytes});
        });
      }
      return function(){ msgCbs = msgCbs.filter(function(x){ return x !== cb; }); };
    };
    s.onClose = function(cb){
      if (typeof cb !== "function") throw new TypeError("onClose takes a function");
      if (closedWith) { var c = closedWith; Promise.resolve().then(function(){ cb(c); }); return function(){}; }
      closeCbs.push(cb);
      return function(){ closeCbs = closeCbs.filter(function(x){ return x !== cb; }); };
    };
    s.close = function(code, reason){
      if (s.readyState !== "open") return;
      s.readyState = "closing";
      bridgeSync({op:"cap.socket.close", sid:sid, code: code == null ? null : Number(code), reason: reason == null ? null : String(reason)});
    };
    if (info.room) {
      s.id = info.room.id;
      s.me = info.room.me;
      s.members = info.room.members || [];
      s.onPresence = function(cb){
        if (typeof cb !== "function") throw new TypeError("onPresence takes a function");
        if (closedWith) return function(){};
        presCbs.push(cb);
        return function(){ presCbs = presCbs.filter(function(x){ return x !== cb; }); };
      };
    }
    // One event from the host. "1": taken (or needs no ack); "0": held until the app listens.
    s._event = function(ev){
      if (ev.kind === "message") {
        var d = typeof ev.t === "string" ? ev.t : fromBase64(ev.b || "");
        if (!msgCbs.length) { held.push(d); return "0"; }
        each(msgCbs.slice(), d, "a socket's onMessage");
        return "1";
      }
      if (ev.kind === "presence") {
        var m = { id: String(ev.member && ev.member.id || ""), name: String(ev.member && ev.member.name || "") };
        s.members = ev.type === "join" ? s.members.filter(function(x){ return x.id !== m.id; }).concat([m]) : s.members.filter(function(x){ return x.id !== m.id; });
        each(presCbs.slice(), { type: ev.type, member: m }, "a room's onPresence");
        return "1";
      }
      if (closedWith) return "1";
      closedWith = { code: Number(ev.code), reason: String(ev.reason || ""), why: ev.why };
      s.readyState = "closed";
      delete socks[sid];
      held = [];
      var cbs = closeCbs; closeCbs = []; msgCbs = []; presCbs = [];
      each(cbs, closedWith, "a socket's onClose");
      return "1";
    };
    socks[sid] = s;
    return s;
  }

  // A listening as the app holds it: the host has the microphone (speech-bridge.ts).
  function makeSpeech(info){
    var lid = info.lid, cbs = [], text = "", fin = true, settle = null;
    var s = { language: String(info.language), engine: info.engine, listening: true };
    s.result = new Promise(function(resolve, reject){ settle = { resolve: resolve, reject: reject }; });
    s.result.catch(function(){});
    function give(t, f){
      if (t === text && f === fin) return;
      text = t; fin = f;
      tell(cbs.slice(), t, f);
    }
    function tell(list, t, f){
      for (var i = 0; i < list.length; i++) { try { list[i](t, f); } catch (e) { bridgeSync({op:"log", args:["a speech onText threw: " + String((e && e.message) || e)]}); } }
    }
    s.onText = function(cb){
      if (typeof cb !== "function") throw new TypeError("onText takes a function");
      if (!s.listening) return function(){};
      cbs.push(cb);
      if (text) { var t0 = text, f0 = fin; Promise.resolve().then(function(){ if (cbs.indexOf(cb) >= 0) cb(t0, f0); }); }
      return function(){ cbs = cbs.filter(function(x){ return x !== cb; }); };
    };
    s.stop = function(){ if (s.listening) bridgeSync({op:"cap.speech.stop", lid: lid}); };
    s._event = function(ev){
      if (!s.listening) return;
      if (ev.kind === "text") return give(String(ev.text), ev.final === true);
      if (ev.text && !ev.code) give(String(ev.text), true);
      s.listening = false;
      delete speeches[lid];
      cbs = [];
      if (ev.code) { var err = new Error(String(ev.message || ev.code)); err.code = String(ev.code); settle.reject(err); }
      else settle.resolve(text);
    };
    speeches[lid] = s;
    return s;
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

  globalThis.__potyro = {
    settle: function(id, ok, json){
      var c = calls[id];
      delete calls[id];
      if (!c) return;
      if (ok) return c.resolve(__deserialize(json));
      // An error with a code (a socket's "denied") arrives as {"__err", "code"}; anything else is the message.
      if (json.indexOf('{"__err":') === 0) { try { var pe = JSON.parse(json); var err = new Error(pe.__err); err.code = pe.code; return c.reject(err); } catch (x) {} }
      c.reject(new Error(json));
    },
    speech: function(json){
      var ev = JSON.parse(json);
      var s = speeches[ev.lid];
      if (s) s._event(ev);
      return "1";
    },
    sock: function(json){
      var ev = JSON.parse(json);
      var s = socks[ev.sid];
      return s ? s._event(ev) : "1";
    },
    call: async function(payloadJson){
      var p = __deserialize(payloadJson);
      var app = globalThis.__potyroApp;
      if (!app) return __serialize({ ok:false, error:"no app loaded" });
      var ctx = makeCtx(app, p.params || {}, p.nowIso, p.capsAvailable || [], p.me, p.space, p.scope, p.words, p.people);
      var record = (p.record !== undefined && p.record !== null) ? p.record : null;
      try {
        var result = null;
        switch (p.kind){
          case "computed": result = await computedFn(app.entities[p.entity].computed[p.key])(record, ctx); break;
          case "action": { var act = app.entities[p.entity].actions[p.key]; await (typeof act === "function" ? act : act.run)(record, ctx, p.input); result = null; break; }
          case "filter": { var v = findView(app, p.pageId); result = (v && v.filter) ? !!(await v.filter(record, ctx)) : true; break; }
          case "sort": { var vs = findView(app, p.pageId); result = (vs && vs.sort) ? Number(vs.sort(p.a, p.b, ctx)) : 0; break; }
          case "viewOption": { var vo = findView(app, p.pageId); var opt = vo ? vo[p.key] : undefined; result = (opt === undefined) ? null : (typeof opt === "function" ? await opt(ctx) : opt); break; }
          case "pageOption": { var pg = (app.pages || []).find(function(x){ return x.id === p.pageId; }); var po = pg ? pg[p.key] : undefined; result = (po === undefined) ? null : (typeof po === "function" ? await po(ctx) : po); break; }
          case "binding": result = await resolveBinding(app, p, record, ctx); break;
          case "summary": {
            var pg = (app.pages||[]).find(function(x){ return x.id === p.pageId; });
            var spec = (pg && pg.summary) ? pg.summary[p.index] : null;
            if (!spec || typeof spec.value !== "function") throw new Error("summary " + p.pageId + "[" + p.index + "] has no value function");
            result = await spec.value(p.rows || [], ctx);
            break;
          }
          case "pageAction": {
            var apg = (app.pages||[]).find(function(x){ return x.id === p.pageId; });
            var pact = (apg && apg.actions) ? apg.actions[p.index] : null;
            if (!pact || typeof pact.run !== "function") throw new Error("page action " + p.pageId + "[" + p.index + "] has no run function");
            await pact.run(ctx);
            result = null;
            break;
          }
          case "aggregate": {
            var av = findView(app, p.pageId);
            if (!av || av.type !== "aggregate" || typeof av.rows !== "function") throw new Error("page " + p.pageId + " is not an aggregate view");
            result = await av.rows(p.rows || [], ctx);
            break;
          }
          case "fold": {
            var fp = String(p.path), fv;
            if (fp.indexOf("page.") === 0) {
              var fpid = String(p.pageId).split("#")[0];
              fv = (app.pages||[]).find(function(pg){ return pg.id === fpid; }) || null;
              fp = fp.slice(5);
            } else fv = findView(app, p.pageId);
            if (!/^[A-Za-z_$][\\w$]*(\\.(\\d+|[A-Za-z_$][\\w$]*))*$/.test(fp)) fv = null;
            var fk = fp.split(".");
            for (var fi = 0; fv != null && fi < fk.length; fi++) fv = (typeof fv === "object" && Object.prototype.hasOwnProperty.call(fv, fk[fi])) ? fv[fk[fi]] : null;
            if (typeof fv !== "function") throw new Error(p.pageId + " has no function at " + fp);
            result = await fv(p.rows || [], ctx);
            break;
          }
          case "fieldDefault": {
            var ent = app.entities[p.entity], fd = ent && ent.fields ? ent.fields[p.key] : null;
            if (!fd) throw new Error("no field " + p.entity + "." + p.key);
            result = typeof fd.default === "function" ? await fd.default(ctx) : (fd.default === undefined ? null : fd.default);
            break;
          }
          case "tile": result = typeof app.tile === "function" ? await app.tile(ctx) : null; break;
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
