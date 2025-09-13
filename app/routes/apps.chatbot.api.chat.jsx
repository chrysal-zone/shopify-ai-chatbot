// app/routes/apps.chatbot.api.chat.jsx
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// ---- External NLP config (optional) ----
const EXT_NLP_URL = process.env.EXT_NLP_URL ?? "";
const EXT_NLP_KEY = process.env.EXT_NLP_KEY ?? "";
const EXT_NLP_TIMEOUT_MS = Number(process.env.EXT_NLP_TIMEOUT_MS ?? 1800);

// ---- Intent parsing (external with fallback) ----
async function parseIntent(text) {
    const base = fallbackRules(text);
    if (!EXT_NLP_URL) return base;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), EXT_NLP_TIMEOUT_MS);

    try {
        const res = await fetch(EXT_NLP_URL, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(EXT_NLP_KEY ? { authorization: `Bearer ${EXT_NLP_KEY}` } : {}),
            },
            body: JSON.stringify({ text }),
            signal: controller.signal,
        });
        clearTimeout(t);
        if (!res.ok) return base;
        const data = await res.json();
        return {
            queryTerms: data.queryTerms ?? base.queryTerms,
            includeTags: data.includeTags ?? base.includeTags,
            excludeTags: data.excludeTags ?? base.excludeTags,
            minPrice: data.minPrice ?? base.minPrice,
            maxPrice: data.maxPrice ?? base.maxPrice,
            sort: data.sort ?? base.sort,
        };
    } catch {
        clearTimeout(t);
        return base;
    }
}

