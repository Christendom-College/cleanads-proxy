// api/cleanads.js - Vercel Edge Function
// This proxies requests to the CleanAds API with proper headers

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  // Enable CORS for Airbyte
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Parse query parameters from the incoming request
    const url = new URL(request.url);
    const advertiserId = url.searchParams.get('advertiser_id') || 'MTU0Mg%3D%3D';
    const rangeDays = url.searchParams.get('range_days') || '7';
    
    // Optional: Add API key authentication for your proxy
    const apiKey = request.headers.get('X-API-Key');
    if (apiKey !== process.env.PROXY_API_KEY) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build the CleanAds API URL
    const cleanAdsUrl = `https://cleanads.net/crm/customreports/api/AdvertiserAdSetSummaryRange/?AdvertiserID=${advertiserId}&rptFormat=json&rangedays=${rangeDays}`;

    // Fetch from CleanAds with the proper headers that work
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

    if (!response.ok) {
      throw new Error(`CleanAds API returned ${response.status}`);
    }

    // Get the data
    const data = await response.json();

    // Transform the data if needed (optional)
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
    return new Response(JSON.stringify(transformedData), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });

  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to fetch data', 
        details: error.message 
      }), 
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
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