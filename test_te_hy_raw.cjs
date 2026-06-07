const axios = require('axios');
const fs = require('fs');
async function run() {
  const url = `https://r.jina.ai/https://tradingeconomics.com/united-states/ice-bofa-us-high-yield-index-option-adjusted-spread-fed-data.html`;
  try {
    const res = await axios.get(url, { headers: { 'Accept': 'text/plain' } });
    fs.writeFileSync('te_hy_raw.md', res.data);
    console.log("Done");
  } catch (e) {
    console.log(e.message);
  }
}
run();
