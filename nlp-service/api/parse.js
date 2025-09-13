// nlp-service/api/parse.js
async function handler(req, res) {
    try {
        if ((req.method || '').toUpperCase() !== 'POST') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }
        const secret = process.env.NLP_SECRET || '';
        const auth = req.headers?.authorization || '';
        if (secret && auth !== `Bearer ${secret}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        let body = req.body;
        if (!body || typeof body === 'string') {
            const raw = typeof body === 'string'
                ? body
                : await new Promise((resolve) => {
                    const chunks = [];
                    req.on('data', (c) => chunks.push(Buffer.from(c)));
                    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                    req.on('error', () => resolve(''));
                });
            try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
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
            explanations: ['stub']
        });
    } catch {
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
}
export default handler;
try { module.exports = handler; } catch { }
