// Vetrina app: tetto giornaliero condiviso per la "Prova app" (secondi al giorno, per tutti i visitatori).
// POST {a:"apri"}          -> quanti secondi restano oggi
// POST {a:"usa", s:NUMERO} -> registra i secondi effettivamente usati
// Il limite è in EXTRA.sec.prova.quota (0 = nessun limite). Si azzera ogni giorno (fuso di Roma).
import { getStore } from "@netlify/blobs";

const J = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" },
  });

export default async (req) => {
  if (req.method !== "POST") return J({ ok: false, err: "metodo" }, 405);
  const store = getStore("vetrina");
  let b;
  try { b = JSON.parse(await req.text()); } catch (e) { return J({ ok: false, err: "json" }, 400); }

  const c = await store.get("config", { type: "json" });
  const sec = (c && c.d && c.d.extra && c.d.extra.sec) || {};
  const lim = Math.max(0, Math.round(+((sec.prova && sec.prova.quota) || 0)));
  const giorno = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
  const key = "quota/" + giorno;
  const cur = (await store.get(key, { type: "json" })) || { s: 0 };
  const rimasti = lim > 0 ? Math.max(0, lim - cur.s) : 999999;

  if (b.a === "apri") return J({ ok: true, rimasti, limite: lim });
  if (b.a !== "usa") return J({ ok: false, err: "azione" }, 400);

  const add = Math.min(240, Math.max(0, Math.round(+b.s || 0)));
  const preso = Math.min(add, rimasti);
  if (preso > 0) { cur.s += preso; await store.setJSON(key, cur); }
  return J({ ok: true, registrati: preso, rimasti: Math.max(0, rimasti - preso), limite: lim });
};
