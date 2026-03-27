const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer re_3CLu9n3j_LpDi3Hq9vXrC42tv6ycmMagz'
  },
  body: JSON.stringify({
    from: 'onboarding@resend.dev',
    to: 'acostamerlano87@gmail.com',
    subject: 'Test PaceForge',
    html: '<p>Test desde PaceForge</p>'
  })
});
const data = await response.json();
console.log(data);
