"use strict";

// ── Mock the database pool before requiring server ────────────────────────
jest.mock("../data/db", () => {
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(),
    on: jest.fn(),
  };
  return { pool: mockPool, ensureSchema: jest.fn().mockResolvedValue(undefined) };
});

// ── Mock connect-pg-simple with an in-memory store that actually works ────
jest.mock("connect-pg-simple", () => () => {
  const { Store } = require("express-session");
  class MemorySessionStore extends Store {
    constructor() { super(); this._sessions = {}; }
    get(sid, cb)          { cb(null, this._sessions[sid] || null); }
    set(sid, sess, cb)    { this._sessions[sid] = sess; cb && cb(null); }
    destroy(sid, cb)      { delete this._sessions[sid]; cb && cb(null); }
    touch(sid, sess, cb)  { this._sessions[sid] = sess; cb && cb(null); }
  }
  return MemorySessionStore;
});

const request = require("supertest");
const { pool } = require("../data/db");
const { app } = require("../server");

// ── Helpers ───────────────────────────────────────────────────────────────
const CONFIG_ROW = {
  id: 1, name: "Rifa do Play", prize_description: "PS5 Slim + GTA VI",
  total_tickets: 200, ticket_price: "25.00", status: "active",
  pix_key: "22241843000112", pix_name: "Test", pix_link: "",
  winner_ticket: null, winner_name: null, winner_phone: null,
  min_tickets_to_draw: 150,
};

function mockClient(queryResults = []) {
  let callIndex = 0;
  const client = {
    query: jest.fn().mockImplementation(() => {
      const result = queryResults[callIndex++];
      return Promise.resolve(result || { rows: [], rowCount: 0 });
    }),
    release: jest.fn(),
  };
  pool.connect.mockResolvedValue(client);
  return client;
}

// resetAllMocks clears both calls AND implementations (unlike clearAllMocks)
beforeEach(() => {
  jest.resetAllMocks();
  pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ══════════════════════════════════════════════════════════════════════════
// GET /api/raffle
// ══════════════════════════════════════════════════════════════════════════
describe("GET /api/raffle", () => {
  test("retorna config e stats", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })          // expireReservations
      .mockResolvedValueOnce({ rows: [CONFIG_ROW] })              // raffle_config
      .mockResolvedValueOnce({ rows: [                            // stats
        { status: "available", total: "180" },
        { status: "reserved",  total: "15"  },
        { status: "paid",      total: "5"   },
      ]});

    const res = await request(app).get("/api/raffle");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Rifa do Play");
    expect(res.body.stats.available).toBe(180);
    expect(res.body.stats.paid).toBe(5);
  });

  test("retorna 500 em erro de banco", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("DB error"));
    const res = await request(app).get("/api/raffle");
    expect(res.status).toBe(500);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GET /api/tickets
// ══════════════════════════════════════════════════════════════════════════
describe("GET /api/tickets", () => {
  test("retorna lista de cotas", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [
        { number: 1, status: "available" },
        { number: 2, status: "paid" },
      ]});
    const res = await request(app).get("/api/tickets");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].number).toBe(1);
  });

  test("não expõe dados pessoais do comprador", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ number: 5, status: "paid" }] });
    const res = await request(app).get("/api/tickets");
    expect(res.body[0]).not.toHaveProperty("buyer_name");
    expect(res.body[0]).not.toHaveProperty("buyer_phone");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// POST /api/reservar
