export default async function handler(req, res) {
  const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
  const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
  const REDIRECT_URI = 'https://pace-forge-eta.vercel.app/api/strava/callback';
  
  if (req.method === 'GET' && req.query.action === 'auth') {
    const url = `https://www.strava.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=activity:read_all`;
    return res.redirect(url);
  }
  
  if (req.method === 'GET' && req.query.code) {
    const r = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code: req.query.code, grant_type: 'authorization_code' })
    });
    const data = await r.json();
    return res.status(200).json(data);
  }
  
  if (req.method === 'POST' && req.query.action === 'activities') {
    const { access_token } = req.body;
    const r = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=30', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    const data = await r.json();
    return res.status(200).json(data);
  }
  
  res.status(405).end();
}
