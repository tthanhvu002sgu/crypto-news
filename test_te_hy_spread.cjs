const axios = require('axios');
const fs = require('fs');
async function run() {
  const url = `https://r.jina.ai/https://tradingeconomics.com/united-states/high-yield-spread`;
  try {
    const res = await axios.get(url, { headers: { 'Accept': 'text/plain' } });
    fs.writeFileSync('te_hy_spread.md', res.data);
    console.log("Done");
  } catch (e) {
    console.log(e.message);
  }
}
run();
