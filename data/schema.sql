CREATE TABLE IF NOT EXISTS raffle_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  name VARCHAR(200) NOT NULL DEFAULT 'Rifa do Play',
  prize_description TEXT NOT NULL DEFAULT 'PS5 Slim + GTA VI',
  total_tickets INTEGER NOT NULL DEFAULT 200,
  ticket_price DECIMAL(10,2) NOT NULL DEFAULT 25.00,
  draw_date TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  winner_ticket INTEGER,
  winner_name VARCHAR(200),
  winner_phone VARCHAR(20),
  pix_key VARCHAR(200) NOT NULL DEFAULT '22241843000112',
  pix_name VARCHAR(200) NOT NULL DEFAULT 'Igor Allen Bezerra de Magalhaes Ritzmann',
  pix_link TEXT NOT NULL DEFAULT ''
);

INSERT INTO raffle_config (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS tickets (
  number INTEGER PRIMARY KEY,
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  buyer_name VARCHAR(200),
  buyer_phone VARCHAR(20),
  buyer_email VARCHAR(255),
  reservation_token VARCHAR(64) UNIQUE,
  reserved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  notes TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);
CREATE INDEX IF NOT EXISTS idx_tickets_phone ON tickets (buyer_phone);
CREATE INDEX IF NOT EXISTS idx_tickets_token ON tickets (reservation_token);
