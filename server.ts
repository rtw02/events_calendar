import { Database } from "bun:sqlite";
import Anthropic from "@anthropic-ai/sdk";
import { google } from "googleapis";
import { readFileSync, writeFileSync, existsSync } from "fs";

// ── DB ────────────────────────────────────────────────────────
const db = new Database("fall-calendar.db", { create: true });
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    date_key TEXT PRIMARY KEY,
    plans    TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS friends (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#78AADC'
  );
  CREATE TABLE IF NOT EXISTS goals (
    month_key TEXT PRIMARY KEY,
    target    INTEGER NOT NULL DEFAULT 0
  );
`);

const getEvents  = db.query("SELECT * FROM events");
const setEvent   = db.query("INSERT OR REPLACE INTO events (date_key, plans) VALUES ($key, $plans)");
const delEvent   = db.query("DELETE FROM events WHERE date_key = $key");
const getFriends = db.query("SELECT * FROM friends");
const setFriend  = db.query("INSERT OR REPLACE INTO friends (id, name, color) VALUES ($id, $name, $color)");
const delFriend  = db.query("DELETE FROM friends WHERE id = $id");
const getGoals   = db.query("SELECT * FROM goals");
const setGoal    = db.query("INSERT OR REPLACE INTO goals (month_key, target) VALUES ($key, $target)");
const delGoal    = db.query("DELETE FROM goals WHERE month_key = $key");

// ── Google Calendar ───────────────────────────────────────────
const TOKENS_FILE = "./gcal-tokens.json";
const GCAL_SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

function makeOAuth2() {
  const port = process.env.PORT ?? "3003";
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `http://localhost:${port}/auth/callback`
  );
}

function loadTokens(): Record<string, unknown> | null {
  try { return existsSync(TOKENS_FILE) ? JSON.parse(readFileSync(TOKENS_FILE, "utf-8")) : null; }
  catch { return null; }
}

function saveTokens(tokens: Record<string, unknown>) {
  writeFileSync(TOKENS_FILE, JSON.stringify(tokens));
}

async function auth(req: Request, url: URL): Promise<Response> {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    return new Response("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env", { status: 503 });

  if (url.pathname === "/auth/login") {
    const oauth2 = makeOAuth2();
    const authUrl = oauth2.generateAuthUrl({ access_type: "offline", scope: GCAL_SCOPES, prompt: "consent" });
    return Response.redirect(authUrl, 302);
  }

  if (url.pathname === "/auth/callback") {
    const code = url.searchParams.get("code");
    if (!code) return new Response("Missing code", { status: 400 });
    try {
      const oauth2 = makeOAuth2();
      const { tokens } = await oauth2.getToken(code);
      saveTokens(tokens as Record<string, unknown>);
      return Response.redirect(`http://localhost:${process.env.PORT ?? "3003"}/?gcal=connected`, 302);
    } catch (e) {
      return new Response(`Auth failed: ${e}`, { status: 500 });
    }
  }

  return new Response("Not found", { status: 404 });
}

// ── AI ────────────────────────────────────────────────────────
const ai = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ── Helpers ───────────────────────────────────────────────────
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

async function readBody(req: Request) {
  try { return await req.json(); } catch { return {}; }
}

// ── GCal Time Parser ─────────────────────────────────────────
function parseEventTime(date: string, timeStr?: string) {
  if (!timeStr || !timeStr.trim()) return { start: { date }, end: { date } };
  const t = timeStr.trim().toLowerCase();
  let h = 0, m = 0;
  const m12 = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m12) {
    h = parseInt(m12[1]); m = parseInt(m12[2] || "0");
    if (m12[3] === "pm" && h !== 12) h += 12;
    if (m12[3] === "am" && h === 12) h = 0;
  } else if (m24) {
    h = parseInt(m24[1]); m = parseInt(m24[2]);
  } else {
    return { start: { date }, end: { date } };
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const tz = "America/New_York";
  return {
    start: { dateTime: `${date}T${pad(h)}:${pad(m)}:00`, timeZone: tz },
    end:   { dateTime: `${date}T${pad(h < 23 ? h + 1 : 23)}:${pad(m)}:00`, timeZone: tz },
  };
}

