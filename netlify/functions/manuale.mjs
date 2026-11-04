// Vetrina app: manuali in PDF su Netlify Blobs.
// GET  ?k=ID               -> PDF per il lettore del sito (anteprima)
// GET  ?k=ID&g=GRANT&dl=1  -> download del PDF completo, solo con un permesso valido
// POST {d:"data:application/pdf;base64,..."}           -> carica un PDF (token amministratore)
// POST {a:"codice", n, max} / {a:"elenco"} / {a:"revoca", c} -> gestione codici (token amministratore)
// POST {a:"sblocca", k, c}  -> il visitatore inserisce un codice oppure la password amministratore
import { getStore } from "@netlify/blobs";

const MAX = 4 * 1024 * 1024; // PDF massimo 4 MB (il limite delle funzioni Netlify è 6 MB per richiesta)
const TIPO = /^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/;
const ALFA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PERMESSO_MIN = 30; // minuti di validità del permesso di download

const J = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" },
  });

function uguali(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function codice() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  let s = "";
  for (const x of b) s += ALFA[x % ALFA.length];
  return s;
}
const tokenAdmin = () => (process.env.ADMIN_TOKEN || "").trim();
const portatore = (req) => (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
const leggiCodici = async (store) => (await store.get("codici", { type: "json" })) || [];

async function sblocca(store, b) {
  const k = String(b.k || "");
  const cr = String(b.c || "").trim();
  if (!/^[a-f0-9]{16}$/.test(k) || !cr) return J({ ok: false, err: "dati" }, 400);
  const admin = tokenAdmin();
  if (!(admin && uguali(cr, admin))) {
    const L = await leggiCodici(store);
    const cu = cr.toUpperCase();
    const i = L.findIndex((x) => x.c === cu);
    if (i < 0 || L[i].usi >= L[i].max) return J({ ok: false, err: "codice" }, 403);
    L[i].usi++;
    await store.setJSON("codici", L);
  }
  const g = crypto.randomUUID().replace(/-/g, "");
  await store.setJSON("grant/" + g, { k, exp: Date.now() + PERMESSO_MIN * 60 * 1000 });
  return J({ ok: true, g });
}

export default async (req) => {
  const store = getStore("vetrina");

  if (req.method === "GET") {
    const url = new URL(req.url);
    const k = url.searchParams.get("k") || "";
    if (!/^[a-f0-9]{16}$/.test(k)) return new Response("", { status: 404 });
    const dl = url.searchParams.get("dl") === "1";
    if (dl) {
      const g = url.searchParams.get("g") || "";
      const p = /^[a-f0-9]{32}$/.test(g) ? await store.get("grant/" + g, { type: "json" }) : null;
      if (!p || p.k !== k || p.exp < Date.now())
        return new Response("Permesso scaduto: inserisci di nuovo il codice.", { status: 403 });
    }
    const r = await store.getWithMetadata("pdf/" + k, { type: "arrayBuffer" });
    if (!r) return new Response("", { status: 404 });
    return new Response(r.data, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": dl ? 'attachment; filename="manuale.pdf"' : "inline",
        "cache-control": dl ? "private, no-store" : "private, max-age=3600",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }
  if (req.method !== "POST") return J({ ok: false, err: "metodo" }, 405);

  const testo = await req.text();
  if (testo.length > MAX * 1.4) return J({ ok: false, err: "pesante" }, 413);
  let b;
  try { b = JSON.parse(testo); } catch (e) { return J({ ok: false, err: "json" }, 400); }

  if (b.a === "sblocca") return sblocca(store, b);

  const admin = tokenAdmin();
  if (!admin || !uguali(portatore(req), admin)) return J({ ok: false, err: "token" }, 401);

  if (b.a === "codice") {
    const L = await leggiCodici(store);
    const c = codice();
    L.push({
      c,
      n: String(b.n || "").slice(0, 80),
      creato: new Date().toISOString().slice(0, 10),
      usi: 0,
      max: Math.min(10, Math.max(1, Math.round(+b.max || 3))),
    });
    await store.setJSON("codici", L);
    return J({ ok: true, c });
  }
  if (b.a === "elenco") return J({ ok: true, codici: await leggiCodici(store) });
  if (b.a === "revoca") {
    const L = (await leggiCodici(store)).filter((x) => x.c !== String(b.c || ""));
    await store.setJSON("codici", L);
    return J({ ok: true });
  }

  // caricamento PDF
  const m = TIPO.exec(String(b.d || ""));
  if (!m) return J({ ok: false, err: "formato" }, 400);
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > MAX) return J({ ok: false, err: "pesante" }, 413);
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await store.set("pdf/" + id, buf, { metadata: { type: "application/pdf" } });
  return J({ ok: true, k: id });
};
