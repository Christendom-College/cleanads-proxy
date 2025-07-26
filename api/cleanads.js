// api/cleanads.js - Complete version with Incremental Sync Support
// Vercel Serverless Function (Node.js runtime)
// This proxies requests to the CleanAds API with proper headers and incremental sync

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
    const advertiserId = req.query.advertiser_id;
    let rangeDays = req.query.range_days || '7';
    const startDate = req.query.start_date; // For incremental sync
    const endDate = req.query.end_date;     // For incremental sync
    
    // Optional: Add API key authentication for your proxy
    const apiKey = req.headers['x-api-key'];
    if (process.env.PROXY_API_KEY && apiKey !== process.env.PROXY_API_KEY) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Calculate range days if start_date is provided (for incremental sync)
    if (startDate) {
      const start = new Date(startDate);
      const end = endDate ? new Date(endDate) : new Date();
      const diffTime = Math.abs(end - start);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      rangeDays = Math.min(90, Math.max(1, diffDays + 1)).toString(); // +1 to include both start and end dates
      
      console.log(`Calculated range days: ${rangeDays} from ${startDate} to ${end.toISOString()}`);
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', errorText);
      throw new Error(`CleanAds API returned ${response.status}: ${errorText}`);
    }

    // Get the response text first to debug
    const responseText = await response.text();
    console.log('Raw response length:', responseText.length);

    // Parse as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError);
      throw new Error('Failed to parse response as JSON');
    }

    // Filter data by date range if start_date is provided
    let filteredData = data;
    if (startDate) {
      const startDateObj = new Date(startDate);
      startDateObj.setHours(0, 0, 0, 0); // Start of day
      
      const endDateObj = endDate ? new Date(endDate) : new Date();
      endDateObj.setHours(23, 59, 59, 999); // End of day
      
      filteredData = data.filter(record => {
        if (!record.ShortDate) return false;
        
        // Parse MM/DD/YYYY format
        const [month, day, year] = record.ShortDate.split('/');
        const recordDate = new Date(year, month - 1, day); // month is 0-indexed in JS
        
        return recordDate >= startDateObj && recordDate <= endDateObj;
      });
      
      console.log(`Filtered ${data.length} records to ${filteredData.length} based on date range`);
    }

    // Sort by date to ensure consistent cursor progression
    filteredData.sort((a, b) => {
      const dateA = new Date(normalizeDate(a.ShortDate));
      const dateB = new Date(normalizeDate(b.ShortDate));
      return dateA - dateB;
    });

    // Transform the data with improved schema handling
    const transformedData = {
      success: true,
      metadata: {
        advertiser_id: advertiserId,
        range_days: rangeDays,
        fetched_at: new Date().toISOString(),
        total_records: data.length,
        filtered_records: filteredData.length,
        date_range: {
          start: startDate || null,
          end: endDate || new Date().toISOString().split('T')[0],
          requested_days: rangeDays
        }
      },
      records: filteredData.map(record => {
        // Safely parse numeric values
        const parseIntSafe = (value) => {
          const parsed = parseInt(value);
          return isNaN(parsed) ? 0 : parsed;
        };
        
        const parseFloatSafe = (value) => {
          const parsed = parseFloat(value);
          return isNaN(parsed) ? 0.0 : parsed;
        };
        
        const normalizedDate = normalizeDate(record.ShortDate);
        
        // Ensure we ALWAYS have these required fields
        const shortDate = record.ShortDate || '';
        const campaignName = record.CampaignName || 'Unknown';
        const adsetName = record.AdsetName || 'Unknown';
        
        return {
          // Required fields - always present, never null
          ShortDate: shortDate,
          CampaignName: campaignName,
          AdsetName: adsetName,
          
          // Original stat fields - ensure consistent types
          statImpressions: parseIntSafe(record.statImpressions),
          statClicks: parseIntSafe(record.statClicks),
          statCost: parseFloatSafe(record.statCost),
          statConversions: parseIntSafe(record.statConversions),
          
          // Normalized fields - match Airbyte's detected schema
          normalized_date: normalizedDate,
          impressions: parseIntSafe(record.statImpressions),
          clicks: parseIntSafe(record.statClicks),
          cost: parseFloatSafe(record.statCost),
          conversions: parseIntSafe(record.statConversions),
          
          // Add a unique identifier for deduplication
          record_id: `${normalizedDate || shortDate}_${campaignName}_${adsetName}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
          
          // Add timestamp for cursor (using normalized date + time at end of day)
          cursor_timestamp: normalizedDate ? `${normalizedDate}T23:59:59Z` : `${shortDate}T23:59:59Z`,
        };
      }),
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
    if (!month || !day || !year) return null;
    
    // Validate date components
    const monthNum = parseInt(month);
    const dayNum = parseInt(day);
    const yearNum = parseInt(year);
    
    if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
      return null;
    }
    
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  } catch {
    return null;
  }
}