require("dotenv").config();
const express = require("express");
const session = require("express-session");
const PgStore = require("connect-pg-simple")(session);
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const { pool, ensureSchema } = require("./data/db");

const app = express();
const PORT = Number(process.env.PORT) || 3002;
const IS_DEV = process.env.NODE_ENV !== "production";
const ADMIN_HASH = bcrypt.hashSync(process.env.ADMIN_PASSWORD || "admin123", 10);

app.set("trust proxy", 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  store: new PgStore({ pool, tableName: "rifa_sessions", createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: !IS_DEV, sameSite: "lax", maxAge: 8 * 60 * 60 * 1000 },
}));

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'");
  next();
});

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
const reserveLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
app.use("/api/", limiter);

// Expire reservations older than 24h
async function expireReservations() {
  await pool.query(`
    UPDATE tickets SET status='available', buyer_name=NULL, buyer_phone=NULL,
      buyer_email=NULL, reservation_token=NULL, reserved_at=NULL
    WHERE status='reserved' AND reserved_at < now() - interval '24 hours'
  `);
}

// ── Admin auth middleware ──────────────────────────────────────────────────
function adminAuth(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: "Não autorizado" });
  next();
}

// ══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════

app.get("/api/raffle", async (req, res) => {
  await expireReservations();
  try {
    const { rows } = await pool.query("SELECT * FROM raffle_config WHERE id = 1");
    const { rows: counts } = await pool.query(`
      SELECT status, COUNT(*) as total FROM tickets GROUP BY status
    `);
    const stats = { available: 0, reserved: 0, paid: 0 };
    counts.forEach(r => { stats[r.status] = Number(r.total); });
    res.json({ ...rows[0], stats });
  } catch (err) { res.status(500).json({ error: "Falha ao carregar rifa" }); }
});

app.get("/api/tickets", async (req, res) => {
  await expireReservations();
  try {
    const { rows } = await pool.query(
      "SELECT number, status FROM tickets ORDER BY number"
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "Falha ao carregar cotas" }); }
});

app.post("/api/reservar", reserveLimiter, async (req, res) => {
  await expireReservations();
  const { name, phone, email, tickets } = req.body;
  if (!name || !phone || !Array.isArray(tickets) || tickets.length === 0) {
    return res.status(400).json({ error: "Preencha nome, telefone e selecione ao menos uma cota" });
  }
  if (tickets.length > 20) return res.status(400).json({ error: "Máximo de 20 cotas por reserva" });
  const cleanPhone = phone.replace(/\D/g, "");
  if (cleanPhone.length < 10) return res.status(400).json({ error: "Telefone inválido" });

  const token = crypto.randomBytes(16).toString("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: available } = await client.query(
      "SELECT number FROM tickets WHERE number = ANY($1) AND status = 'available' FOR UPDATE",
      [tickets]
    );
    if (available.length !== tickets.length) {
      await client.query("ROLLBACK");
      const taken = tickets.filter(n => !available.find(r => r.number === n));
      return res.status(409).json({ error: `Cota(s) ${taken.join(", ")} já foram reservadas. Selecione outras.` });
    }
    await client.query(`
      UPDATE tickets SET status='reserved', buyer_name=$1, buyer_phone=$2,
        buyer_email=$3, reservation_token=$4, reserved_at=now()
      WHERE number = ANY($5)
    `, [name.trim(), cleanPhone, (email || "").trim() || null, token, tickets]);
    await client.query("COMMIT");
    res.json({ token, tickets, name: name.trim(), total: tickets.length * 25 });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: "Falha ao reservar cotas" });
  } finally { client.release(); }
});

app.get("/api/reserva/:token", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT number, buyer_name, buyer_phone, reserved_at FROM tickets WHERE reservation_token = $1 AND status = 'reserved'",
      [req.params.token]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Reserva não encontrada ou expirada" });
    const { rows: config } = await pool.query("SELECT pix_key, pix_name, pix_link, ticket_price FROM raffle_config WHERE id=1");
    res.json({ tickets: rows, ...config[0], total: rows.length * Number(config[0].ticket_price) });
  } catch (err) { res.status(500).json({ error: "Falha ao buscar reserva" }); }
});

