(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  }

  async function buscar() {
    const phone = $("phoneInput").value.trim();
    if (!phone) return;
    const res = $("result");
    res.innerHTML = '<div class="spinner"></div>';
    try {
      const r = await fetch(`/api/meus-tickets?phone=${encodeURIComponent(phone)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (!data.length) {
        res.innerHTML = '<div class="alert alert-info">Nenhuma cota encontrada para este número.</div>';
        return;
      }
      const rows = data.map(t => `
        <tr>
          <td><strong>${t.number}</strong></td>
          <td><span class="badge badge-${t.status}">${t.status === "paid" ? "Paga" : t.status === "reserved" ? "Reservada" : "Disponível"}</span></td>
          <td>${fmtDate(t.reserved_at)}</td>
          <td>${fmtDate(t.paid_at)}</td>
        </tr>
      `).join("");
      res.innerHTML = `
        <div class="alert alert-success" style="margin-bottom:12px">
          Encontradas <strong>${data.length}</strong> cota(s).
        </div>
        <div style="overflow-x:auto">
          <table>
            <thead><tr><th>Nº</th><th>Status</th><th>Reservado em</th><th>Pago em</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    } catch (err) {
      res.innerHTML = `<div class="alert alert-error">${String(err.message)}</div>`;
    }
  }

  $("btnBuscar").addEventListener("click", buscar);
  $("phoneInput").addEventListener("keydown", (e) => { if (e.key === "Enter") buscar(); });
})();
