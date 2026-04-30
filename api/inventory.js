// api/inventory.js — Hybrid inventory fetcher
// Uses iHeartJane API for Arkansas dispensaries, static JSON for others
// iHeartJane is the POS platform used by PurSpirit, The Hill, and The Source

import { readFileSync } from 'fs';
import { join } from 'path';

const DISPENSARIES = {
  // High Profile — Missouri (static JSON from Weedmaps)
  'high-profile-pineville':      { name: 'High Profile — Pineville, MO',        brand: 'High Profile',   source: 'static' },
  'mo-chesterfield-hp':          { name: 'High Profile — Chesterfield, MO',     brand: 'High Profile',   source: 'static' },
  'mo-columbia-hp':              { name: 'High Profile — Columbia, MO',         brand: 'High Profile',   source: 'static' },
  'high-profile-cape-girardeau': { name: 'High Profile — Cape Girardeau, MO',   brand: 'High Profile',   source: 'static' },
  // Story Cannabis (static JSON)
  'story-dunlap':                { name: 'Story Cannabis — Phoenix, AZ',         brand: 'Story Cannabis', source: 'static' },
  'story-mechanicsville':        { name: 'Story Cannabis — Mechanicsville, MD',  brand: 'Story Cannabis', source: 'static' },
  'story-cleveland':             { name: 'Story Cannabis — Cleveland, OH',       brand: 'Story Cannabis', source: 'static' },
  // Arkansas — iHeartJane powered
  'purspirit-fayetteville':      { name: 'PurSpirit — Fayetteville, AR',         brand: 'PurSpirit',      source: 'jane', janeStoreId: 3678 },
  'the-source-rogers':           { name: 'The Source — Rogers, AR',              brand: 'The Source',     source: 'jane', janeStoreId: 2847 },
  'the-hill-fayetteville':       { name: 'The Hill — Fayetteville, AR',          brand: 'The Hill',       source: 'jane', janeStoreId: 4817 },
};

// Cache for Jane API responses
const cache = {};
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

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
    if (lower.includes('flower'))                           result.category = 'Flower';
    else if (lower.includes('edible')||lower.includes('gummy')) result.category = 'Edible';
    else if (lower.includes('vape')||lower.includes('cart'))    result.category = 'Vape';
    else if (lower.includes('pre-roll')||lower.includes('preroll')) result.category = 'Pre-Roll';
    else if (lower.includes('tincture'))                    result.category = 'Tincture';
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
  const perPage = 50;

  while (true) {
    const url = `https://api.iheartjane.com/v1/stores/${storeId}/products?per_page=${perPage}&page=${page}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'application/json',
        'Origin': 'https://www.iheartjane.com',
        'Referer': `https://www.iheartjane.com/stores/${storeId}/menu`,
      }
    });

    if (!res.ok) break;

    const data = await res.json();
    const products = data?.products || data?.data || [];
    if (!products.length) break;

    products.forEach(p => {
      allProducts.push({
        name:     p.name || p.product_name || '',
        brand:    p.brand || p.brand_name || '',
        category: p.kind || p.category || p.product_type || '',
        type:     p.root_subtype || p.strain_type || '',
        thc:      p.percent_thc ? `${p.percent_thc}%` : '',
        cbd:      p.percent_cbd ? `${p.percent_cbd}%` : '',
        price:    p.price_med || p.price_rec || p.price || '',
      });
    });

    if (products.length < perPage) break;
    page++;
    if (page > 10) break; // max 500 products
  }

  cache[storeId] = { data: allProducts, timestamp: Date.now() };
  return allProducts;
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
      // Fetch live from iHeartJane API
      inventory = await fetchFromJane(disp.janeStoreId);
    } else {
      // Serve from static JSON file
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