// ---- Minimal Chinese-friendly heuristic (fallback) ----
function fallbackRules(text) {
    const raw = String(text || "");
    const lower = raw.toLowerCase();

    // stopwords to ignore for recall (both zh/en)
    const STOPWORDS = [
        "hi", "hello", "hey", "ok", "okay", "yes", "no", "yo", "please", "pls",
        "recommend", "recommendation", "recommendations", "suggest", "suggestion",
        "help", "anything", "whatever", "anything works",
        "随便", "随便看看", "推荐", "推荐一下", "推荐下", "给我推荐", "帮推荐", "看看", "看下", "要啥", "买啥", "有啥", "有推荐吗", "推荐么", "整点",
        "你好", "您好", "哈喽", "嗨", "好的", "行", "嗯", "额", "诶", "可以吗", "求推荐", "推荐下呗"
    ];
    const STOP = new Set(STOPWORDS);

    const out = {
        queryTerms: [],
        includeTags: [],
        excludeTags: [],
        sort: "POPULAR", // POPULAR | NEW | PRICE_ASC | PRICE_DESC
    };

    if (/台湾|taiwan/i.test(raw)) out.includeTags.push("region:Taiwan");
    if (/女|female|women/i.test(raw)) out.includeTags.push("gender:female");
    if (/男|male|men/i.test(raw)) out.includeTags.push("gender:male");

    const priceMatch = raw.match(/(\d+)[\s\-~到至]*(\d+)?\s*(?:元|rmb|\$|usd)?/i);
    if (priceMatch) {
        out.minPrice = Number(priceMatch[1]);
        if (priceMatch[2]) out.maxPrice = Number(priceMatch[2]);
    }

    if (/最新|new|上新/i.test(raw)) out.sort = "NEW";
    if (/便宜|低价|价格从低到高|cheap/i.test(raw)) out.sort = "PRICE_ASC";
    if (/贵|高价|价格从高到低|expensive/i.test(raw)) out.sort = "PRICE_DESC";

    // tokenize and drop stopwords
    const terms = lower
        .replace(/[，。,.!?]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .filter(t => !STOP.has(t))
        .slice(0, 8);

    out.queryTerms.push(...terms);

    const noFilters =
        out.queryTerms.length === 0 &&
        out.includeTags.length === 0 &&
        out.excludeTags.length === 0 &&
        !out.minPrice && !out.maxPrice;

    if (noFilters) {
        out.sort = "NEW";
        out.queryTerms = []; // open discovery
    }
    return out;
}

// ---- Build Admin GraphQL query (multi-field OR) ----
function buildAdminQuery(p) {
    let sortKey = "RELEVANCE";
    let reverse = false;
    if (p.sort === "NEW") {
        sortKey = "PUBLISHED_AT";
        reverse = true;
    }
    if (p.sort === "PRICE_ASC" || p.sort === "PRICE_DESC") {
        // price ordering handled locally
        sortKey = "RELEVANCE";
    }

    const termExpr = (p.queryTerms && p.queryTerms.length)
        ? "(" + p.queryTerms.map((t) => {
            const q = escapeQuery(t);
            return [
                `title:*${q}*`,
                `vendor:*${q}*`,
                `product_type:*${q}*`,
                `tag:'${q}'`
            ].join(" OR ");
        }).join(" OR ") + ")"
        : "";

    const tagExprs = [
        ...(p.includeTags || []).map((t) => `tag:'${escapeQuery(t)}'`),
        ...(p.excludeTags || []).map((t) => `-tag:'${escapeQuery(t)}'`)
    ];
    const tagPart = tagExprs.join(" AND ");

    const parts = [termExpr, tagPart, "status:active"].filter(Boolean);
    const query = parts.join(" AND ");

    return { query, sortKey, reverse };
}

function escapeQuery(s) {
    return String(s || "").replace(/'/g, "\\'");
}

// ---- Mode classification & reply formatting ----
function classifyMode(text, parsed) {
    const t = String(text || "").toLowerCase();

    const helpHits = /(refund|return|exchange|order|shipping|delivery|track|policy|客服|退货|换货|物流|快递|订单|政策)/i.test(t);
    if (helpHits) return "HELP";

    const hasFilters = (parsed.queryTerms?.length || 0) > 0 ||
        (parsed.includeTags?.length || 0) > 0 ||
        (parsed.excludeTags?.length || 0) > 0 ||
        parsed.minPrice || parsed.maxPrice;

    const shopHits = /(buy|gift|recommend|option|size|color|适合|礼物|买|购|推荐|款|尺码|颜色)/i.test(t);
    if (hasFilters || shopHits) return "SHOP";

    return "CHAT";
}

function formatShopReply(picks) {
    const head = "Here are some picks:";
    const lines = picks.slice(0, 5).map((p) => `• ${p.title}`);
    return [head, ...lines].join("\n");
}

function formatChatReply(picks) {
    if (!picks.length) {
        return "Got it. Tell me what you're looking for or your budget, and I can suggest a few options.";
    }
    const head = "I hear you. Here are a few easy picks to browse:";
    const lines = picks.slice(0, 3).map((p) => `• ${p.title}`);
    return [head, ...lines].join("\n");
}

function formatHelpReply() {
    return "Need help with orders, returns, or shipping? I can guide you step by step.";
}

// ---- Per-shop lexicon (auto-learned from the installed store) ----
const STORE_LEXICON_CACHE = new Map(); // key: shop, value: { vendors:Set, types:Set, tags:Set, tokens:Set, ts:number }

async function buildStoreLexicon(admin, shop) {
    const cached = STORE_LEXICON_CACHE.get(shop);
    if (cached && Date.now() - cached.ts < 10 * 60 * 1000) return cached; // 10 min TTL

    const gql = `
    query Lexicon {
      products(first: 200, sortKey: PUBLISHED_AT, reverse: true) {
        nodes {
          title
          vendor
          productType
          tags
          variants(first: 10) { nodes { title sku } }
        }
      }
    }
  `;
    const res = await admin.graphql(gql);
    const data = await res.json();
    const nodes = data?.data?.products?.nodes ?? [];

    const vendors = new Set();
    const types = new Set();
    const tags = new Set();
    const tokens = new Set();

    const pushTokens = (s) => {
        String(s || "")
            .toLowerCase()
            .replace(/[，。,.!?]/g, " ")
            .split(/\s+/)
            .filter(Boolean)
            .forEach((t) => tokens.add(t));
    };

    for (const p of nodes) {
        if (p.vendor) vendors.add(String(p.vendor).toLowerCase());
        if (p.productType) types.add(String(p.productType).toLowerCase());
        for (const t of p.tags || []) tags.add(String(t).toLowerCase());

        pushTokens(p.title);
        for (const v of p.variants?.nodes || []) {
            pushTokens(v.title);
            pushTokens(v.sku);
        }
    }

    const lex = { vendors, types, tags, tokens, ts: Date.now() };
    STORE_LEXICON_CACHE.set(shop, lex);
    return lex;
}

function expandTermsWithLexicon(inputTerms, lex) {
    const setOrEmpty = (s) => (s && typeof s.has === "function" ? s : new Set());
    const { vendors, types, tags, tokens } = {
        vendors: setOrEmpty(lex?.vendors),
        types: setOrEmpty(lex?.types),
        tags: setOrEmpty(lex?.tags),
        tokens: setOrEmpty(lex?.tokens),
    };

    const pool = new Set([...vendors, ...types, ...tags, ...tokens]);

    const near = (a, b) => {
        if (!a || !b) return false;
        if (a.includes(b) || b.includes(a)) return true;
        if (Math.abs(a.length - b.length) > 1) return false;
        let i = 0, j = 0, edits = 0;
        while (i < a.length && j < b.length) {
            if (a[i] === b[j]) { i++; j++; continue; }
            edits++;
            if (edits > 1) return false;
            if (a.length > b.length) i++;
            else if (a.length < b.length) j++;
            else { i++; j++; }
        }
        if (i < a.length || j < b.length) edits++;
        return edits <= 1;
    };

    const expanded = new Set(inputTerms.map(String).map(s => s.toLowerCase()));
    for (const q of inputTerms) {
        for (const cand of pool) {
            if (expanded.size > 24) break; // safety cap
            if (near(String(cand), String(q))) expanded.add(String(cand));
        }
    }
    return Array.from(expanded).slice(0, 24);
}

function dedupeByTitle(list) {
    const seen = new Set();
    const out = [];
    for (const p of list) {
        const key = String(p.title || "").trim().toLowerCase();
        if (!key) continue;
        if (!seen.has(key)) { seen.add(key); out.push(p); }
    }
    return out;
}

// ---- Local ranking with fuzzy matching ----
function rankProducts(products, intent) {
    const now = Date.now();
    const qTerms = (intent?.queryTerms || []).map(String).map(s => s.toLowerCase());

    const nearMatch = (hay, needle) => {
        if (!hay || !needle) return false;
        if (hay.includes(needle)) return true;
        // allow small typos (levenshtein distance <= 1, simplified)
        const a = hay, b = needle;
        if (Math.abs(a.length - b.length) > 1) return false;
        let i = 0, j = 0, edits = 0;
        while (i < a.length && j < b.length) {
            if (a[i] === b[j]) { i++; j++; continue; }
            edits++;
            if (edits > 1) return false;
            if (a.length > b.length) i++;
            else if (a.length < b.length) j++;
            else { i++; j++; }
        }
        if (i < a.length || j < b.length) edits++;
        return edits <= 1;
    };

    const scored = (products || []).map((p) => {
        let score = 0;

        // tag inclusion bonus
        const tags = p.tags || [];
        for (const tag of (intent.includeTags || [])) {
            if (tags.includes(tag)) score += 8;
        }

        // lexical + fuzzy on title/tags/variant titles + vendor/productType
        const titleLower = (p.title || "").toLowerCase();
        const tagStr = tags.join(" ").toLowerCase();
        const variantTitles = (p.variants?.edges || [])
            .map(e => e?.node?.title || "")
            .join(" ")
            .toLowerCase();
        const vendorLower = (p.vendor || "").toLowerCase();
        const typeLower = (p.productType || "").toLowerCase();

        for (const q of qTerms) {
            if (!q) continue;
            const direct =
                titleLower.includes(q) ||
                tagStr.includes(q) ||
                variantTitles.includes(q) ||
                vendorLower.includes(q) ||
                typeLower.includes(q);
            if (direct) {
                score += 5;
            } else if (
                nearMatch(titleLower, q) ||
                nearMatch(variantTitles, q) ||
                nearMatch(vendorLower, q) ||
                nearMatch(typeLower, q)
            ) {
                score += 2.5;
            }
        }

        // recency
        const pub = p.publishedAt || p.createdAt || new Date().toISOString();
        const ageDays = Math.max(1, (now - Date.parse(pub)) / 86400000);
        score += 10 / Math.sqrt(ageDays);

        // price window (use min variant price)
        const prices = (p.variants?.edges || [])
            .map((e) => parseFloat(e?.node?.price ?? "NaN"))
            .filter((n) => Number.isFinite(n));
        const minPrice = prices.length ? Math.min(...prices) : undefined;

        if (Number.isFinite(minPrice)) {
            if (intent.minPrice && minPrice < intent.minPrice - 0.01) score -= 4;
            if (intent.maxPrice && minPrice > intent.maxPrice + 0.01) score -= 4;
        }

        // stock visibility
        const anyAvailable = (p.variants?.edges || []).some(e => e?.node?.availableForSale);
        if (!anyAvailable) score -= 1;

        return { p, score, minPrice, ageDays };
    });

    // primary by score
    scored.sort((a, b) => b.score - a.score);

    // optional explicit price ordering
    if (intent.sort === "PRICE_ASC" || intent.sort === "PRICE_DESC") {
        scored.sort((a, b) => {
            const ap = a.minPrice ?? Number.MAX_SAFE_INTEGER;
            const bp = b.minPrice ?? Number.MAX_SAFE_INTEGER;
            return intent.sort === "PRICE_ASC" ? ap - bp : bp - ap;
        });
    }

    return scored.map((s) => s.p);
}

// ---- Remix action ----
export async function action({ request }) {
    const { admin, session } = await authenticate.public.appProxy(request);
    const shop = session?.shop ?? "unknown";

    let text = "";
    try {
        const body = await request.json();
        text = String(body?.text ?? "").slice(0, 500);
    } catch {
        text = "";
    }
    if (!text) return json({ ok: true, shop, reply: "Echo: (empty)" });

    const parsed = await parseIntent(text);

    // per-shop lexicon and term expansion (auto-learned from this installed store)
    const lexicon = await buildStoreLexicon(admin, shop);
    parsed.queryTerms = expandTermsWithLexicon(parsed.queryTerms || [], lexicon);

    const { query, sortKey, reverse } = buildAdminQuery(parsed);

    // Money scalars only; no contextualPricing (requires context argument).
    const gql = `
    query Products($query: String!, $sortKey: ProductSortKeys!, $reverse: Boolean!) {
      products(query: $query, sortKey: $sortKey, reverse: $reverse, first: 30) {
        edges {
          node {
            id
            title
            handle
            productType
            vendor
            tags
            createdAt
            publishedAt
            images(first: 1) { edges { node { url } } }
            variants(first: 50) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  compareAtPrice
                  availableForSale
                  selectedOptions { name value }
                  image { url }
                }
              }
            }
          }
        }
      }
    }
  `;

    const res = await admin.graphql(gql, { variables: { query, sortKey, reverse } });
    const data = await res.json();
    let products = data?.data?.products?.edges?.map((e) => e.node) ?? [];
    let fallbackUsed = false;

    // fallback: if no result, retry with open discovery on newest (generic)
    if (!products.length) {
        const gqlFallback = `
      query FallbackProducts {
        products(query: "status:active", sortKey: PUBLISHED_AT, reverse: true, first: 30) {
          edges {
            node {
              id
              title
              handle
              productType
              vendor
              tags
              createdAt
              publishedAt
              images(first: 1) { edges { node { url } } }
              variants(first: 50) {
                edges {
                  node {
                    id
                    title
                    sku
                    price
                    compareAtPrice
                    availableForSale
                    selectedOptions { name value }
                    image { url }
                  }
                }
              }
            }
          }
        }
      }
    `;
        const res2 = await admin.graphql(gqlFallback);
        const data2 = await res2.json();
        products = data2?.data?.products?.edges?.map((e) => e.node) ?? [];
        fallbackUsed = true;
    }

    const ranked = rankProducts(products, parsed).slice(0, 12);
    const uniqueRanked = dedupeByTitle(ranked).slice(0, 5);

    const mode = classifyMode(text, parsed);
    let reply;
    if (mode === "SHOP") {
        reply = uniqueRanked.length
            ? formatShopReply(uniqueRanked)
            : "I couldn't find exact matches. Tell me a style, brand, or budget and I’ll refine.";
    } else if (mode === "HELP") {
        reply = formatHelpReply();
    } else {
        reply = formatChatReply(uniqueRanked);
    }

    return json({
        ok: true,
        shop,
        reply,
        debug: {
            parsed,
            query,
            fallbackUsed,
            count: products.length,
            mode,
            expandedTerms: parsed.queryTerms
        }
    });
}
