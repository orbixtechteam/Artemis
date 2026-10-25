// Minimal MCP (Model Context Protocol) client: stdio and Streamable HTTP transports. Tools only.
const { spawn } = require("child_process");
const crypto = require("crypto");
const os = require("os");
const path = require("path");

const PROTOCOL = "2025-03-26";
const slug = (s) =>
  String(s || "server")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24) || "server";
const abortErr = () =>
  Object.assign(new Error("Aborted"), { name: "AbortError" });

/** GUI apps on macOS start with a tiny PATH; add the usual tool locations (npx, uvx, brew, nvm...). */
function richPath(envPath) {
  const extra = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    path.join(os.homedir(), ".local/bin"),
    path.join(os.homedir(), ".cargo/bin"),
    "/usr/bin",
    "/bin",
  ];
  return [
    ...new Set([
      ...(envPath || "").split(path.delimiter).filter(Boolean),
      ...extra,
    ]),
  ].join(path.delimiter);
}

class Rpc {
  constructor() {
    this.id = 0;
    this.pending = new Map();
  }
  /** send(msg, signal): the signal aborts on caller abort or timeout; then notifications/cancelled is sent. */
  request(send, method, params, { signal, timeout = 30000 } = {}) {
    const id = ++this.id;
    const ac = new AbortController();
    return new Promise((resolve, reject) => {
      let sent = false;
      const cancel = (reason) => {
        if (!sent || method === "initialize") return;
        Promise.resolve()
          .then(() => send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason } }))
          .catch(() => {});
      };
      const t = setTimeout(() => {
        done(reject, new Error(`MCP request "${method}" timed out`));
        ac.abort(Object.assign(new Error("Timed out"), { name: "TimeoutError" }));
        cancel("timeout");
      }, timeout);
      const done = (fn, v) => {
        clearTimeout(t);
        this.pending.delete(id);
        signal?.removeEventListener("abort", onAbort);
        fn(v);
      };
      const onAbort = () => {
        done(reject, abortErr());
        ac.abort(abortErr());
        cancel("aborted by the user");
      };
      if (signal?.aborted) return done(reject, abortErr());
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: (v) => done(resolve, v),
        reject: (e) => done(reject, e),
      });
      sent = true;
      Promise.resolve()
        .then(() => send({ jsonrpc: "2.0", id, method, params }, ac.signal))
        .catch((e) => {
          if (this.pending.has(id)) done(reject, e);
        });
    });
  }
  handle(msg) {
    if (msg && msg.id !== undefined && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.error) p.reject(new Error(msg.error.message || "MCP error"));
      else p.resolve(msg.result);
      return true;
    }
    return false;
  }
  failAll(err) {
    for (const p of [...this.pending.values()]) p.reject(err);
  }
}

/** Ends a stdio server and everything it started (npx/uvx wrappers spawn children): SIGTERM the group, SIGKILL after 3 s. */
function killTree(child) {
  const alive = () => child.exitCode === null && child.signalCode === null;
  const sig = (s) => {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, s);
      else child.kill(s);
    } catch {
      try { child.kill(s); } catch {}
    }
  };
  if (!alive()) return;
  sig("SIGTERM");
  const t = setTimeout(() => { if (alive()) sig("SIGKILL"); }, 3000);
  if (t.unref) t.unref();
}

