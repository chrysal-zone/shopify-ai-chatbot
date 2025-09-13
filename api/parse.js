// api/parse.js
// Minimal stub parser for connectivity testing only.

export default function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
    const body = (req.body || {});
    const text = String(body.text || '');
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
}
