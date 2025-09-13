// api/parse.js
// Minimal stub parser for connectivity testing only (CommonJS).

module.exports = async (req, res) => {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Optional bearer auth
    const secret = process.env.NLP_SECRET || '';
    const auth = req.headers.authorization || '';
    if (secret && auth !== `Bearer ${secret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Ensure body is an object
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body || '{}'); } catch { body = {}; }
        }
        if (!body) {
            const chunks = [];
            for await (const c of req) chunks.push(Buffer.from(c));
            const raw = Buffer.concat(chunks).toString('utf8');
            try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
        }

        const text = String(body?.text || '');
        const isShop = /(买|购|推荐|gift|buy|size|color)/i.test(text);

        return res.status(200).json({
            mode: isShop ? 'SHOP' : 'CHAT',
            mode_confidence: isShop ? 0.8 : 0.6,
            query_terms: [],
            include_tags: [],
            exclude_tags: [],
            price: null,
            brand: null,
            product_type: null,
            color: null,
            size: null,
            material: null,
            sort: 'POPULAR',
            block_categories: [],
            rewrite_hint: null,
            embedding: null,
            confidences: { mode: isShop ? 0.8 : 0.6 },
            explanations: ['stub'],
        });
    } catch (e) {
        // Safe fallback; your Shopify app will still work
        return res.status(200).json({
            mode: 'CHAT',
            mode_confidence: 0.5,
            query_terms: [],
            include_tags: [],
            exclude_tags: [],
            price: null,
            brand: null,
            product_type: null,
            color: null,
            size: null,
            material: null,
            sort: 'POPULAR',
            block_categories: [],
            rewrite_hint: null,
            embedding: null,
            confidences: { fallback: 1.0 },
            explanations: ['caught error in stub']
        });
    }
};
