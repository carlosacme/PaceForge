export default async function handler(req, res) {
  const { code } = req.query;
  res.redirect(`https://pace-forge-eta.vercel.app?strava_code=${code}`);
}