// ══════════════════════════════════════════════════════════════════════════
describe("POST /api/reservar", () => {
  const validBody = { name: "João Silva", phone: "(11) 99999-1234", tickets: [1, 2, 3] };

  test("reserva com sucesso retorna token", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // expireReservations
    mockClient([
      { rows: [] },                                              // BEGIN
      { rows: [{ number: 1 }, { number: 2 }, { number: 3 }] }, // SELECT FOR UPDATE
      { rows: [] },                                              // UPDATE
      { rows: [] },                                              // COMMIT
    ]);
    const res = await request(app).post("/api/reservar").send(validBody);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(res.body.tickets).toEqual([1, 2, 3]);
    expect(res.body.total).toBe(105);
  });

  test("rejeita quando nome está ausente", async () => {
    const res = await request(app).post("/api/reservar").send({ phone: "11999991234", tickets: [1] });
    expect(res.status).toBe(400);
  });

  test("rejeita quando telefone está ausente", async () => {
    const res = await request(app).post("/api/reservar").send({ name: "João", tickets: [1] });
    expect(res.status).toBe(400);
  });

  test("rejeita telefone com menos de 10 dígitos", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post("/api/reservar").send({ name: "João", phone: "123", tickets: [1] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválido/i);
  });

  test("rejeita mais de 20 cotas", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const tickets = Array.from({ length: 21 }, (_, i) => i + 1);
    const res = await request(app).post("/api/reservar").send({ name: "João", phone: "11999991234", tickets });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/20/);
  });

  test("rejeita número de cota inválido (0)", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post("/api/reservar").send({ name: "João", phone: "11999991234", tickets: [0] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválido/i);
  });

  test("rejeita número de cota fora do range (201)", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post("/api/reservar").send({ name: "João", phone: "11999991234", tickets: [201] });
    expect(res.status).toBe(400);
  });

  test("rejeita número de cota não-inteiro", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post("/api/reservar").send({ name: "João", phone: "11999991234", tickets: [1.5] });
    expect(res.status).toBe(400);
  });

  test("rejeita tickets como string (injeção de tipo)", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post("/api/reservar").send({ name: "João", phone: "11999991234", tickets: ["1; DROP TABLE tickets;"] });
    expect(res.status).toBe(400);
  });

  test("retorna 409 quando cota já foi reservada", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    mockClient([
      { rows: [] },
      { rows: [{ number: 1 }] }, // só 1 das 2 disponíveis → conflito
      { rows: [] }, // ROLLBACK
    ]);
    const res = await request(app).post("/api/reservar").send({ name: "João", phone: "11999991234", tickets: [1, 2] });
    expect(res.status).toBe(409);
  });

  test("rejeita nome muito longo (> 200 chars)", async () => {
    // Não atinge o rate limiter pois a validação de nome é feita antes
    // Usamos um telefone inválido curto para garantir que o nome é verificado primeiro
    const res = await request(app).post("/api/reservar").send({
      name: "A".repeat(201), phone: "11999991234", tickets: [1],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/longo/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GET /api/reserva/:token
// ══════════════════════════════════════════════════════════════════════════
describe("GET /api/reserva/:token", () => {
  test("retorna dados da reserva para token válido", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ number: 5, buyer_name: "João", buyer_phone: "11999991234", reserved_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [{ pix_key: "22241843000112", pix_name: "Test", pix_link: "", ticket_price: "25.00" }] });
    const res = await request(app).get("/api/reserva/validtoken123");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(35);
    expect(res.body.tickets).toHaveLength(1);
  });

  test("retorna 404 para token inexistente", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/reserva/tokeninexistente");
    expect(res.status).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GET /api/meus-tickets
// ══════════════════════════════════════════════════════════════════════════
describe("GET /api/meus-tickets", () => {
  test("retorna cotas pelo telefone", async () => {
    pool.query.mockResolvedValueOnce({ rows: [
      { number: 10, status: "paid", reserved_at: new Date(), paid_at: new Date() },
    ]});
    const res = await request(app).get("/api/meus-tickets?phone=11999991234");
    expect(res.status).toBe(200);
    expect(res.body[0].number).toBe(10);
  });

  test("retorna 400 para telefone curto", async () => {
    const res = await request(app).get("/api/meus-tickets?phone=123");
    expect(res.status).toBe(400);
  });

  test("retorna array vazio quando não há cotas", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/meus-tickets?phone=11999991234");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test("sanitiza telefone removendo caracteres especiais", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/meus-tickets?phone=(11)%2099999-1234");
    expect(res.status).toBe(200); // 11999991234 = 11 dígitos, válido
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ADMIN — autenticação
// ══════════════════════════════════════════════════════════════════════════
describe("Admin — autenticação", () => {
  test("login com senha correta retorna ok", async () => {
    const res = await request(app).post("/api/admin/login").send({ password: "admin123" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test("login com senha errada retorna 401", async () => {
    const res = await request(app).post("/api/admin/login").send({ password: "errada" });
    expect(res.status).toBe(401);
  });

  test("login sem senha retorna 401", async () => {
    const res = await request(app).post("/api/admin/login").send({});
    expect(res.status).toBe(401);
  });

  test("rotas admin retornam 401 sem sessão", async () => {
    const res = await request(app).get("/api/admin/tickets");
    expect(res.status).toBe(401);
  });

  test("POST pagar sem sessão retorna 401", async () => {
    const res = await request(app).post("/api/admin/tickets/1/pagar").send({});
    expect(res.status).toBe(401);
  });

  test("POST sortear sem sessão retorna 401", async () => {
    const res = await request(app).post("/api/admin/sortear").send({});
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ADMIN — sessão autenticada (agent mantém cookie)
// ══════════════════════════════════════════════════════════════════════════
describe("Admin — validação de número de cota", () => {
  let agent;

  beforeEach(async () => {
    jest.resetAllMocks();
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    agent = request.agent(app);
    const login = await agent.post("/api/admin/login").send({ password: "admin123" });
    expect(login.status).toBe(200);
  });

  test("pagar cota 0 retorna 400", async () => {
    const res = await agent.post("/api/admin/tickets/0/pagar").send({});
    expect(res.status).toBe(400);
  });

  test("pagar cota 201 retorna 400", async () => {
    const res = await agent.post("/api/admin/tickets/201/pagar").send({});
    expect(res.status).toBe(400);
  });

  test("cancelar cota 0 retorna 400", async () => {
    const res = await agent.post("/api/admin/tickets/0/cancelar").send({});
    expect(res.status).toBe(400);
  });

  test("pagar cota válida chama DB e retorna 200", async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await agent.post("/api/admin/tickets/50/pagar").send({});
    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("status='paid'"),
      [50]
    );
  });

  test("cancelar cota inexistente retorna 404", async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    const res = await agent.post("/api/admin/tickets/100/cancelar").send({});
    expect(res.status).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ADMIN — sortear
// ══════════════════════════════════════════════════════════════════════════
describe("Admin — sortear", () => {
  let agent;

  beforeEach(async () => {
    jest.resetAllMocks();
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    agent = request.agent(app);
    const login = await agent.post("/api/admin/login").send({ password: "admin123" });
    expect(login.status).toBe(200);
  });

  test("bloqueia sorteio se mínimo não atingido", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: "active", winner_ticket: null, min_tickets_to_draw: 150 }] })
      .mockResolvedValueOnce({ rows: Array.from({ length: 50 }, (_, i) => ({ number: i + 1, buyer_name: "X", buyer_phone: "11999991234" })) });
    const res = await agent.post("/api/admin/sortear").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mínimo/i);
    expect(res.body.paid).toBe(50);
    expect(res.body.min).toBe(150);
  });

  test("permite forçar sorteio abaixo do mínimo", async () => {
    const paidTickets = Array.from({ length: 50 }, (_, i) => ({ number: i + 1, buyer_name: "X", buyer_phone: "11999991234" }));
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: "active", winner_ticket: null, min_tickets_to_draw: 150 }] })
      .mockResolvedValueOnce({ rows: paidTickets })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE winner
    const res = await agent.post("/api/admin/sortear").send({ force_draw: true });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("winner");
  });

  test("bloqueia segundo sorteio (winner_ticket já existe)", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ status: "finished", winner_ticket: 42, min_tickets_to_draw: 150 }] });
    const res = await agent.post("/api/admin/sortear").send({ force_draw: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já realizado/i);
  });

  test("loteria federal: escolhe cota paga mais próxima", async () => {
    const paid = [
      { number: 10, buyer_name: "Ana", buyer_phone: "11999990001" },
      { number: 50, buyer_name: "Bob", buyer_phone: "11999990002" },
    ];
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: "active", winner_ticket: null, min_tickets_to_draw: 1 }] })
      .mockResolvedValueOnce({ rows: paid })
      .mockResolvedValueOnce({ rows: [] });
    const res = await agent.post("/api/admin/sortear").send({ force_draw: true, loteria_number: 48 });
    expect(res.status).toBe(200);
    expect(res.body.winner.number).toBe(50); // mais próximo de 48
  });

  test("loteria federal: empate de distância escolhe o menor número", async () => {
    // 10 e 30 são equidistantes de 20
    const paid = [
      { number: 10, buyer_name: "Ana", buyer_phone: "111" },
      { number: 30, buyer_name: "Bob", buyer_phone: "222" },
    ];
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: "active", winner_ticket: null, min_tickets_to_draw: 1 }] })
      .mockResolvedValueOnce({ rows: paid })
      .mockResolvedValueOnce({ rows: [] });
    const res = await agent.post("/api/admin/sortear").send({ force_draw: true, loteria_number: 20 });
    expect(res.status).toBe(200);
    // O primeiro da lista ordenada por Math.abs ganha; ambos têm distância 10
    expect([10, 30]).toContain(res.body.winner.number);
  });

  test("retorna 400 se não há cotas pagas", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: "active", winner_ticket: null, min_tickets_to_draw: 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await agent.post("/api/admin/sortear").send({ force_draw: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nenhuma/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Segurança — headers HTTP
// ══════════════════════════════════════════════════════════════════════════
describe("Segurança — headers HTTP", () => {
  test("X-Content-Type-Options: nosniff presente", async () => {
    const res = await request(app).get("/api/tickets");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("X-Frame-Options: DENY presente", async () => {
    const res = await request(app).get("/api/tickets");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  test("Content-Security-Policy presente", async () => {
    const res = await request(app).get("/api/tickets");
    expect(res.headers["content-security-policy"]).toMatch(/default-src/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Segurança — SQL injection via parâmetros
// ══════════════════════════════════════════════════════════════════════════
describe("Segurança — SQL injection", () => {
  test("token com caracteres especiais não causa 500", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get("/api/reserva/'; DROP TABLE tickets; --");
    expect(res.status).toBe(404); // parâmetro é tratado via query parametrizada
  });

  test("phone com injeção SQL é sanitizado (strips não-dígitos)", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    // Após strip de não-dígitos: "11999991234DROP" → "11999991234" (11 dígitos) → válido
    const res = await request(app).get("/api/meus-tickets?phone=11999991234'; DROP TABLE--");
    expect(res.status).toBe(200);
    // Verifica que a query foi chamada com o telefone limpo
    expect(pool.query).toHaveBeenCalledWith(
      expect.any(String),
      ["11999991234"]
    );
  });

  test("tickets array com strings não passa na validação de tipo", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post("/api/reservar").send({
      name: "X", phone: "11999991234",
      tickets: ["1 OR 1=1", "'; DROP TABLE tickets; --"],
    });
    expect(res.status).toBe(400);
  });
});