function stdioTransport(cfg, onMessage, onClose) {
  const env = { ...process.env, ...(cfg.env || {}) };
  env.PATH = richPath(env.PATH);
  const win = process.platform === "win32";
  const child = spawn(cfg.command, cfg.args || [], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: win,
    windowsHide: true,
    detached: !win, // own process group, so close() can end the whole tree
  });
  let buf = "",
    stderr = "",
    closed = false;
  // setEncoding keeps multibyte UTF-8 characters intact across chunk boundaries
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {}
    }
  });
  child.stderr.on("data", (d) => {
    stderr = (stderr + d).slice(-2000);
  });
  child.stdin.on("error", () => {}); // EPIPE after the server died: reported through "close"
  const end = (err) => {
    if (closed) return;
    closed = true;
    onClose(err);
  };
  child.on("error", (e) =>
    end(
      e.code === "ENOENT"
        ? new Error(
            `Command not found: ${cfg.command}. Install it or use its full path.`,
          )
        : e,
    ),
  );
  child.on("close", (code) =>
    end(
      new Error(
        `Server exited (code ${code}).${stderr ? " " + stderr.trim().split("\n").slice(-2).join(" ") : ""}`,
      ),
    ),
  );
  return {
    send: (msg) =>
      new Promise((resolve, reject) => {
        if (closed || child.stdin.destroyed || !child.stdin.writable)
          return reject(new Error("The connector process is not running."));
        child.stdin.write(JSON.stringify(msg) + "\n", (e) =>
          e ? reject(e) : resolve(),
        );
      }),
    close: () => {
      closed = true;
      try {
        child.stdin.end();
      } catch {}
      killTree(child);
    },
  };
}

/** Exchanges a refresh token for new tokens. -> { accessToken, refreshToken, expiresAt } */
async function refreshOAuth(cfg) {
  const o = cfg.oauth || {};
  if (!o.refreshToken || !cfg.tokenUrl) throw new Error("No refresh token: sign in again.");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: o.refreshToken,
    ...(cfg.clientId ? { client_id: cfg.clientId } : {}),
    ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
  });
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token)
    throw new Error(`Token refresh failed: ${j.error_description || j.error || "HTTP " + res.status}. Sign in again.`);
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token || o.refreshToken,
    expiresAt: j.expires_in ? Date.now() + Number(j.expires_in) * 1000 : 0,
  };
}

