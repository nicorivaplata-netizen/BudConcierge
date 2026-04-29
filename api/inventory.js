// api/inventory.js — Vercel serverless function
// Fetches live dispensary inventory via Apify Dutchie scraper

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR_ID = 'tfmcg3~dutchie-dispensary-scraper';

const cache = {};
const CACHE_TTL = 4 * 60 * 60 * 1000;

const DISPENSARIES = {
  'high-profile-pineville':      { name: 'High Profile — Pineville, MO',        brand: 'High Profile',   url: 'https://dutchie.com/dispensary/high-profile-pineville' },
  'mo-chesterfield-hp':          { name: 'High Profile — Chesterfield, MO',     brand: 'High Profile',   url: 'https://dutchie.com/dispensary/mo-chesterfield-hp' },
  'mo-columbia-hp':              { name: 'High Profile — Columbia, MO',         brand: 'High Profile',   url: 'https://dutchie.com/dispensary/mo-columbia-hp' },
  'high-profile-cape-girardeau': { name: 'High Profile — Cape Girardeau, MO',   brand: 'High Profile',   url: 'https://dutchie.com/dispensary/high-profile-cape-girardeau' },
  'story-dunlap':                { name: 'Story Cannabis — Phoenix, AZ',         brand: 'Story Cannabis', url: 'https://dutchie.com/dispensary/story-dunlap' },
  'story-mechanicsville':        { name: 'Story Cannabis — Mechanicsville, MD',  brand: 'Story Cannabis', url: 'https://dutchie.com/dispensary/story-mechanicsville' },
  'story-cleveland':             { name: 'Story Cannabis — Cleveland, OH',       brand: 'Story Cannabis', url: 'https://dutchie.com/dispensary/story-cleveland' },
  'purspirit-fayetteville':      { name: 'PurSpirit — Fayetteville, AR',         brand: 'PurSpirit',      url: 'https://dutchie.com/dispensary/purspirit-fayetteville' },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { slug } = req.query;

  if (!slug) return res.status(400).json({ error: 'Missing dispensary slug' });
  if (!DISPENSARIES[slug]) return res.status(404).json({ error: `Unknown dispensary: ${slug}` });
  if (!APIFY_TOKEN) return res.status(500).json({ error: 'APIFY_TOKEN not configured' });

  const cached = cache[slug];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.status(200).json({ ...cached.data, fromCache: true });
  }

  const dispensary = DISPENSARIES[slug];

  try {
    const apifyRes = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Pass full URL and slug — actor may use either
          startUrls: [{ url: dispensary.url }],
          dispensarySlug: slug,
          dispensaryUrl: dispensary.url,
          maxItems: 200,
          includeOutOfStock: false,
          // Enable residential proxy to bypass Cloudflare on Dutchie
          proxyConfiguration: {
            useApifyProxy: true,
            apifyProxyGroups: ['RESIDENTIAL'],
          },
        }),
      }
    );

    if (!apifyRes.ok) {
      const err = await apifyRes.text();
      console.error('Apify error:', apifyRes.status, err);
      return res.status(502).json({ error: `Apify returned ${apifyRes.status}: ${err}` });
    }

    const items = await apifyRes.json();
    console.log(`Got ${items.length} items for ${slug}`);

    const inventory = items
      .filter(item => item.product && item.price != null)
      .map(item => ({
        name:     item.product?.name || item.name || '',
        brand:    item.product?.brand?.name || item.brand || '',
        category: item.product?.category || item.category || '',
        type:     item.product?.strainType || item.strainType || '',
        thc:      formatCannabinoid(item.product?.cannabinoids?.thcContent) || item.thc || '',
        cbd:      formatCannabinoid(item.product?.cannabinoids?.cbdContent) || item.cbd || '',
        price:    item.price,
        effects:  (item.product?.effects || item.effects || []).slice(0, 5),
        terpenes: (item.product?.terpenes || item.terpenes || []).slice(0, 4),
      }))
      .filter(p => p.name);

    const result = {
      dispensary: dispensary.name,
      brand:      dispensary.brand,
      slug,
      count:      inventory.length,
      rawCount:   items.length,
      inventory,
      fetchedAt:  new Date().toISOString(),
    };

    cache[slug] = { data: result, timestamp: Date.now() };
    return res.status(200).json(result);

  } catch (err) {
    console.error('Inventory fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
}

function formatCannabinoid(cannabinoid) {
  if (!cannabinoid?.range) return '';
  const [min, max] = cannabinoid.range;
  const unit = cannabinoid.unit || '%';
  return min === max ? `${min}${unit}` : `${min}-${max}${unit}`;
}
