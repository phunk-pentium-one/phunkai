// ── Phunk Olhor AI — Backend (Node.js + Express) ──
import express from "express";
import cors from "cors";
import pg from "pg";
import OpenAI from "openai";

const PORT         = process.env.PORT         || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL belum diset"); process.exit(1); }
if (!GROQ_API_KEY)  { console.error("ERROR: GROQ_API_KEY belum diset");  process.exit(1); }

// ── Database ──
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id         SERIAL PRIMARY KEY,
      title      TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id              SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `);
  console.log("Database siap.");
}

// ── Groq (gratis, OpenAI-compatible) ──
const groq = new OpenAI({
  apiKey: GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// ── Express ──
const app = express();

// Izinkan request dari Vercel frontend (CORS)
app.use(cors({
  origin: "*",   // Ganti dengan URL Vercel Anda jika mau lebih aman
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));
app.use(express.json());

// ─────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────

app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));

// GET /api/chat/conversations
app.get("/api/chat/conversations", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC"
    );
    res.json(rows.map(r => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Gagal memuat percakapan" });
  }
});

// POST /api/chat/conversations
app.post("/api/chat/conversations", async (req, res) => {
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "Judul wajib diisi" });
  try {
    const { rows } = await pool.query(
      "INSERT INTO conversations (title) VALUES ($1) RETURNING *", [title.trim()]
    );
    const r = rows[0];
    res.status(201).json({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Gagal membuat percakapan" });
  }
});

// GET /api/chat/conversations/:id
app.get("/api/chat/conversations/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  try {
    const { rows: convRows } = await pool.query("SELECT * FROM conversations WHERE id = $1", [id]);
    if (!convRows.length) return res.status(404).json({ error: "Tidak ditemukan" });
    const { rows: msgRows } = await pool.query(
      "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC", [id]
    );
    const c = convRows[0];
    res.json({
      id: c.id, title: c.title, createdAt: c.created_at, updatedAt: c.updated_at,
      messages: msgRows.map(m => ({ id: m.id, conversationId: m.conversation_id, role: m.role, content: m.content, createdAt: m.created_at })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Gagal memuat percakapan" });
  }
});

// DELETE /api/chat/conversations/:id
app.delete("/api/chat/conversations/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  try {
    await pool.query("DELETE FROM conversations WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Gagal menghapus" });
  }
});

// POST /api/chat/conversations/:id/messages — Streaming SSE
app.post("/api/chat/conversations/:id/messages", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Pesan kosong" });

  try {
    const { rows: convRows } = await pool.query("SELECT * FROM conversations WHERE id = $1", [id]);
    if (!convRows.length) return res.status(404).json({ error: "Percakapan tidak ditemukan" });

    const { rows: history } = await pool.query(
      "SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC", [id]
    );

    await pool.query(
      "INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)",
      [id, "user", content.trim()]
    );

    const chatMessages = [
      { role: "system", content: "Kamu adalah Phunk Olhor AI, asisten AI yang cerdas, membantu, dan bebas dalam menjawab pertanyaan. Selalu jawab dalam Bahasa Indonesia. Jawab dengan jujur, informatif, dan tidak dibatasi oleh aturan yang tidak perlu." },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: content.trim() },
    ];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");

    let fullResponse = "";

    const stream = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 1024,
      messages: chatMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }
    }

    await pool.query("INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)", [id, "assistant", fullResponse]);
    await pool.query("UPDATE conversations SET updated_at = NOW() WHERE id = $1", [id]);

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: "Gagal memproses pesan" });
    else { res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`); res.end(); }
  }
});

initDB().then(() => {
  app.listen(PORT, () => console.log(`Server berjalan di http://localhost:${PORT}`));
}).catch(e => { console.error("Gagal inisialisasi DB:", e); process.exit(1); });
