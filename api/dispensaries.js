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

    let url;

    if (lat && lng) {
      // Nearby search by coordinates
      url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=20000&type=establishment&keyword=cannabis+dispensary&key=${apiKey}`;
    } else {
      // Text search by city/zip/name
      url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=cannabis+dispensary+${encodeURIComponent(query)}&key=${apiKey}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return res.status(500).json({ error: 'Google Places error: ' + data.status, details: data.error_message });
    }

    // Clean and return only what we need
    const dispensaries = (data.results || []).slice(0, 10).map(place => ({
      id:       place.place_id,
      name:     place.name,
      address:  place.formatted_address || place.vicinity || '',
      rating:   place.rating || null,
      open:     place.opening_hours?.open_now ?? null,
      lat:      place.geometry?.location?.lat,
      lng:      place.geometry?.location?.lng,
    }));

    return res.status(200).json({ dispensaries, total: dispensaries.length });

  } catch (err) {
    console.error('Dispensary search error:', err);
    return res.status(500).json({ error: err.message });
  }
}
