const axios = require('axios');
async function run() {
  const url = `https://fred.stlouisfed.org/graph/api/series/?obs=true&series_id=BAMLH0A0HYM2EY`;
  try {
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
    console.log("Success:", JSON.stringify(res.data).substring(0, 500));
  } catch (e) {
    console.log("Error:", e.response ? e.response.status : e.message);
  }
}
run();