/** hooks: { reinit(): re-run the handshake after the server dropped the session, onTokens(oauth) } */
function httpTransport(cfg, onMessage, hooks = {}) {
  let sessionId = null,
    protocol = PROTOCOL,
    refreshing = null,
    reiniting = null;
  const headers = () => ({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": protocol,
    ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    ...(cfg.headers || {}),
    ...(cfg.oauth?.accessToken
      ? { authorization: `Bearer ${cfg.oauth.accessToken}` }
      : {}),
  });
  const canRefresh = () => !!(cfg.oauth?.refreshToken && cfg.tokenUrl);
  const refresh = () => {
    if (!refreshing)
      refreshing = refreshOAuth(cfg)
        .then((o) => {
          cfg.oauth = { ...(cfg.oauth || {}), ...o };
          try { hooks.onTokens?.(cfg.oauth); } catch {}
        })
        .finally(() => { refreshing = null; });
    return refreshing;
  };
  async function readSse(res) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (data) {
          try {
            onMessage(JSON.parse(data));
          } catch {}
        }
      }
    }
  }
  async function send(msg, signal, retried = {}) {
    // refresh a minute before the access token expires
    if (canRefresh() && cfg.oauth.expiresAt && cfg.oauth.expiresAt - 60000 < Date.now() && !retried.auth)
      await refresh().catch(() => {}); // a failed refresh still tries the old token; a 401 reports it
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(msg),
      signal: signal || AbortSignal.timeout(30000),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) sessionId = sid;
    if (res.status === 202 || res.status === 204) return;
    if (res.status === 401 && canRefresh() && !retried.auth) {
      await res.text().catch(() => "");
      await refresh();
      return send(msg, signal, { ...retried, auth: true });
    }
    // the server forgot our session: start a new one, then retry once
    if (res.status === 404 && sessionId && msg.method !== "initialize" && hooks.reinit && !retried.session) {
      await res.text().catch(() => "");
      sessionId = null;
      if (!reiniting) reiniting = Promise.resolve().then(hooks.reinit).finally(() => { reiniting = null; });
      await reiniting;
      return send(msg, signal, { ...retried, session: true });
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${t ? ": " + t.slice(0, 200) : ""}`);
    }
    const type = res.headers.get("content-type") || "";
    if (type.includes("text/event-stream")) await readSse(res);
    else {
      const text = await res.text();
      if (text.trim()) {
        const j = JSON.parse(text);
        (Array.isArray(j) ? j : [j]).forEach(onMessage);
      }
    }
  }
  return {
    setProtocol: (v) => {
      protocol = v || protocol;
    },
    send: (msg, signal) => send(msg, signal),
    close: () => {
      if (sessionId)
        fetch(cfg.url, { method: "DELETE", headers: headers(), signal: AbortSignal.timeout(5000) }).catch(
          () => {},
        );
    },
  };
}

const RECONNECT_MAX = 5;

class McpServer {
  /** hooks: { onTools(), onTokens(id, oauth) } */
  constructor(cfg, hooks = {}) {
    this.cfg = cfg;
    this.hooks = hooks;
    this.slug = slug(cfg.name);
    this.state = "idle";
    this.error = "";
    this.tools = [];
    this.rpc = new Rpc();
    this.transport = null;
    this.dropped = false; // was connected, then the stdio process exited
    this.reconnects = 0;
    this.connecting = null;
  }
  /** Tools stay offered while a dropped stdio server can still be restarted on the next call. */
  live() {
    return this.state === "connected" || (this.dropped && this.reconnects < RECONNECT_MAX);
  }
  async handshake() {
    const send = (m, sig) => this.transport.send(m, sig);
    const init = await this.rpc.request(
      send,
      "initialize",
      {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "zero", version: "1.0.0" },
      },
      { timeout: 60000 },
    );
    this.transport.setProtocol?.(init?.protocolVersion);
    this.serverInfo = init?.serverInfo || {};
    await send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }
  async connect() {
    this.state = "connecting";
    this.error = "";
    try {
      const onMessage = (msg) => {
        if (this.rpc.handle(msg)) return;
        if (msg.method === "ping" && msg.id !== undefined)
          this.transport
            ?.send({ jsonrpc: "2.0", id: msg.id, result: {} })
            .catch(() => {});
        else if (msg.method === "notifications/tools/list_changed")
          this.refresh().catch(() => {});
        else if (msg.id !== undefined && msg.method)
          this.transport
            ?.send({
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: -32601, message: "Not supported" },
            })
            .catch(() => {});
      };
      if (this.cfg.type === "http")
        this.transport = httpTransport(this.cfg, onMessage, {
          reinit: () => this.handshake(),
          onTokens: (o) => this.hooks.onTokens?.(this.cfg.id, o),
        });
      else {
        if (!this.cfg.command) throw new Error("Command is required");
        const tr = stdioTransport(this.cfg, onMessage, (err) => {
          if (this.transport !== tr) return; // an old process of this server
          const was = this.state === "connected";
          if (this.state !== "closed") {
            this.state = "error";
            this.error = this.error || err.message;
            if (was) {
              this.dropped = true;
              this.error = `${err.message} It restarts on the next use.`;
            }
          }
          this.transport = null;
          this.rpc.failAll(err);
        });
        this.transport = tr;
      }
      await this.handshake();
      await this.refresh();
      this.state = "connected";
      this.dropped = false;
      this.reconnects = 0;
    } catch (e) {
      this.state = "error";
      this.error = this.error || e.message;
      this.close(true);
    }
  }
  /** Restarts a dropped stdio server, waiting longer after each failed try. */
  async ensureConnected(signal) {
    if (this.state === "connected" && this.transport) return;
    if (!this.dropped) throw new Error(`Connector "${this.cfg.name}" is not connected${this.error ? ": " + this.error : "."}`);
    if (this.reconnects >= RECONNECT_MAX)
      throw new Error(`Connector "${this.cfg.name}" stopped after ${RECONNECT_MAX} restarts. Reconnect it in Settings → Connectors.`);
    if (!this.connecting) {
      const wait = this.reconnects ? Math.min(8000, 500 * 2 ** (this.reconnects - 1)) : 0;
      this.reconnects++;
      this.connecting = (async () => {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        const lastError = this.error;
        await this.connect();
        if (this.state !== "connected") {
          this.dropped = true;
          throw new Error(`Connector "${this.cfg.name}" could not restart: ${this.error || lastError}`);
        }
      })().finally(() => { this.connecting = null; });
    }
    const p = this.connecting;
    if (signal) {
      if (signal.aborted) throw abortErr();
      await new Promise((resolve, reject) => {
        const onAbort = () => reject(abortErr());
        signal.addEventListener("abort", onAbort, { once: true });
        p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
      });
    } else await p;
  }
  async refresh() {
    const tools = [];
    let cursor;
    do {
      const r = await this.rpc.request(
        (m, sig) => this.transport.send(m, sig),
        "tools/list",
        cursor ? { cursor } : {},
        { timeout: 30000 },
      );
      tools.push(...(r?.tools || []));
      cursor = r?.nextCursor;
    } while (cursor && tools.length < 500);
    this.tools = tools;
    try { this.hooks.onTools?.(); } catch {}
  }
  async call(name, args, signal) {
    await this.ensureConnected(signal);
    const tr = this.transport;
    const r = await this.rpc.request(
      (m, sig) => (tr ? tr.send(m, sig) : Promise.reject(new Error("The connector is not running."))),
      "tools/call",
      { name, arguments: args || {} },
      { signal, timeout: 180000 },
    );
    return r;
  }
  close(keepState) {
    if (!keepState) {
      this.state = "closed";
      this.dropped = false;
    }
    const tr = this.transport;
    this.transport = null;
    try {
      tr?.close();
    } catch {}
    this.rpc.failAll(new Error("Closed"));
  }
}

const IMAGE_MAX = 4 * 1024 * 1024;

function formatResult(r) {
  const out = [];
  const images = [];
  for (const c of r?.content || []) {
    if (c.type === "text") out.push(c.text);
    else if (c.type === "image" && c.data && c.data.length < IMAGE_MAX) {
      images.push(`data:${c.mimeType || "image/png"};base64,${c.data}`);
      out.push("[image returned]");
    } else if (c.type === "resource")
      out.push(
        c.resource?.text
          ? c.resource.text
          : `[resource ${c.resource?.uri || ""}]`,
      );
    else out.push(`[${c.type}]`);
  }
  if (!out.length && r?.structuredContent)
    out.push(JSON.stringify(r.structuredContent));
  // `image` is the first one (what agent.js shows today); `images` has them all
  return { ok: !r?.isError, text: out.join("\n") || "(no output)", image: images[0] || null, images };
}

/** Function names must match ^[a-zA-Z0-9_-]{1,64}$: replace other characters, shorten long names with a hash of the full one. */
function safeToolName(full) {
  const clean = String(full).replace(/[^a-zA-Z0-9_-]/g, "_");
  if (clean.length <= 64) return clean;
  const h = crypto.createHash("sha1").update(String(full)).digest("hex").slice(0, 6);
  return `${clean.slice(0, 57)}_${h}`;
}

/** Manager: connects configured servers and exposes their tools as OpenAI function definitions. */
function createMcpManager(opts = {}) {
  let servers = [];
  let onTokens = opts.onTokens || null;
  let names = new Map(); // function name -> { server, tool }
  const keyOf = new Map(); // "slug\u0000tool" -> function name

  /** Rebuilds the function-name table; collisions after sanitizing get _2, _3... */
  const rebuildNames = () => {
    names = new Map();
    keyOf.clear();
    for (const s of servers)
      for (const t of s.tools) {
        const base = safeToolName(`mcp__${s.slug}__${t.name}`);
        let n = base;
        for (let i = 2; names.has(n); i++) n = `${base.slice(0, 64 - String(i).length - 1)}_${i}`;
        names.set(n, { server: s, tool: t });
        keyOf.set(s.slug + "\u0000" + t.name, n);
      }
  };
  const hooks = {
    onTools: () => rebuildNames(),
    onTokens: (id, oauth) => { try { onTokens?.(id, oauth); } catch {} },
  };

  const uniqueSlugs = () => {
    const seen = {};
    for (const s of servers) {
      let b = s.slug,
        n = 1;
      while (seen[s.slug]) s.slug = `${b}_${++n}`;
      seen[s.slug] = true;
    }
  };

  async function configure(list) {
    for (const s of servers) s.close();
    servers = (list || [])
      .filter((c) => c.enabled !== false)
      .map((c) => new McpServer(c, hooks));
    uniqueSlugs();
    await Promise.all(servers.map((s) => s.connect()));
    rebuildNames();
  }
  const status = (list) => {
    const byId = new Map(servers.map((s) => [s.cfg.id, s]));
    return (list || servers.map((s) => s.cfg)).map((c) => {
      const s = byId.get(c.id);
      return {
        id: c.id,
        name: c.name,
        enabled: c.enabled !== false,
        state: s ? s.state : "off",
        error: s ? s.error : "",
        tools: s ? s.tools.map((t) => t.name) : [],
        toolInfo: s ? s.tools.map((t) => ({ name: t.name, description: String(t.description || '').replace(/\s+/g, ' ').trim().slice(0, 300), readOnly: !!(t.annotations && t.annotations.readOnlyHint) })) : [],
      };
    });
  };
  const defName = (s, t) => keyOf.get(s.slug + "\u0000" + t.name) || safeToolName(`mcp__${s.slug}__${t.name}`);

  /** Tool definitions of the connected servers; `slugs` (optional) limits them to those servers. */
  function definitions(slugs) {
    const defs = [];
    for (const s of servers) {
      if (!s.live()) continue;
      if (Array.isArray(slugs) && !slugs.includes(s.slug)) continue;
      for (const t of s.tools) {
        defs.push({
          type: "function",
          function: {
            name: defName(s, t),
            description:
              `[${s.cfg.name}] ${t.description || t.title || t.name}`.slice(
                0,
                1000,
              ),
            parameters:
              t.inputSchema && t.inputSchema.type
                ? t.inputSchema
                : { type: "object", properties: {} },
          },
        });
      }
    }
    return defs;
  }
  /** Connected servers in short form, for the on-demand connector list. */
  const index = () => servers.filter((s) => s.live() && s.tools.length).map((s) => ({ slug: s.slug, name: s.cfg.name, tools: s.tools.map((t) => t.name) }));
  /** Resolves a name the model gave (slug or display name, any case) to a connected server's slug. */
  const resolveSlug = (q) => {
    const k = String(q || "").trim().toLowerCase();
    const hit = index().find((x) => x.slug.toLowerCase() === k || String(x.name).toLowerCase() === k) || index().find((x) => x.slug.toLowerCase().includes(k) || String(x.name).toLowerCase().includes(k));
    return k && hit ? hit.slug : "";
  };
  function find(fullName) {
    const hit = names.get(String(fullName || ""));
    if (hit && servers.includes(hit.server)) return hit;
    // Models sometimes garble the server part (arteris for artemis). A server slug never contains "__", so the tool part is what follows the
    // first "__": accept it when exactly one connected tool carries that name.
    const rest = String(fullName || '').replace(/^mcp__/, '');
    const i = rest.indexOf('__');
    if (i > 0) {
      const toolPart = rest.slice(i + 2);
      const hits = [];
      for (const s of servers) if (s.live()) for (const t of s.tools) if (t.name === toolPart) hits.push({ server: s, tool: t });
      if (hits.length === 1) return hits[0];
    }
    return null;
  }
  /** Why a connector tool could not be found, written for the model so it can recover. */
  function explainMissing(fullName) {
    const live = servers.map((s) => `${s.slug} (${s.state === "connected" ? `connected, ${s.tools.length} tools` : s.state + (s.error ? `: ${String(s.error).slice(0, 80)}` : "")})`);
    return `Connector tool is not available: ${fullName}. ` + (live.length ? `Connectors: ${live.join("; ")}. ` : "No connectors are connected. ") +
      "Use only the exact tool names you were given; file, web, notes and memory work through the built-in tools, not connectors.";
  }
  const info = (fullName) => {
    const f = find(fullName);
    return f
      ? {
          server: f.server.slug,
          serverName: f.server.cfg.name,
          readOnly: !!f.tool.annotations?.readOnlyHint,
        }
      : null;
  };
  async function call(fullName, args, signal) {
    const f = find(fullName);
    if (!f) throw new Error(`Connector tool not found: ${fullName}`);
    return formatResult(await f.server.call(f.tool.name, args, signal));
  }
  return {
    configure,
    status,
    definitions,
    index,
    resolveSlug,
    info,
    call,
    explainMissing,
    /** fn(serverId, oauth) is called after an OAuth token refresh, to save the new tokens. */
    setTokenSaver: (fn) => {
      onTokens = typeof fn === "function" ? fn : null;
    },
    close: () => {
      for (const s of servers) s.close();
      servers = [];
      rebuildNames();
    },
    count: () => servers.filter((s) => s.live()).length,
    /** Slugs of the servers whose saved settings match pred(cfg). */
    slugsWhere: (pred) => servers.filter((s) => { try { return !!pred(s.cfg); } catch { return false; } }).map((s) => s.slug),
  };
}

/** The manager without some servers (by slug, worked out at each call so reconnects are followed). */
function hideServers(mcp, hiddenSlugs) {
  if (!mcp) return mcp;
  const hidden = () => new Set(hiddenSlugs() || []);
  const visible = () => mcp.index().map((x) => x.slug).filter((s) => !hidden().has(s));
  return {
    ...mcp,
    definitions: (slugs) => { const v = visible(); return mcp.definitions(Array.isArray(slugs) ? slugs.filter((s) => v.includes(s)) : v); },
    index: () => { const h = hidden(); return mcp.index().filter((x) => !h.has(x.slug)); },
    resolveSlug: (q) => { const s = mcp.resolveSlug(q); return s && !hidden().has(s) ? s : ''; },
    info: (name) => { const i = mcp.info(name); return i && !hidden().has(i.server) ? i : null; },
    call: (name, ...rest) => { const i = mcp.info(name); return i && hidden().has(i.server) ? Promise.reject(new Error(`Connector tool not available here: ${name}`)) : mcp.call(name, ...rest); }
  };
}

/** A connector that is Artemis itself (its own MCP server, or the gateway, on this computer): calling it from inside
 *  Artemis only goes round in circles, and its file paths are relative to another folder. */
function isSelfConnector(cfg, ports) {
  if (!cfg) return false;
  if (cfg.url) {
    try {
      const u = new URL(cfg.url);
      const local = ['127.0.0.1', 'localhost', '[::1]', '::1', '0.0.0.0'].includes(u.hostname);
      if (local && (ports || []).map(Number).includes(Number(u.port))) return true;
    } catch {}
  }
  return false;
}

/** Accepts Claude Desktop's { mcpServers: { name: { command, args, env } | { url, headers } } } or a plain array. */
function parseImport(text) {
  const j = JSON.parse(text);
  const src = j.mcpServers || j.servers || j;
  const out = [];
  const add = (name, v) => {
    if (!v || typeof v !== "object") return;
    const id = Math.random().toString(36).slice(2, 10);
    if (v.url)
      out.push({
        id,
        name,
        type: "http",
        url: v.url,
        headers: v.headers || {},
        enabled: true,
      });
    else if (v.command)
      out.push({
        id,
        name,
        type: "stdio",
        command: v.command,
        args: v.args || [],
        env: v.env || {},
        enabled: true,
      });
  };
  if (Array.isArray(src))
    src.forEach((v, i) => add(v.name || `server ${i + 1}`, v));
  else Object.entries(src).forEach(([n, v]) => add(n, v));
  if (!out.length) throw new Error("No servers found in this JSON.");
  return out;
}

module.exports = {
  createMcpManager,
  hideServers,
  isSelfConnector,
  parseImport,
  formatResult,
  safeToolName,
  refreshOAuth,
  richPath,
  slug,
};
