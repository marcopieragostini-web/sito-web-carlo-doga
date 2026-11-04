// Vetrina app: foto caricate dal pannello, compresse nel browser e salvate su Netlify Blobs.
// GET  ?k=ID   -> restituisce l'immagine (con cache lunga nel browser)
// POST {d:"data:image/...;base64,..."} -> richiede il token amministratore (ADMIN_TOKEN)
import { getStore } from "@netlify/blobs";

const MAX = 2 * 1024 * 1024; // immagine già compressa: max 2 MB
const TIPI = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

const J = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" },
  });

export default async (req) => {
  const store = getStore("vetrina");

  if (req.method === "GET") {
    const k = new URL(req.url).searchParams.get("k") || "";
    if (!/^[a-f0-9]{16}$/.test(k)) return new Response("", { status: 404 });
    const r = await store.getWithMetadata("img/" + k, { type: "arrayBuffer" });
    if (!r) return new Response("", { status: 404 });
    return new Response(r.data, {
      headers: {
        "content-type": (r.metadata && r.metadata.type) || "image/jpeg",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }
  if (req.method !== "POST") return J({ ok: false, err: "metodo" }, 405);

  const tok = (process.env.ADMIN_TOKEN || "").trim();
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!tok || auth !== tok) return J({ ok: false, err: "token" }, 401);

  const testo = await req.text();
  if (testo.length > MAX * 1.4) return J({ ok: false, err: "pesante" }, 413);
  let b;
  try { b = JSON.parse(testo); } catch (e) { return J({ ok: false, err: "json" }, 400); }

  const m = TIPI.exec(String(b.d || ""));
  if (!m) return J({ ok: false, err: "formato" }, 400);
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX) return J({ ok: false, err: "pesante" }, 413);

  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await store.set("img/" + id, buf, { metadata: { type: m[1] } });
  return J({ ok: true, url: "/.netlify/functions/img?k=" + id });
};
