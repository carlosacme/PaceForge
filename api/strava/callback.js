export default async function handler(req, res) {
  const { code, state } = req.query;
  const statePart = state ? `&state=${encodeURIComponent(String(state))}` : '';
  res.redirect(`https://pace-forge-eta.vercel.app?strava_code=${code}${statePart}`);
}
