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
  'purspirit-fayetteville':      { name: 'PurSpirit — Fayetteville, AR',         brand: 'PurSpirit',      source: 'static' },
  'the-hill-fayetteville':       { name: 'The Hill — Fayetteville, AR',          brand: 'The Hill',       source: 'static' },
  'the-source-rogers':           { name: 'The Source — Rogers, AR',              brand: 'The Source',     source: 'static' },
};

function parseTitle(title) {
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
    if (lower.includes('flower') || lower.includes('smalls') || lower.includes('prepack')) result.category = 'Flower';
    else if (lower.includes('edible') || lower.includes('gummy') || lower.includes('chocolate') || lower.includes('taffy') || lower.includes('chew')) result.category = 'Edible';
    else if (lower.includes('vape') || lower.includes('cart') || lower.includes('disposable') || lower.includes('aio')) result.category = 'Vape';
    else if (lower.includes('pre-roll') || lower.includes('preroll')) result.category = 'Pre-Roll';
    else if (lower.includes('tincture'))                        result.category = 'Tincture';
    else if (lower.includes('topical') || lower.includes('patch') || lower.includes('balm') || lower.includes('cream') || lower.includes('freeze')) result.category = 'Topical';
    else if (lower.includes('concentrate') || lower.includes('wax') || lower.includes('rosin') || lower.includes('resin')) result.category = 'Concentrate';
    else if (lower.includes('drink') || lower.includes('soda') || lower.includes('cola')) result.category = 'Drink';
  }

  if (!result.type) {
    if (lower.includes('indica'))      result.type = 'Indica';
    else if (lower.includes('sativa')) result.type = 'Sativa';
    else if (lower.includes('hybrid')) result.type = 'Hybrid';
    else if (lower.includes('cbd'))    result.type = 'CBD';
  }

  return result;
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
    const filePath = join(process.cwd(), 'public', 'data', `${slug}.json`);
    const raw = readFileSync(filePath, 'utf8');
    const items = JSON.parse(raw);

    const inventory = items.filter(i => i.title).map(i => {
      const parsed = parseTitle(i.title);
      if (i.thc)   parsed.thc   = i.thc;
      if (i.cbd)   parsed.cbd   = i.cbd;
      if (i.price) parsed.price = i.price;
      if (i.type)  parsed.type  = i.type;
      return parsed;
    });

    return res.status(200).json({
      dispensary: disp.name,
      brand:      disp.brand,
      slug,
      count:      inventory.length,
      inventory,
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
