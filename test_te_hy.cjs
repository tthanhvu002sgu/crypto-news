const axios = require('axios');

async function getTEData(indicatorPath) {
  const url = `https://r.jina.ai/https://tradingeconomics.com/united-states/${indicatorPath}`;
  try {
    const res = await axios.get(url, {
      headers: { 'Accept': 'text/plain' },
      timeout: 15000
    });
    
    const lines = res.data.split('\n');
    let actualIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('| Actual | Previous |')) {
        const headers = lines[i].split('|').map(s => s.trim());
        actualIndex = headers.indexOf('Actual');
      } else if (actualIndex !== -1 && lines[i].includes('|') && !lines[i].includes('---')) {
        const cols = lines[i].split('|').map(s => s.trim());
        if (cols.length > actualIndex) {
          const val = parseFloat(cols[actualIndex]);
          if (!isNaN(val)) return val;
        }
      }
    }
  } catch (e) {
    console.error("Error fetching", indicatorPath, e.message);
  }
  return null;
}

async function testHY() {
  console.log("High Yield:", await getTEData('ice-bofa-us-high-yield-index-option-adjusted-spread-fed-data.html'));
  console.log("Fed Funds Rate:", await getTEData('interest-rate'));
}

testHY();
