// api/inventory.js — Vercel serverless function
// Fetches live dispensary inventory via Apify Weedmaps scraper
// Switched from Dutchie (Cloudflare blocked) to Weedmaps (proven, 42 users)

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const WEEDMAPS_ACTOR = 'kinaesthetic_millionaire~weedmaps-dispensaries-products';

const cache = {};
const CACHE_TTL = 4 * 60 * 60 * 1000;

const DISPENSARIES = {
  'high-profile-pineville':      { name: 'High Profile — Pineville, MO',        brand: 'High Profile',   wmSlug: 'high-profile-pineville' },
  'mo-chesterfield-hp':          { name: 'High Profile — Chesterfield, MO',     brand: 'High Profile',   wmSlug: 'high-profile-chesterfield' },
  'mo-columbia-hp':              { name: 'High Profile — Columbia, MO',         brand: 'High Profile',   wmSlug: 'high-profile-46' },
  'high-profile-cape-girardeau': { name: 'High Profile — Cape Girardeau, MO',   brand: 'High Profile',   wmSlug: 'high-profile-cape-girardeau' },
  'story-dunlap':                { name: 'Story Cannabis — Phoenix, AZ',         brand: 'Story Cannabis', wmSlug: 'story-dunlap' },
  'story-mechanicsville':        { name: 'Story Cannabis — Mechanicsville, MD',  brand: 'Story Cannabis', wmSlug: 'story-mechanicsville' },
  'story-cleveland':             { name: 'Story Cannabis — Cleveland, OH',       brand: 'Story Cannabis', wmSlug: 'story-cleveland' },
  'purspirit-fayetteville':      { name: 'PurSpirit — Fayetteville, AR',         brand: 'PurSpirit',      wmSlug: 'purspirit-cannabis-co' },
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
  const wmUrl = `https://weedmaps.com/dispensaries/${dispensary.wmSlug}`;

  try {
    const apifyRes = await fetch(
      `https://api.apify.com/v2/acts/${WEEDMAPS_ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls: [{ url: wmUrl }],
          maxItems: 200,
        }),
      }
    );

    if (!apifyRes.ok) {
      const err = await apifyRes.text();
      console.error('Apify Weedmaps error:', apifyRes.status, err);
      return res.status(502).json({ error: `Apify returned ${apifyRes.status}: ${err}` });
    }

    const items = await apifyRes.json();
    console.log(`Got ${items.length} raw items for ${slug} from Weedmaps`);

    // Weedmaps scraper returns product data directly
    const inventory = items
      .filter(item => item.name)
      .map(item => ({
        name:     item.name || '',
        brand:    item.brand || item.brandName || '',
        category: item.category || item.type || '',
        type:     item.strainType || item.strain_type || '',
        thc:      item.thc || item.thcContent || '',
        cbd:      item.cbd || item.cbdContent || '',
        price:    item.price || item.priceHalf || '',
        effects:  (item.effects || []).slice(0, 5),
        terpenes: (item.terpenes || []).slice(0, 4),
      }));

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
