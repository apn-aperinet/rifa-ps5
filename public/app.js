(function () {
  "use strict";

  const PRICE = 25;
  let allTickets = [];
  let selected = new Set();

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  function fmt(n) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
  }

  function renderGrid() {
    const grid = $("ticketGrid");
    grid.innerHTML = allTickets.map((t) => {
      const cls = selected.has(t.number) ? "ticket selected" : `ticket ${t.status}`;
      const title = t.status === "reserved" ? "Reservada" : t.status === "paid" ? "Paga" : `Cota ${t.number}`;
      return `<div class="${cls}" data-n="${t.number}" title="${title}">${t.number}</div>`;
    }).join("");
  }

  function updateForm() {
    const count = selected.size;
    $("selCount").textContent = count > 0 ? `${count} selecionada${count > 1 ? "s" : ""}` : "";
    $("formSection").style.display = count > 0 ? "block" : "none";
    $("totalAmount").textContent = fmt(count * PRICE);

    if (count > 0) {
      const nums = [...selected].sort((a,b)=>a-b);
      $("selectedPreview").innerHTML = nums.map(n => `<span class="num">${n}</span>`).join(" ");
    }
  }

  async function load() {
    try {
      const [raffle, tickets] = await Promise.all([
        fetch("/api/raffle").then(r => r.json()),
        fetch("/api/tickets").then(r => r.json()),
      ]);

      if (raffle.error) throw new Error(raffle.error);

      $("prizeDesc").textContent = raffle.prize_description || "PS5 Slim + GTA VI";
      $("statAvail").textContent = raffle.stats.available;
      $("statRes").textContent   = raffle.stats.reserved;
      $("statPaid").textContent  = raffle.stats.paid;

      if (raffle.winner_ticket) {
        $("winnerSection").style.display = "block";
        $("winnerInfo").textContent = `Cota ${raffle.winner_ticket} — ${raffle.winner_name}`;
      }

      const min = Number(raffle.min_tickets_to_draw) || 0;
      const paid = raffle.stats.paid;
      if (min > 0 && !raffle.winner_ticket) {
        const pct = Math.min(100, Math.round((paid / min) * 100));
        const falta = Math.max(0, min - paid);
        $("progressSection").style.display = "block";
        const bar = $("progressBar");
        bar.style.width = pct + "%";
        if (pct >= 100) bar.classList.add("complete");
        $("progressLabel").textContent = `${paid} de ${min} confirmadas`;
        $("progressMsg").textContent = pct >= 100
          ? "Mínimo atingido. O sorteio pode ser realizado."
          : `Faltam ${falta} cota${falta !== 1 ? "s" : ""} confirmada${falta !== 1 ? "s" : ""} para garantir o sorteio.`;
      }

      allTickets = tickets;
      renderGrid();
    } catch (err) {
      $("ticketGrid").innerHTML = `<div class="alert alert-error">Erro ao carregar: ${esc(String(err))}</div>`;
    }
  }

  $("ticketGrid").addEventListener("click", (e) => {
    const tile = e.target.closest(".ticket");
    if (!tile) return;
    const n = Number(tile.dataset.n);
    const t = allTickets.find(x => x.number === n);
    if (!t || t.status !== "available") return;

    if (selected.has(n)) {
      selected.delete(n);
    } else {
      if (selected.size >= 20) {
        alert("Máximo de 20 cotas por vez.");
        return;
      }
      selected.add(n);
    }
    renderGrid();
    updateForm();
  });

  $("btnReservar").addEventListener("click", async () => {
    const btn = $("btnReservar");
    const errDiv = $("formError");
    errDiv.style.display = "none";

    const name  = $("inputName").value.trim();
    const phone = $("inputPhone").value.trim();
    const email = $("inputEmail").value.trim();

    if (!name)  { showErr("Por favor informe seu nome."); return; }
    if (!phone) { showErr("Por favor informe seu WhatsApp."); return; }
    if (selected.size === 0) { showErr("Selecione ao menos uma cota."); return; }

    btn.disabled = true;
    btn.textContent = "Aguarde...";

    try {
      const res = await fetch("/api/reservar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, email, tickets: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao reservar");
      window.location.href = `/pagamento.html?token=${data.token}`;
    } catch (err) {
      showErr(err.message);
      btn.disabled = false;
      btn.textContent = "🛒 Reservar cotas e ver PIX";
      await load();
      selected = new Set([...selected].filter(n => allTickets.find(t => t.number===n && t.status==="available")));
      updateForm();
    }
  });

  function showErr(msg) {
    const d = $("formError");
    d.textContent = msg;
    d.style.display = "block";
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  load();
})();
