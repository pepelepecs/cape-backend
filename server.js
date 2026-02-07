const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "256kb" }));

const DATA_FILE = path.join(__dirname, "data.json");


let db = {
  capes: {},
  emotes: {},
  emotesRev: 0
};

// ---------- load ----------
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) || {};
    if (raw && typeof raw === "object") {

      if (raw.capes || raw.emotes || raw.emotesRev != null) {
        db.capes = raw.capes && typeof raw.capes === "object" ? raw.capes : {};
        db.emotes = raw.emotes && typeof raw.emotes === "object" ? raw.emotes : {};
        db.emotesRev = Number.isFinite(Number(raw.emotesRev)) ? Number(raw.emotesRev) : 0;
      } else {
     
        db.capes = raw;
        db.emotes = {};
        db.emotesRev = 0;
      }
    }
  }
} catch {
  db = { capes: {}, emotes: {}, emotesRev: 0 };
}

function saveDb() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch {}
}

// ---------- cleanup ----------
function cleanupCapes() {
  const now = Date.now();
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  for (const [uuid, v] of Object.entries(db.capes)) {
    const lastSeen = v && v.lastSeen ? Number(v.lastSeen) : 0;
    if (!lastSeen || now - lastSeen > maxAgeMs) delete db.capes[uuid];
  }
}

function cleanupEmotes() {
  const now = Date.now();
  const maxAgeMs = 60 * 1000; 
  for (const [uuid, v] of Object.entries(db.emotes)) {
    if (!v) { delete db.emotes[uuid]; continue; }
    const lastSeen = v.lastSeen ? Number(v.lastSeen) : 0;
    if (!lastSeen || now - lastSeen > maxAgeMs) delete db.emotes[uuid];
  }
}

// ---------- realtime: long-poll ----------
const waiters = new Set(); 

function bumpRevAndNotify() {
  db.emotesRev = (Number(db.emotesRev) || 0) + 1;

  for (const w of Array.from(waiters)) {
    if (!w || !w.res) { waiters.delete(w); continue; }
    if ((w.sinceRev | 0) < (db.emotesRev | 0)) {
      clearTimeout(w.timer);
      waiters.delete(w);
      safeJson(w.res, {
        rev: db.emotesRev,
        serverNow: Date.now(),
        players: db.emotes
      });
    }
  }

  saveDb();
}

function safeJson(res, obj) {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.status(200).end(JSON.stringify(obj));
  } catch {}
}

app.get("/", (req, res) => res.status(200).send("ok"));

// -------------------- CAPES API --------------------
app.get("/capes", (req, res) => {
  cleanupCapes();
  res.json(db.capes);
});

app.put("/capes/:uuid", (req, res) => {
  const uuid = req.params.uuid;
  const body = req.body || {};

  const clientKey = String(body.clientKey || "");
  if (!clientKey || clientKey.length < 16) {
    return res.status(400).json({ error: "missing clientKey" });
  }

  const existing = db.capes[uuid];
  if (existing && existing.clientKey && existing.clientKey !== clientKey) {
    return res.status(403).json({ error: "clientKey mismatch" });
  }

  db.capes[uuid] = {
    name: String(body.name || ""),
    capeId: String(body.capeId || "default"),
    customUrl: String(body.customUrl || ""),
    enabled: !!body.enabled,
    clientKey,
    lastSeen: Number(body.lastSeen || Date.now())
  };

  saveDb();
  res.json({ ok: true });
});

// -------------------- EMOTES API --------------------


app.get("/emotes", (req, res) => {
  cleanupEmotes();
  safeJson(res, {
    rev: Number(db.emotesRev) || 0,
    serverNow: Date.now(),
    players: db.emotes
  });
});


app.get("/emotes/changes", (req, res) => {
  cleanupEmotes();

  const sinceRev = Number(req.query.sinceRev || 0) || 0;
  const curRev = Number(db.emotesRev) || 0;


  if (sinceRev < curRev) {
    return safeJson(res, {
      rev: curRev,
      serverNow: Date.now(),
      players: db.emotes
    });
  }


  const w = { sinceRev, res, timer: null };

  w.timer = setTimeout(() => {

    waiters.delete(w);
    safeJson(res, {
      rev: Number(db.emotesRev) || 0,
      serverNow: Date.now(),
      players: db.emotes
    });
  }, 25000);

  waiters.add(w);


  req.on("close", () => {
    clearTimeout(w.timer);
    waiters.delete(w);
  });
});


app.put("/emotes/:uuid", (req, res) => {
  const uuid = String(req.params.uuid || "").trim();
  const body = req.body || {};
  const now = Date.now();

  if (!uuid) return res.status(400).json({ error: "missing uuid" });

  const active = body.active !== false;

  const type = body.type != null ? String(body.type) : "";
  const name = body.name != null ? String(body.name) : "";

  const prev = db.emotes[uuid] || {};


  let startedAt = prev.startedAt ? Number(prev.startedAt) : now;
  const prevActive = prev.active !== false && !!prev.type;

  if (active) {
    const incomingType = type || prev.type || "";
    const typeChanged = incomingType && incomingType !== (prev.type || "");
    const wasInactive = !prevActive;

    if (typeChanged || wasInactive) startedAt = now;
  }

  db.emotes[uuid] = {
    name: name || prev.name || "",
    type: active ? (type || prev.type || "") : (prev.type || type || ""),
    active: !!active,
    startedAt: Number.isFinite(startedAt) ? startedAt : now,
    lastSeen: now
  };


  bumpRevAndNotify();

  res.json({ ok: true, rev: Number(db.emotesRev) || 0 });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("cape-backend on port", port));
