const axios = require('axios');
const fs = require('fs');
async function run() {
  const url = `https://r.jina.ai/https://ycharts.com/indicators/us_high_yield_option_adjusted_spread`;
  try {
    const res = await axios.get(url, { headers: { 'Accept': 'text/plain' }, timeout: 15000 });
    fs.writeFileSync('ycharts_hy.md', res.data);
    console.log("Success");
  } catch (e) {
    console.log("Error:", e.message);
  }
}
run();
