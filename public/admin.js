(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
  }

  let allRows = [];

  // ── Login ────────────────────────────────────────────────────────
  $("btnLogin").addEventListener("click", async () => {
    const pass = $("loginPass").value;
    if (!pass) return;
    $("btnLogin").disabled = true;
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pass }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Senha incorreta");
      $("loginSection").style.display = "none";
      $("dashSection").style.display  = "block";
      loadTickets();
    } catch (err) {
      $("loginError").textContent = err.message;
      $("loginError").style.display = "block";
      $("btnLogin").disabled = false;
    }
  });
  $("loginPass").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btnLogin").click(); });

  $("btnLogout").addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    location.reload();
  });

  // ── Load tickets ─────────────────────────────────────────────────
  async function loadTickets() {
    try {
      const r = await fetch("/api/admin/tickets");
      if (r.status === 401) { location.reload(); return; }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      allRows = data;

      const stats = { available: 0, reserved: 0, paid: 0 };
      data.forEach(t => { stats[t.status] = (stats[t.status] || 0) + 1; });
      $("statsRow").innerHTML = `
        <div class="stat-chip"><span class="dot dot-available"></span>${stats.available} disp.</div>
        <div class="stat-chip"><span class="dot dot-reserved"></span>${stats.reserved} reserv.</div>
        <div class="stat-chip"><span class="dot dot-paid"></span>${stats.paid} pagas</div>
      `;

      renderTable();
    } catch (err) {
      showErr(err.message);
    }
  }

  function renderTable() {
    const q = $("searchInput").value.toLowerCase();
    const st = $("filterStatus").value;
    const rows = allRows.filter(t => {
      if (st && t.status !== st) return false;
      if (q) {
        const hay = `${t.number} ${t.buyer_name||""} ${t.buyer_phone||""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (!rows.length) {
      $("ticketTbody").innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">Nenhuma cota encontrada.</td></tr>`;
      return;
    }

    $("ticketTbody").innerHTML = rows.map(t => `
      <tr>
        <td><strong>${t.number}</strong></td>
        <td><span class="badge badge-${t.status}">${t.status === "paid" ? "Paga" : t.status === "reserved" ? "Reservada" : "Disponível"}</span></td>
        <td>${esc(t.buyer_name || "—")}</td>
        <td>${esc(t.buyer_phone || "—")}</td>
        <td>${fmtDate(t.reserved_at)}</td>
        <td style="white-space:nowrap;display:flex;gap:6px;padding:6px 10px">
          ${t.status === "reserved" ? `<button class="btn btn-sm btn-green" data-action="pagar" data-n="${t.number}">✅ Pago</button>` : ""}
          ${t.status !== "available" ? `<button class="btn btn-sm btn-red" data-action="cancelar" data-n="${t.number}">✖ Cancelar</button>` : ""}
        </td>
      </tr>
    `).join("");
  }

  $("searchInput").addEventListener("input", renderTable);
  $("filterStatus").addEventListener("change", renderTable);
  $("btnRefresh").addEventListener("click", loadTickets);

  $("ticketTbody").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, n } = btn.dataset;
    const label = action === "pagar" ? "marcar como PAGO" : "CANCELAR";
    if (!confirm(`Deseja ${label} a cota #${n}?`)) return;
    btn.disabled = true;
    try {
      const r = await fetch(`/api/admin/tickets/${n}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      showSuccess(`Cota #${n} atualizada.`);
      await loadTickets();
    } catch (err) {
      showErr(err.message);
      btn.disabled = false;
    }
  });

  // ── Sortear ───────────────────────────────────────────────────────
  $("btnSortear").addEventListener("click", async () => {
    const paidCount = allRows.filter(t => t.status === "paid").length;
    if (!confirm(`Realizar sorteio agora?\n${paidCount} cota(s) pagas participam. Esta ação é irreversível.`)) return;
    $("btnSortear").disabled = true;
    try {
      const loteria = Number($("loteriaInput").value) || undefined;
      const r = await fetch("/api/admin/sortear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loteria ? { loteria_number: loteria } : {}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      $("winnerBannerAdmin").style.display = "block";
      $("winnerInfoAdmin").textContent = `Vencedor: Cota #${d.winner.number} — ${d.winner.buyer_name} (${d.winner.buyer_phone})`;
      showSuccess(`🏆 Sorteio realizado! Cota #${d.winner.number} — ${d.winner.buyer_name}`);
    } catch (err) {
      showErr(err.message);
      $("btnSortear").disabled = false;
    }
  });

  function showErr(msg) {
    const d = $("adminError");
    d.textContent = msg;
    d.style.display = "block";
    setTimeout(() => { d.style.display = "none"; }, 5000);
  }
  function showSuccess(msg) {
    const d = $("adminSuccess");
    d.textContent = msg;
    d.style.display = "block";
    setTimeout(() => { d.style.display = "none"; }, 4000);
  }
})();
