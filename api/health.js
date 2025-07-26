// api/health.js - Simple health check endpoint
export default async function handler(req, res) {
  const apiKey = req.headers['x-api-key'];
  const hasEnvKey = !!process.env.PROXY_API_KEY;
  const keyMatches = !process.env.PROXY_API_KEY || apiKey === process.env.PROXY_API_KEY;
  
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env_key_set: hasEnvKey,
    auth_valid: keyMatches,
    api_key_provided: !!apiKey,
    test_params: {
      advertiser_id: req.query.advertiser_id || 'not provided',
      range_days: req.query.range_days || 'not provided'
    }
  });
}