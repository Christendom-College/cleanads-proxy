// api/cleanads.js - Vercel Serverless Function (Node.js runtime)
// This proxies requests to the CleanAds API with proper headers

export default async function handler(req, res) {
  // Enable CORS for Airbyte
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Parse query parameters from the incoming request
    const advertiserId = req.query.advertiser_id || 'MTU0Mg%3D%3D';
    const rangeDays = req.query.range_days || '7';
    
    // Optional: Add API key authentication for your proxy
    const apiKey = req.headers['x-api-key'];
    if (process.env.PROXY_API_KEY && apiKey !== process.env.PROXY_API_KEY) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Build the CleanAds API URL
    const cleanAdsUrl = `https://cleanads.net/crm/customreports/api/AdvertiserAdSetSummaryRange/?AdvertiserID=${advertiserId}&rptFormat=json&rangedays=${rangeDays}`;

    console.log('Fetching from:', cleanAdsUrl);

    // Use native fetch with Node.js runtime
    const response = await fetch(cleanAdsUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', errorText);
      throw new Error(`CleanAds API returned ${response.status}: ${errorText}`);
    }

    // Get the response text first to debug
    const responseText = await response.text();
    console.log('Raw response:', responseText.substring(0, 500)); // Log first 500 chars

    // Parse as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError);
      throw new Error('Failed to parse response as JSON');
    }

    // Transform the data if needed
    const transformedData = {
      success: true,
      metadata: {
        advertiser_id: advertiserId,
        range_days: rangeDays,
        fetched_at: new Date().toISOString(),
        record_count: data.length,
      },
      records: data.map(record => ({
        ...record,
        // Normalize the date format from MM/DD/YYYY to ISO
        normalized_date: normalizeDate(record.ShortDate),
        // Ensure numeric fields are properly typed
        impressions: parseInt(record.statImpressions) || 0,
        clicks: parseInt(record.statClicks) || 0,
        cost: parseFloat(record.statCost) || 0,
        conversions: parseInt(record.statConversions) || 0,
      })),
    };

    // Return the data with proper headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    res.status(200).json(transformedData);

  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch data', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Helper function to normalize date format
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  try {
    // Parse MM/DD/YYYY format
    const [month, day, year] = dateStr.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  } catch {
    return dateStr;
  }
}