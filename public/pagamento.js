(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  function fmt(n) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  }

  const token = new URLSearchParams(window.location.search).get("token");

  async function load() {
    if (!token) {
      showErr("Token de reserva não encontrado. Volte e selecione suas cotas.");
      $("loading").style.display = "none";
      return;
    }
    try {
      const res = await fetch(`/api/reserva/${token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reserva não encontrada");

      $("pixAmount").textContent = fmt(data.total);
      $("pixKeyBox").textContent = data.pix_key || "22241843000112";
      $("ticketsPreview").innerHTML = data.tickets
        .map(t => `<span class="num">${t.number}</span>`)
        .join("");
      $("buyerName").textContent  = data.tickets[0]?.buyer_name || "—";
      $("buyerPhone").textContent = data.tickets[0]?.buyer_phone || "—";
      $("reservedAt").textContent = fmtDate(data.tickets[0]?.reserved_at);

      if (data.pix_link) {
        const lnk = $("pixLink");
        lnk.href = data.pix_link;
        lnk.style.display = "inline-flex";
      }

      const phone = data.tickets[0]?.buyer_phone || "";
      const nums = data.tickets.map(t => t.number).join(", ");
      const msg = encodeURIComponent(`Olá! Acabei de fazer o PIX da Rifa do Play 🎮\nNome: ${data.tickets[0]?.buyer_name}\nCotas: ${nums}\nValor: ${fmt(data.total)}\nSegue o comprovante:`);
      $("whatsappLink").href = `https://wa.me/55${phone.replace(/\D/g,"")}?text=${msg}`;

      $("loading").style.display  = "none";
      $("content").style.display  = "block";
    } catch (err) {
      showErr(err.message);
      $("loading").style.display = "none";
    }
  }

  function showErr(msg) {
    const d = $("alertBox");
    d.className = "alert alert-error";
    d.textContent = msg;
    d.style.display = "block";
    $("content").style.display = "block";
  }

  window.copyKey = function () {
    const key = $("pixKeyBox").textContent.trim();
    navigator.clipboard.writeText(key).then(() => {
      $("copyHint").textContent = "✅ Copiado!";
      setTimeout(() => { $("copyHint").textContent = "Toque para copiar"; }, 2000);
    }).catch(() => {
      $("copyHint").textContent = "Copie manualmente";
    });
  };

  load();
})();
