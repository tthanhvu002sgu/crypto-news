const axios = require('axios');
const fs = require('fs');

async function testTE() {
  const url = 'https://tradingeconomics.com/united-states/inflation-cpi';
  try {
    const res = await axios.get(`https://r.jina.ai/${url}`, {
      headers: { 'Accept': 'text/plain' },
      timeout: 15000
    });
    fs.writeFileSync('te_cpi.md', res.data);
    console.log("Jina TE success, saved to te_cpi.md");
  } catch(e) {
    console.error("Jina TE error:", e.message);
  }
}
testTE();
