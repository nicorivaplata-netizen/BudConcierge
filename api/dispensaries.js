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

function mapPlace(place) {
  return {
    id:      place.id,
    name:    place.displayName?.text || '',
    address: place.formattedAddress || '',
    rating:  place.rating || null,
    open:    place.regularOpeningHours?.openNow ?? null,
    lat:     place.location?.latitude,
    lng:     place.location?.longitude,
    website: place.websiteUri || null,
    phone:   place.nationalPhoneNumber || null,
  };
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

    const allPlaces = [];
    const seenIds = new Set();
    let lastError = null;

    if (lat && lng) {
      // Nearby search — textQuery with locationBias (avoids hard radius cutoff)
      let nearbyTerms;
      if (RECREATIONAL_STATES.has(detectedState)) {
        nearbyTerms = [
          'cannabis dispensary',
          'marijuana dispensary',
          'cannabis store',
        ];
      } else if (MEDICAL_STATES.has(detectedState)) {
        nearbyTerms = [
          'cannabis dispensary',
          'dispensary',
          'CBD store',
          'hemp store',
        ];
      } else if (CBD_ONLY_STATES.has(detectedState)) {
        nearbyTerms = [
          'CBD store',
          'hemp store',
          'CBD shop',
        ];
      } else {
        nearbyTerms = [
          'cannabis dispensary',
          'marijuana dispensary',
          'CBD store',
          'hemp store',
        ];
      }

      for (const term of nearbyTerms) {
        try {
          const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              textQuery: term,
              maxResultCount: 20,
              languageCode: 'en',
              locationBias: {
                circle: {
                  center: {
                    latitude: parseFloat(lat),
                    longitude: parseFloat(lng),
                  },
                  radius: 32000.0,
                },
              },
            }),
          });

          if (!r.ok) {
            const errData = await r.json();
            lastError = errData.error?.message || 'Google Places error';
            continue;
          }

          const d = await r.json();
          for (const place of (d.places || [])) {
            if (!seenIds.has(place.id)) {
              seenIds.add(place.id);
              allPlaces.push(place);
            }
          }

          await new Promise(resolve => setTimeout(resolve, 150));

        } catch(e) {
          lastError = e.message;
          continue;
        }
      }

    } else {
      // Text search — run all terms and combine deduplicated results
      let searchTerms;
      if (RECREATIONAL_STATES.has(detectedState)) {
        searchTerms = [
          `cannabis dispensary ${query}`,
          `marijuana dispensary ${query}`,
          `recreational dispensary ${query}`,
          `dispensary ${query}`,
          `cannabis store ${query}`,
        ];
      } else if (MEDICAL_STATES.has(detectedState)) {
        searchTerms = [
          `cannabis dispensary ${query}`,
          `marijuana dispensary ${query}`,
          `dispensary ${query}`,
          `CBD store ${query}`,
          `hemp store ${query}`,
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
          `dispensary ${query}`,
          `hemp store ${query}`,
        ];
      }

      for (const term of searchTerms) {
        try {
          const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              textQuery: term,
              maxResultCount: 20,
              languageCode: 'en',
            }),
          });

          if (!r.ok) {
            const errData = await r.json();
            lastError = errData.error?.message || 'Google Places error';
            continue;
          }

          const d = await r.json();
          for (const place of (d.places || [])) {
            if (!seenIds.has(place.id)) {
              seenIds.add(place.id);
              allPlaces.push(place);
            }
          }

          await new Promise(resolve => setTimeout(resolve, 150));

        } catch(e) {
          lastError = e.message;
          continue;
        }
      }
    }

    if (allPlaces.length === 0 && lastError) {
      return res.status(500).json({ error: 'Google Places error', details: lastError });
    }

    const dispensaries = allPlaces.map(mapPlace);

    return res.status(200).json({ dispensaries, total: dispensaries.length, legalStatus });

  } catch (err) {
    console.error('Dispensary search error:', err);
    return res.status(500).json({ error: err.message });
  }
}
