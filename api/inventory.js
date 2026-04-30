import { readFileSync } from 'fs';
import { join } from 'path';

const DISPENSARIES = {
  'high-profile-pineville':      { name: 'High Profile — Pineville, MO',        brand: 'High Profile',   source: 'static' },
  'mo-chesterfield-hp':          { name: 'High Profile — Chesterfield, MO',     brand: 'High Profile',   source: 'static' },
  'mo-columbia-hp':              { name: 'High Profile — Columbia, MO',         brand: 'High Profile',   source: 'static' },
  'high-profile-cape-girardeau': { name: 'High Profile — Cape Girardeau, MO',   brand: 'High Profile',   source: 'static' },
  'story-dunlap':                { name: 'Story Cannabis — Phoenix, AZ',         brand: 'Story Cannabis', source: 'static' },
  'story-mechanicsville':        { name: 'Story Cannabis — Mechanicsville, MD',  brand: 'Story Cannabis', source: 'static' },
  'story-cleveland':             { name: 'Story Cannabis — Cleveland, OH',       brand: 'Story Cannabis', source: 'static' },
  // Arkansas — iHeartJane (store IDs confirmed from network inspection)
  'purspirit-fayetteville':      { name: 'PurSpirit — Fayetteville, AR',         brand: 'PurSpirit',      source: 'jane', janeStoreId: 3773 },
  'the-hill-fayetteville':       { name: 'The Hill — Fayetteville, AR',          brand: 'The Hill',       source: 'jane', janeStoreId: 4817 },
  // The Source uses a different platform — static JSON for now
  'the-source-rogers':           { name: 'The Source — Rogers, AR',              brand: 'The Source',     source: 'static' },
};

const cache = {};
const CACHE_TTL = 4 * 60 * 60 * 1000;

function parseWeedmapsTitle(title) {
  const result = { name: title, brand: '', category: '', type: '' };
  const lower = title.toLowerCase();

  if (title.includes('|')) {
    const parts = title.split('|').map(p => p.trim());
    result.brand    = parts[0] || '';
    result.name     = parts[1] ? `${parts[1]}${parts[2] ? ' ' + parts[2] : ''}` : title;
    result.category = parts[2] || '';
  } else if (title.includes(' - ')) {
    const parts = title.split(' - ').map(p => p.trim());
    result.brand = parts[0] || '';
    result.name  = parts[1] || title;
    if (parts[2]) {
      const t = parts[2].toLowerCase();
      if (t.includes('indica'))      result.type = 'Indica';
      else if (t.includes('sativa')) result.type = 'Sativa';
      else if (t.includes('hybrid')) result.type = 'Hybrid';
    }
  }

  if (!result.category) {
    if (lower.includes('flower'))                                result.category = 'Flower';
    else if (lower.includes('edible')||lower.includes('gummy')) result.category = 'Edible';
    else if (lower.includes('vape')||lower.includes('cart'))    result.category = 'Vape';
    else if (lower.includes('pre-roll')||lower.includes('preroll')) result.category = 'Pre-Roll';
    else if (lower.includes('tincture'))                        result.category = 'Tincture';
    else if (lower.includes('topical')||lower.includes('cream')) result.category = 'Topical';
    else if (lower.includes('concentrate')||lower.includes('wax')) result.category = 'Concentrate';
  }

  if (!result.type) {
    if (lower.includes('indica'))      result.type = 'Indica';
    else if (lower.includes('sativa')) result.type = 'Sativa';
    else if (lower.includes('hybrid')) result.type = 'Hybrid';
    else if (lower.includes('cbd'))    result.type = 'CBD';
  }

  return result;
}

async function fetchFromJane(storeId) {
  const cached = cache[storeId];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;

  const allProducts = [];
  let page = 1;

  // Try multiple known Jane API product endpoints
  const endpoints = [
    (id, pg) => `https://api.iheartjane.com/v1/stores/${id}/menu/products?per_page=50&page=${pg}`,
    (id, pg) => `https://api.iheartjane.com/v1/stores/${id}/products?per_page=50&page=${pg}&show_hidden=false`,
    (id, pg) => `https://api.iheartjane.com/v2/stores/${id}/products?per_page=50&page=${pg}`,
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    'Accept': 'application/json',
    'Origin': 'https://www.iheartjane.com',
    'Referer': `https://www.iheartjane.com/stores/${storeId}/menu`,
    'x-requested-with': 'XMLHttpRequest',
  };

  // Try each endpoint until one works
  let workingEndpoint = null;
  for (const endpointFn of endpoints) {
    try {
      const testUrl = endpointFn(storeId, 1);
      const testRes = await fetch(testUrl, { headers });
      if (testRes.ok) {
        const testData = await testRes.json();
        const products = testData?.products || testData?.data || testData?.items || [];
        if (products.length > 0) {
          workingEndpoint = endpointFn;
          // Add first page results
          products.forEach(p => allProducts.push(parseJaneProduct(p)));
          page = 2;
          break;
        }
      }
    } catch(e) { continue; }
  }

  if (!workingEndpoint) {
    console.log(`No working endpoint found for store ${storeId}`);
    return [];
  }

  // Paginate remaining pages
  while (true) {
    try {
      const url = workingEndpoint(storeId, page);
      const res = await fetch(url, { headers });
      if (!res.ok) break;
      const data = await res.json();
      const products = data?.products || data?.data || data?.items || [];
      if (!products.length) break;
      products.forEach(p => allProducts.push(parseJaneProduct(p)));
      if (products.length < 50) break;
      page++;
      if (page > 12) break;
    } catch(e) { break; }
  }

  cache[storeId] = { data: allProducts, timestamp: Date.now() };
  return allProducts;
}

function parseJaneProduct(p) {
  return {
    name:     p.name || p.product_name || '',
    brand:    p.brand || p.brand_name || p.brand_subtype || '',
    category: p.kind || p.category || p.product_type || p.type || '',
    type:     p.root_subtype || p.strain_type || p.lineage || '',
    thc:      p.percent_thc ? `${p.percent_thc}%` : (p.thc_content || ''),
    cbd:      p.percent_cbd ? `${p.percent_cbd}%` : (p.cbd_content || ''),
    price:    p.price_med || p.price_rec || p.price || p.base_price || '',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { slug } = req.query;

  if (!slug) return res.status(400).json({ error: 'Missing dispensary slug' });
  const disp = DISPENSARIES[slug];
  if (!disp) return res.status(404).json({ error: `Unknown dispensary: ${slug}` });

  try {
    let inventory = [];

    if (disp.source === 'jane') {
      inventory = await fetchFromJane(disp.janeStoreId);
    } else {
      const filePath = join(process.cwd(), 'public', 'data', `${slug}.json`);
      const raw = readFileSync(filePath, 'utf8');
      const items = JSON.parse(raw);
      inventory = items.filter(i => i.title).map(i => parseWeedmapsTitle(i.title));
    }

    return res.status(200).json({
      dispensary: disp.name,
      brand:      disp.brand,
      slug,
      count:      inventory.length,
      inventory,
      source:     disp.source,
      status:     'READY',
    });

  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(200).json({
        dispensary: disp.name,
        brand: disp.brand,
        slug, count: 0, inventory: [], status: 'NO_DATA',
      });
    }
    return res.status(500).json({ error: err.message });
  }
}
