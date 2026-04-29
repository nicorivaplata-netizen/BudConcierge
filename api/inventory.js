// api/inventory.js — Serves static dispensary inventory from /public/data/
// Data is updated manually by running Apify actor and replacing the JSON file
// This approach is instant, reliable, and has zero timeout issues

import { readFileSync } from 'fs';
import { join } from 'path';

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

function parseTitle(title) {
  const result = { name: title, brand: '', strain: '', category: '', type: '' };
  const lower = title.toLowerCase();

  if (title.includes('|')) {
    const parts = title.split('|').map(p => p.trim());
    result.brand    = parts[0] || '';
    result.strain   = parts[1] || '';
    result.category = parts[2] || '';
    result.name     = parts[1] ? `${parts[1]}${parts[2] ? ' ' + parts[2] : ''}` : title;
  } else if (title.includes(' - ')) {
    const parts = title.split(' - ').map(p => p.trim());
    result.brand  = parts[0] || '';
    result.strain = parts[1] || '';
    result.name   = parts[1] || title;
    if (parts[2]) {
      const t = parts[2].toLowerCase();
      if (t.includes('indica'))  result.type = 'Indica';
      else if (t.includes('sativa')) result.type = 'Sativa';
      else if (t.includes('hybrid')) result.type = 'Hybrid';
      else if (t.includes('cbd'))    result.type = 'CBD';
    }
  }

  // Detect category
  if (!result.category) {
    if (lower.includes('flower'))                           result.category = 'Flower';
    else if (lower.includes('edible') || lower.includes('gummy') || lower.includes('chocolate')) result.category = 'Edible';
    else if (lower.includes('vape') || lower.includes('cart')) result.category = 'Vape';
    else if (lower.includes('pre-roll') || lower.includes('pre roll') || lower.includes('preroll')) result.category = 'Pre-Roll';
    else if (lower.includes('tincture'))                    result.category = 'Tincture';
    else if (lower.includes('topical') || lower.includes('cream') || lower.includes('balm')) result.category = 'Topical';
    else if (lower.includes('concentrate') || lower.includes('wax') || lower.includes('shatter') || lower.includes('rosin')) result.category = 'Concentrate';
    else if (lower.includes('capsule') || lower.includes('pill')) result.category = 'Capsule';
  }

  // Detect type
  if (!result.type) {
    if (lower.includes('indica'))       result.type = 'Indica';
    else if (lower.includes('sativa'))  result.type = 'Sativa';
    else if (lower.includes('hybrid'))  result.type = 'Hybrid';
    else if (lower.includes('cbd'))     result.type = 'CBD';
  }

  return result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { slug } = req.query;

  if (!slug) return res.status(400).json({ error: 'Missing dispensary slug' });
  if (!DISPENSARIES[slug]) return res.status(404).json({ error: `Unknown dispensary: ${slug}` });

  try {
    const filePath = join(process.cwd(), 'public', 'data', `${slug}.json`);
    const raw = readFileSync(filePath, 'utf8');
    const items = JSON.parse(raw);

    const inventory = items
      .filter(item => item.title)
      .map(item => parseTitle(item.title));

    return res.status(200).json({
      dispensary: DISPENSARIES[slug].name,
      brand:      DISPENSARIES[slug].brand,
      slug,
      count:      inventory.length,
      inventory,
      status:     'READY',
    });

  } catch (err) {
    // No data file yet for this dispensary
    if (err.code === 'ENOENT') {
      return res.status(200).json({
        dispensary: DISPENSARIES[slug].name,
        brand:      DISPENSARIES[slug].brand,
        slug,
        count:      0,
        inventory:  [],
        status:     'NO_DATA',
        message:    'No inventory file yet for this dispensary',
      });
    }
    return res.status(500).json({ error: err.message });
  }
}
