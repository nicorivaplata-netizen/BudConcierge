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

    const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.rating,places.regularOpeningHours,places.location,places.websiteUri,places.nationalPhoneNumber';
    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
    };

    let response;

    if (lat && lng) {
      const nearbyUrl = 'https://places.googleapis.com/v1/places:searchNearby';
      response = await fetch(nearbyUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          includedTypes: ['establishment'],
          maxResultCount: 20,
          locationRestriction: {
            circle: {
              center: {
                latitude: parseFloat(lat),
                longitude: parseFloat(lng),
              },
              radius: 32000.0,
            },
          },
          rankPreference: 'DISTANCE',
        }),
      });
    } else {
      const searchUrl = 'https://places.googleapis.com/v1/places:searchText';
      response = await fetch(searchUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          textQuery: `cannabis dispensary ${encodeURIComponent(query)}`,
          maxResultCount: 20,
          languageCode: 'en',
        }),
      });
    }

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: 'Google Places error', details: data.error?.message });
    }

    const places = (data.places || []).slice(0, 8);

    const dispensaries = places.map(place => ({
      id:      place.id,
      name:    place.displayName?.text || '',
      address: place.formattedAddress || '',
      rating:  place.rating || null,
      open:    place.regularOpeningHours?.openNow ?? null,
      lat:     place.location?.latitude,
      lng:     place.location?.longitude,
      website: place.websiteUri || null,
      phone:   place.nationalPhoneNumber || null,
    }));

    return res.status(200).json({ dispensaries, total: dispensaries.length });

  } catch (err) {
    console.error('Dispensary search error:', err);
    return res.status(500).json({ error: err.message });
  }
}