app.get("/api/meus-tickets", async (req, res) => {
  const phone = String(req.query.phone || "").replace(/\D/g, "");
  if (phone.length < 10) return res.status(400).json({ error: "Telefone inválido" });
  try {
    const { rows } = await pool.query(
      "SELECT number, status, reserved_at, paid_at FROM tickets WHERE buyer_phone = $1 ORDER BY number",
      [phone]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "Falha ao buscar cotas" }); }
});

// ══════════════════════════════════════════════════════════════════════════
// ADMIN API
// ══════════════════════════════════════════════════════════════════════════

app.post("/api/admin/login", async (req, res) => {
  const { password } = req.body;
  if (!password || !bcrypt.compareSync(password, ADMIN_HASH)) {
    return res.status(401).json({ error: "Senha incorreta" });
  }
  req.session.isAdmin = true;
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => res.status(204).end());
});

app.get("/api/admin/tickets", adminAuth, async (req, res) => {
  await expireReservations();
  try {
    const { rows } = await pool.query(
      "SELECT number, status, buyer_name, buyer_phone, buyer_email, reserved_at, paid_at, notes FROM tickets ORDER BY number"
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "Falha ao carregar cotas" }); }
});

app.post("/api/admin/tickets/:number/pagar", adminAuth, async (req, res) => {
  const number = Number(req.params.number);
  try {
    const { rowCount } = await pool.query(
      "UPDATE tickets SET status='paid', paid_at=now() WHERE number=$1 AND status='reserved'",
      [number]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Cota não encontrada ou não reservada" });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "Falha ao confirmar pagamento" }); }
});

app.post("/api/admin/tickets/:number/cancelar", adminAuth, async (req, res) => {
  const number = Number(req.params.number);
  try {
    const { rowCount } = await pool.query(
      `UPDATE tickets SET status='available', buyer_name=NULL, buyer_phone=NULL,
        buyer_email=NULL, reservation_token=NULL, reserved_at=NULL, paid_at=NULL
       WHERE number=$1 AND status IN ('reserved','paid')`,
      [number]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Cota não encontrada" });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "Falha ao cancelar" }); }
});

app.post("/api/admin/sortear", adminAuth, async (req, res) => {
  try {
    const { rows: config } = await pool.query("SELECT status, winner_ticket FROM raffle_config WHERE id=1");
    if (config[0].winner_ticket) return res.status(400).json({ error: "Sorteio já realizado" });

    const { rows: paid } = await pool.query(
      "SELECT number, buyer_name, buyer_phone FROM tickets WHERE status='paid' ORDER BY number"
    );
    if (paid.length === 0) return res.status(400).json({ error: "Nenhuma cota paga para sortear" });

    // Se informou número da Loteria Federal, encontra a cota paga mais próxima
    let winner;
    const loteria = Number(req.body.loteria_number);
    if (loteria && loteria >= 1 && loteria <= 200) {
      const sorted = [...paid].sort((a, b) =>
        Math.abs(a.number - loteria) - Math.abs(b.number - loteria)
      );
      winner = sorted[0];
    } else {
      winner = paid[Math.floor(Math.random() * paid.length)];
    }

    await pool.query(
      "UPDATE raffle_config SET status='finished', winner_ticket=$1, winner_name=$2, winner_phone=$3 WHERE id=1",
      [winner.number, winner.buyer_name, winner.buyer_phone]
    );
    res.json({ winner });
  } catch (err) { res.status(500).json({ error: "Falha ao sortear" }); }
});

app.post("/api/admin/tickets/:number/nota", adminAuth, async (req, res) => {
  const number = Number(req.params.number);
  const notes = String(req.body.notes || "").slice(0, 300);
  try {
    await pool.query("UPDATE tickets SET notes=$1 WHERE number=$2", [notes, number]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "Falha ao salvar nota" }); }
});

// ══════════════════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════════════════

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`Rifa do Play rodando em http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Falha ao iniciar:", err);
    process.exit(1);
  });
