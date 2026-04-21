export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { query, lat, lng } = req.query;

  if (!query && (!lat || !lng)) {
    return res.status(400).json({ error: 'Provide a search query or lat/lng coordinates' });
  }

  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Google Places API key not configured' });

    let searchUrl;

    if (lat && lng) {
      searchUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=20000&type=establishment&keyword=cannabis+dispensary&key=${apiKey}`;
    } else {
      searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=cannabis+dispensary+${encodeURIComponent(query)}&key=${apiKey}`;
    }

    const response = await fetch(searchUrl);
    const data = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return res.status(500).json({ error: 'Google Places error: ' + data.status, details: data.error_message });
    }

    // For each result fetch Place Details to get website + phone
    const results = (data.results || []).slice(0, 8);

    const dispensaries = await Promise.all(results.map(async place => {
      let website = null;
      let phone = null;

      try {
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=website,formatted_phone_number&key=${apiKey}`;
        const detailRes = await fetch(detailUrl);
        const detailData = await detailRes.json();
        if (detailData.result) {
          website = detailData.result.website || null;
          phone = detailData.result.formatted_phone_number || null;
        }
      } catch (e) {
        // Website fetch failed — continue without it
      }

      return {
        id:      place.place_id,
        name:    place.name,
        address: place.formatted_address || place.vicinity || '',
        rating:  place.rating || null,
        open:    place.opening_hours?.open_now ?? null,
        lat:     place.geometry?.location?.lat,
        lng:     place.geometry?.location?.lng,
        website,
        phone,
      };
    }));

    return res.status(200).json({ dispensaries, total: dispensaries.length });

  } catch (err) {
    console.error('Dispensary search error:', err);
    return res.status(500).json({ error: err.message });
  }
}
