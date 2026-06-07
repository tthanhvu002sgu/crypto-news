const axios = require('axios');
const fs = require('fs');

async function testFredHtml() {
  const url = 'https://fred.stlouisfed.org/series/BAMLH0A0HYM2EY';
  try {
    const res = await axios.get(`https://r.jina.ai/${url}`, {
      headers: { 'Accept': 'text/plain' },
      timeout: 15000
    });
    fs.writeFileSync('fred_hy.md', res.data);
    console.log("Jina FRED success, saved to fred_hy.md");
  } catch(e) {
    console.error("Jina FRED error:", e.message);
  }
}
testFredHtml();
