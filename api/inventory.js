// api/inventory.js — Vercel serverless function
// Fetches live dispensary inventory via Apify Dutchie scraper

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR_ID = 'tfmcg3~dutchie-dispensary-scraper';

const cache = {};
const CACHE_TTL = 4 * 60 * 60 * 1000;

const DISPENSARIES = {
  'high-profile-pineville':      { name: 'High Profile — Pineville, MO',        brand: 'High Profile'  },
  'mo-chesterfield-hp':          { name: 'High Profile — Chesterfield, MO',     brand: 'High Profile'  },
  'mo-columbia-hp':              { name: 'High Profile — Columbia, MO',         brand: 'High Profile'  },
  'high-profile-cape-girardeau': { name: 'High Profile — Cape Girardeau, MO',   brand: 'High Profile'  },
  'story-dunlap':                { name: 'Story Cannabis — Phoenix, AZ',         brand: 'Story Cannabis'},
  'story-mechanicsville':        { name: 'Story Cannabis — Mechanicsville, MD',  brand: 'Story Cannabis'},
  'story-cleveland':             { name: 'Story Cannabis — Cleveland, OH',       brand: 'Story Cannabis'},
  'purspirit-fayetteville':      { name: 'PurSpirit — Fayetteville, AR',         brand: 'PurSpirit'    },
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

  try {
    const apifyRes = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=90`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dispensarySlug: slug,
          maxItems: 200,
          includeOutOfStock: false,
        }),
      }
    );

    if (!apifyRes.ok) {
      const err = await apifyRes.text();
      console.error('Apify error:', apifyRes.status, err);
      return res.status(502).json({ error: `Apify returned ${apifyRes.status}` });
    }

    const items = await apifyRes.json();

    const inventory = items
      .filter(item => item.product && item.price != null)
      .map(item => ({
        name:     item.product?.name || '',
        brand:    item.product?.brand?.name || '',
        category: item.product?.category || '',
        type:     item.product?.strainType || '',
        thc:      formatCannabinoid(item.product?.cannabinoids?.thcContent),
        cbd:      formatCannabinoid(item.product?.cannabinoids?.cbdContent),
        price:    item.price,
        effects:  (item.product?.effects || []).slice(0, 5),
        terpenes: (item.product?.terpenes || []).slice(0, 4),
      }))
      .filter(p => p.name);

    const result = {
      dispensary: DISPENSARIES[slug].name,
      brand:      DISPENSARIES[slug].brand,
      slug,
      count:      inventory.length,
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
