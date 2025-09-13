// nlp-service/api/parse.js
// External NLP parser for Shopify chatbot.
// Produces camelCase fields expected by your Remix app.

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 1200);

async function handler(req, res) {
    try {
        if ((req.method || "").toUpperCase() !== "POST") {
            return res.status(405).json({ error: "Method Not Allowed" });
        }

        // Bearer auth
        const secret = process.env.NLP_SECRET || "";
        const auth = req.headers?.authorization || "";
        if (secret && auth !== `Bearer ${secret}`) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        // Safe body parse (raw stream compatible)
        let body = req.body;
        if (!body || typeof body === "string") {
            const raw =
                typeof body === "string"
                    ? body
                    : await new Promise((resolve) => {
                        const chunks = [];
                        req.on("data", (c) => chunks.push(Buffer.from(c)));
                        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
                        req.on("error", () => resolve(""));
                    });
            try {
                body = raw ? JSON.parse(raw) : {};
            } catch {
                body = {};
            }
        }

        const text = String(body?.text || "");
        const locale = String(body?.locale || "auto");
        const shop = String(body?.shop || "");
        const sessionId = String(body?.session_id || body?.sessionId || "");

        // If no OpenAI key, use a simple heuristic fallback but still return camelCase.
        if (!OPENAI_API_KEY) {
            const stub = heuristicParse(text);
            return res.status(200).json(stub);
        }

        // Call OpenAI to extract structured signals
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

        const sys = [
            "You parse noisy e-commerce chat in Chinese/English.",
            "Return ONLY a compact JSON object, no extra text.",
            "Goal: decide if the user wants shopping (SHOP) or small-talk (CHAT),",
            "and extract query terms, tags, price window, attributes.",
            "Keys (camelCase):",
            "mode: 'SHOP' | 'CHAT'",
            "modeConfidence: number 0..1",
            "queryTerms: string[] (up to 6, lowercased keywords, fuzzy-friendly)",
            "includeTags: string[] (e.g. ['gender:female','region:Taiwan'])",
            "excludeTags: string[]",
            "minPrice: number | null   (shop currency amount, no symbol)",
            "maxPrice: number | null",
            "brand: string | null",
            "productType: string | null",
            "color: string | null",
            "size: string | null",
            "material: string | null",
            "sort: 'POPULAR' | 'NEW' | 'PRICE_ASC' | 'PRICE_DESC'",
            "blockCategories: string[]",
            "rewriteHint: string | null (a short, friendly, on-brand reply hint)",
            "embedding: null",
            "Also duplicate snake_case keys for compatibility."
        ].join("\n");

        const user = JSON.stringify({ text, locale, shop, sessionId });

        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: DEFAULT_MODEL,
                temperature: 0,
                messages: [
                    { role: "system", content: sys },
                    { role: "user", content: user },
                ],
                response_format: { type: "json_object" },
            }),
            signal: controller.signal,
        }).finally(() => clearTimeout(to));

        if (!resp.ok) {
            const txt = await safeText(resp);
            const fallback = heuristicParse(text);
            fallback.error = `openai_error_${resp.status}`;
            fallback.debug = txt?.slice(0, 500) || "";
            return res.status(200).json(fallback);
        }

        const data = await resp.json();
        const raw = safeJson(data?.choices?.[0]?.message?.content) || {};

        // Shape + defaults + dual-case
        const out = normalizeToCamel(raw, text);

        return res.status(200).json(out);
    } catch (e) {
        const fallback = heuristicParse("");
        fallback.error = "handler_exception";
        return res.status(200).json(fallback);
    }
}

/* -------------------- helpers -------------------- */

function heuristicParse(text) {
    const isShop = /(买|購|购|推荐|禮物|礼物|gift|buy|size|color|颜色|价格|便宜|贵)/i.test(text);
    const mode = isShop ? "SHOP" : "CHAT";
    const base = {
        mode,
        modeConfidence: isShop ? 0.8 : 0.6,
        queryTerms: [],
        includeTags: [],
        excludeTags: [],
        minPrice: null,
        maxPrice: null,
        brand: null,
        productType: null,
        color: null,
        size: null,
        material: null,
        sort: "POPULAR",
        blockCategories: [],
        rewriteHint: null,
        embedding: null,
    };
    // duplicate snake_case for compatibility (harmless)
    return withSnakeCase(base);
}

function normalizeToCamel(raw, originalText) {
    const pick = (k, d = null) => {
        if (raw == null) return d;
        if (raw[k] !== undefined) return raw[k];
        // also accept snake_case input
        const sk = toSnake(k);
        if (raw[sk] !== undefined) return raw[sk];
        return d;
    };

    const obj = {
        mode: pick("mode", "CHAT"),
        modeConfidence: numOr(pick("modeConfidence"), 0.6),
        queryTerms: arrOr(pick("queryTerms"), []),
        includeTags: arrOr(pick("includeTags"), []),
        excludeTags: arrOr(pick("excludeTags"), []),
        minPrice: numOr(pick("minPrice"), null),
        maxPrice: numOr(pick("maxPrice"), null),
        brand: strOr(pick("brand"), null),
        productType: strOr(pick("productType"), null),
        color: strOr(pick("color"), null),
        size: strOr(pick("size"), null),
        material: strOr(pick("material"), null),
        sort: strOr(pick("sort"), "POPULAR"),
        blockCategories: arrOr(pick("blockCategories"), []),
        rewriteHint: strOr(pick("rewriteHint"), null),
        embedding: null,
    };

    // safety clamps
    const validSort = new Set(["POPULAR", "NEW", "PRICE_ASC", "PRICE_DESC"]);
    if (!validSort.has(obj.sort)) obj.sort = "POPULAR";
    if (obj.minPrice != null && obj.maxPrice != null && obj.minPrice > obj.maxPrice) {
        const t = obj.minPrice;
        obj.minPrice = obj.maxPrice;
        obj.maxPrice = t;
    }

    // duplicate snake_case for backward compatibility
    return withSnakeCase(obj);
}

function withSnakeCase(o) {
    return {
        ...o,
        mode_confidence: o.modeConfidence,
        query_terms: o.queryTerms,
        include_tags: o.includeTags,
        exclude_tags: o.excludeTags,
        min_price: o.minPrice,
        max_price: o.maxPrice,
        product_type: o.productType,
        block_categories: o.blockCategories,
        rewrite_hint: o.rewriteHint,
    };
}

function toSnake(camel) {
    return camel.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}
function numOr(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
}
function strOr(v, d) {
    if (v == null) return d;
    const s = String(v).trim();
    return s ? s : d;
}
function arrOr(v, d) {
    return Array.isArray(v) ? v.slice(0, 8) : d;
}
async function safeText(r) {
    try {
        return await r.text();
    } catch {
        return "";
    }
}
function safeJson(s) {
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

/* export handlers for both module systems */
export default handler;
try {
    module.exports = handler;
} catch { }
