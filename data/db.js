const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "",
  database: process.env.PGDATABASE || "rifa_do_play",
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => console.error("Pool error:", err.message));

async function ensureSchema() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);

  const total = Number(process.env.TOTAL_TICKETS) || 200;
  await pool.query(`
    INSERT INTO tickets (number)
    SELECT generate_series(1, $1)
    ON CONFLICT DO NOTHING
  `, [total]);

  await pool.query(`
    UPDATE raffle_config SET
      name = $1, prize_description = $2, total_tickets = $3,
      ticket_price = $4, pix_key = $5, pix_name = $6, pix_link = $7
    WHERE id = 1
  `, [
    process.env.RAFFLE_NAME || "Rifa do Play",
    process.env.PRIZE_DESCRIPTION || "PS5 Slim + GTA VI",
    total,
    Number(process.env.TICKET_PRICE) || 25.00,
    process.env.PIX_KEY || "22241843000112",
    process.env.PIX_NAME || "Igor Allen Bezerra de Magalhaes Ritzmann",
    process.env.PIX_LINK || "",
  ]);
}

module.exports = { pool, ensureSchema };
