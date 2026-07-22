const RECREATIONAL_STATES = new Set([
  'AK', // Alaska
  'AZ', // Arizona
  'CA', // California
  'CO', // Colorado
  'CT', // Connecticut
  'DC', // Washington DC
  'DE', // Delaware
  'IL', // Illinois
  'MA', // Massachusetts
  'MD', // Maryland
  'ME', // Maine
  'MI', // Michigan
  'MN', // Minnesota
  'MO', // Missouri
  'MT', // Montana
  'NJ', // New Jersey
  'NM', // New Mexico
  'NV', // Nevada
  'NY', // New York
  'OH', // Ohio
  'OR', // Oregon
  'RI', // Rhode Island
  'VA', // Virginia
  'VT', // Vermont
  'WA', // Washington
]);

const MEDICAL_STATES = new Set([
  'AL', // Alabama
  'AR', // Arkansas
  'FL', // Florida
  'GA', // Georgia (limited CBD/low-THC program)
  'HI', // Hawaii
  'IA', // Iowa (CBD only)
  'KY', // Kentucky
  'LA', // Louisiana
  'MS', // Mississippi
  'ND', // North Dakota
  'NE', // Nebraska
  'NH', // New Hampshire
  'OK', // Oklahoma
  'PA', // Pennsylvania
  'SD', // South Dakota
  'TX', // Texas (limited medical)
  'UT', // Utah
  'WV', // West Virginia
]);

const CBD_ONLY_STATES = new Set([
  'IN', // Indiana — no medical program, hemp CBD legal
  'NC', // North Carolina — no medical program, hemp CBD legal
  'TN', // Tennessee — hemp CBD legal, very limited CBD epilepsy program
  'WI', // Wisconsin — no medical program, hemp CBD legal
]);

const NO_CANNABIS_STATES = new Set([
  'ID', // Idaho — fully illegal, no exceptions
  'KS', // Kansas — fully illegal, no exceptions
  'SC', // South Carolina — fully illegal, no exceptions
  'WY', // Wyoming — fully illegal, no exceptions
]);

function detectState(query, stateParam) {
  if (stateParam) return stateParam.toUpperCase().trim();
  if (!query) return null;
  const match = query.match(/\b([A-Z]{2})\b/);
  return match ? match[1] : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { query, lat, lng, state } = req.query;

  if (!query && (!lat || !lng)) {
    return res.status(400).json({ error: 'Provide a search query or lat/lng coordinates' });
  }

  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Google Places API key not configured' });

    const detectedState = detectState(query, state);

    // No-cannabis states — return early before any API call
    if (NO_CANNABIS_STATES.has(detectedState)) {
      return res.status(200).json({
        dispensaries: [],
        total: 0,
        state: detectedState,
        legalStatus: 'none',
        message: 'Cannabis and CBD retail is not available in this state.',
      });
    }

    let searchTerms;
    if (RECREATIONAL_STATES.has(detectedState)) {
      searchTerms = [
        `cannabis dispensary ${query}`,
        `marijuana dispensary ${query}`,
        `recreational dispensary ${query}`,
        `medical marijuana dispensary ${query}`,
        `cannabis store ${query}`,
      ];
    } else if (MEDICAL_STATES.has(detectedState)) {
      searchTerms = [
        `medical marijuana dispensary ${query}`,
        `medical cannabis dispensary ${query}`,
        `CBD store ${query}`,
        `hemp store ${query}`,
        `CBD wellness store ${query}`,
      ];
    } else if (CBD_ONLY_STATES.has(detectedState)) {
      searchTerms = [
        `CBD store ${query}`,
        `hemp store ${query}`,
        `CBD shop ${query}`,
        `hemp CBD store ${query}`,
        `natural wellness CBD ${query}`,
      ];
    } else {
      searchTerms = [
        `cannabis dispensary ${query}`,
        `marijuana dispensary ${query}`,
        `CBD store ${query}`,
        `medical marijuana dispensary ${query}`,
        `hemp store ${query}`,
      ];
    }

    const legalStatus = RECREATIONAL_STATES.has(detectedState) ? 'recreational' :
                        MEDICAL_STATES.has(detectedState) ? 'medical' :
                        CBD_ONLY_STATES.has(detectedState) ? 'cbd_only' :
                        NO_CANNABIS_STATES.has(detectedState) ? 'none' : 'unknown';

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
          textQuery: searchTerms[0],
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

    return res.status(200).json({ dispensaries, total: dispensaries.length, legalStatus });

  } catch (err) {
    console.error('Dispensary search error:', err);
    return res.status(500).json({ error: err.message });
  }
}
