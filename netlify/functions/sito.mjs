// Vetrina app: legge e salva il contenuto del sito su Netlify Blobs.
// GET  -> restituisce { v, d } (l'ultima versione pubblicata)
// POST -> richiede il token amministratore (variabile ADMIN_TOKEN su Netlify)
import { getStore } from "@netlify/blobs";

const MAX = 5.5 * 1024 * 1024; // limite prudenziale del corpo richiesta

const J = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" },
  });

function pulito(d) {
  if (!d || typeof d !== "object" || !d.cfg || typeof d.cfg !== "object") return null;
  if (!Array.isArray(d.apps) || d.apps.length > 30) return null;
  return {
    cfg: d.cfg,
    apps: d.apps,
    lavori: Array.isArray(d.lavori) ? d.lavori.slice(0, 20) : [],
    extra: d.extra && typeof d.extra === "object" ? d.extra : {},
    tema: d.tema && typeof d.tema === "object" ? d.tema : {},
  };
}

export default async (req) => {
  const store = getStore("vetrina");

  if (req.method === "GET") {
    const c = await store.get("config", { type: "json" });
    // ?v=1 -> solo il numero di versione (risposta minuscola per il controllo ad ogni visita)
    if (new URL(req.url).searchParams.has("v")) return J({ v: c ? c.v : 0 });
    return J(c || { v: 0, d: null });
  }
  if (req.method !== "POST") return J({ ok: false, err: "metodo" }, 405);

  const tok = (process.env.ADMIN_TOKEN || "").trim();
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!tok || auth !== tok) return J({ ok: false, err: "token" }, 401);

  const testo = await req.text();
  if (testo.length > MAX) return J({ ok: false, err: "pesante" }, 413);

  let b;
  try {
    b = JSON.parse(testo);
  } catch (e) {
    return J({ ok: false, err: "json" }, 400);
  }
  if (b.a === "ping") return J({ ok: true });
  if (b.a !== "put") return J({ ok: false, err: "azione" }, 400);

  const d = pulito(b.d);
  if (!d) return J({ ok: false, err: "dati" }, 400);

  const v = Date.now();
  await store.setJSON("config", { v, d });
  return J({ ok: true, v });
};