// ── API ───────────────────────────────────────────────────────
async function api(req: Request, url: URL): Promise<Response> {
  const { pathname: p, method: m } = { pathname: url.pathname, method: req.method };

  // OPTIONS preflight
  if (m === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*" } });

  // ── Events ──────────────────────────────────────────────────
  if (p === "/api/events" && m === "GET") {
    const rows = getEvents.all() as { date_key: string; plans: string }[];
    const out: Record<string, unknown[]> = {};
    rows.forEach(r => { out[r.date_key] = JSON.parse(r.plans); });
    return json(out);
  }

  if (p.startsWith("/api/events/") && m === "PUT") {
    const key = p.slice("/api/events/".length);
    const { plans = [] } = await readBody(req);
    if (plans.length === 0) delEvent.run({ $key: key });
    else setEvent.run({ $key: key, $plans: JSON.stringify(plans) });
    return json({ ok: true });
  }

  // ── Friends ─────────────────────────────────────────────────
  if (p === "/api/friends" && m === "GET") {
    return json(getFriends.all());
  }

  if (p === "/api/friends" && m === "POST") {
    const { id, name, color } = await readBody(req);
    setFriend.run({ $id: id, $name: name, $color: color || "#78AADC" });
    return json({ ok: true });
  }

  if (p.startsWith("/api/friends/") && m === "DELETE") {
    delFriend.run({ $id: p.slice("/api/friends/".length) });
    return json({ ok: true });
  }

  // ── Goals ───────────────────────────────────────────────────
  if (p === "/api/goals" && m === "GET") {
    const rows = getGoals.all() as { month_key: string; target: number }[];
    const out: Record<string, number> = {};
    rows.forEach(r => { out[r.month_key] = r.target; });
    return json(out);
  }

  if (p.startsWith("/api/goals/") && m === "PUT") {
    const key = p.slice("/api/goals/".length);
    const { target = 0 } = await readBody(req);
    if (target <= 0) delGoal.run({ $key: key });
    else setGoal.run({ $key: key, $target: target });
    return json({ ok: true });
  }

  // ── AI Suggestions ──────────────────────────────────────────
  if (p === "/api/ai/suggestions" && m === "POST") {
    if (!ai) return json({ error: "Set ANTHROPIC_API_KEY in .env" }, 503);
    const { dayName, monthName, dayNum, friends = [] } = await readBody(req);
    const ctx = friends.length ? ` You often hang out with ${friends.slice(0, 3).join(", ")}.` : "";
    try {
      const msg = await ai.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{
          role: "user",
          content: `Suggest 3 specific things to do in or near New York City for ${dayName}, ${monthName} ${dayNum}, 2026.${ctx} Focus on fall activities: upstate day trips, county fairs, Halloween events, friendsgiving prep, or unique NYC fall experiences. Use real venues or locations. Respond ONLY with valid JSON: {"suggestions":[{"title":"...","description":"1-2 sentences","category":"upstate|fair|halloween|friendsgiving|other"}]}`,
        }],
      });
      const raw = msg.content[0].type === "text" ? msg.content[0].text : "{}";
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
      return json(parsed);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  // ── AI Recap (streaming) ─────────────────────────────────────
  if (p === "/api/ai/recap" && m === "POST") {
    if (!ai) return json({ error: "Set ANTHROPIC_API_KEY in .env" }, 503);
    const { success, total, topFriends, breakdown } = await readBody(req);
    const prompt = `Write a warm, fun 2-paragraph recap of my fall 2026 social season. Stats: ${success} success days, ${total} total plans. Top friends: ${topFriends || "none logged"}. Activity mix: ${breakdown || "varied"}. Make it personal and celebratory.`;
    const stream = new ReadableStream({
      async start(ctrl) {
        const enc = new TextEncoder();
        try {
          const s = ai.messages.stream({ model: "claude-sonnet-5", max_tokens: 600, messages: [{ role: "user", content: prompt }] });
          for await (const chunk of s) {
            if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
              ctrl.enqueue(enc.encode(chunk.delta.text));
            }
          }
        } catch (e) { ctrl.enqueue(enc.encode(`Error: ${e}`)); }
        ctrl.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
  }

  // ── GCal Status ─────────────────────────────────────────────
  if (p === "/api/gcal/status" && m === "GET") {
    const tokens = loadTokens();
    if (!tokens || !process.env.GOOGLE_CLIENT_ID) return json({ connected: false });
    try {
      const oauth2 = makeOAuth2();
      oauth2.setCredentials(tokens);
      const calendar = google.calendar({ version: "v3", auth: oauth2 });
      const me = await calendar.calendarList.get({ calendarId: "primary" });
      return json({ connected: true, email: me.data.summary || me.data.id });
    } catch { return json({ connected: false }); }
  }

  // ── GCal Create ─────────────────────────────────────────────
  if (p === "/api/gcal/create" && m === "POST") {
    const tokens = loadTokens();
    if (!tokens) return json({ error: "Not connected" }, 401);
    try {
      const { date, title, time } = await readBody(req);
      const oauth2 = makeOAuth2();
      oauth2.setCredentials(tokens);
      oauth2.on("tokens", (t) => saveTokens({ ...loadTokens(), ...t } as Record<string, unknown>));
      const calendar = google.calendar({ version: "v3", auth: oauth2 });
      const timing = parseEventTime(date, time);
      const event = await calendar.events.insert({
        calendarId: "primary",
        requestBody: { summary: title, ...timing },
      });
      return json({ gcalId: event.data.id });
    } catch (e) { return json({ error: String(e) }, 500); }
  }

  // ── GCal Delete ──────────────────────────────────────────────
  if (p.startsWith("/api/gcal/delete/") && m === "DELETE") {
    const tokens = loadTokens();
    if (!tokens) return json({ error: "Not connected" }, 401);
    try {
      const gcalId = decodeURIComponent(p.slice("/api/gcal/delete/".length));
      const oauth2 = makeOAuth2();
      oauth2.setCredentials(tokens);
      oauth2.on("tokens", (t) => saveTokens({ ...loadTokens(), ...t } as Record<string, unknown>));
      const calendar = google.calendar({ version: "v3", auth: oauth2 });
      await calendar.events.delete({ calendarId: "primary", eventId: gcalId });
      return json({ ok: true });
    } catch (e) { return json({ error: String(e) }, 500); }
  }

  // ── GCal Update ──────────────────────────────────────────────
  if (p.startsWith("/api/gcal/update/") && m === "PATCH") {
    const tokens = loadTokens();
    if (!tokens) return json({ error: "Not connected" }, 401);
    try {
      const gcalId = decodeURIComponent(p.slice("/api/gcal/update/".length));
      const { title, date, time } = await readBody(req);
      const oauth2 = makeOAuth2();
      oauth2.setCredentials(tokens);
      oauth2.on("tokens", (t) => saveTokens({ ...loadTokens(), ...t } as Record<string, unknown>));
      const calendar = google.calendar({ version: "v3", auth: oauth2 });
      const timing = parseEventTime(date, time);
      await calendar.events.patch({
        calendarId: "primary",
        eventId: gcalId,
        requestBody: { summary: title, ...timing },
      });
      return json({ ok: true });
    } catch (e) { return json({ error: String(e) }, 500); }
  }

  // ── GCal Sync ────────────────────────────────────────────────
  if (p === "/api/gcal/events" && m === "GET") {
    const tokens = loadTokens();
    if (!tokens) return json({ error: "Not connected" }, 401);
    try {
      const oauth2 = makeOAuth2();
      oauth2.setCredentials(tokens);
      // Refresh tokens automatically and persist
      oauth2.on("tokens", (t) => {
        const merged = { ...loadTokens(), ...t };
        saveTokens(merged as Record<string, unknown>);
      });
      const calendar = google.calendar({ version: "v3", auth: oauth2 });
      const res = await calendar.events.list({
        calendarId: "primary",
        timeMin: "2026-09-01T00:00:00-04:00",
        timeMax: "2026-11-30T23:59:59-05:00",
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 500,
      });
      const byDate: Record<string, { id: string; summary: string; start: string; end: string; allDay: boolean }[]> = {};
      for (const ev of res.data.items ?? []) {
        if (!ev.start || ev.status === "cancelled") continue;
        const allDay = !!ev.start.date;
        const rawStart = ev.start.date ?? ev.start.dateTime ?? "";
        const date = rawStart.slice(0, 10); // YYYY-MM-DD
        if (!date) continue;
        byDate[date] = byDate[date] ?? [];
        byDate[date].push({
          id: ev.id ?? "",
          summary: ev.summary ?? "(No title)",
          start: ev.start.dateTime ? new Date(ev.start.dateTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
          end: ev.end?.dateTime ? new Date(ev.end.dateTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
          allDay,
        });
      }
      return json({ byDate });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  return json({ error: "Not found" }, 404);
}

// ── Static ────────────────────────────────────────────────────
async function serveStatic(path: string): Promise<Response> {
  // Background photo — serve from Desktop without copying
  if (path === "/bg.jpg") {
    const bgPath = process.env.BG_IMAGE ?? `${process.env.HOME}/Desktop/102_1350-2.jpg`;
    const f = Bun.file(bgPath);
    if (await f.exists()) return new Response(f, { headers: { "Content-Type": "image/jpeg" } });
    return new Response("Not found", { status: 404 });
  }
  const filePath = `./public${path === "/" ? "/index.html" : path}`;
  const file = Bun.file(filePath);
  if (await file.exists()) return new Response(file);
  return new Response("Not found", { status: 404 });
}

// ── Server ────────────────────────────────────────────────────
const server = Bun.serve({
  port: parseInt(process.env.PORT ?? "3003"),
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return api(req, url);
    if (url.pathname.startsWith("/auth/")) return auth(req, url);
    return serveStatic(url.pathname);
  },
});

console.log(`\n🍂 Fall Calendar → http://localhost:${server.port}\n`);
