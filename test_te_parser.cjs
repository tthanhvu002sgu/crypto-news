const axios = require('axios');

async function getTEData(indicatorUrl) {
  const url = `https://r.jina.ai/https://tradingeconomics.com/united-states/${indicatorUrl}`;
  try {
    const res = await axios.get(url, {
      headers: { 'Accept': 'text/plain' },
      timeout: 15000
    });
    
    const lines = res.data.split('\n');
    let actualIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('| Actual | Previous |')) {
        // Table header found
        // Find which column 'Actual' is
        const headers = lines[i].split('|').map(s => s.trim());
        actualIndex = headers.indexOf('Actual');
      } else if (actualIndex !== -1 && lines[i].includes('|') && !lines[i].includes('---')) {
        // This should be the data row
        const cols = lines[i].split('|').map(s => s.trim());
        if (cols.length > actualIndex) {
          const val = parseFloat(cols[actualIndex]);
          if (!isNaN(val)) return val;
        }
      }
    }
  } catch (e) {
    console.error("Error fetching", indicatorUrl, e.message);
  }
  return null;
}

async function testAll() {
  console.log("CPI:", await getTEData('inflation-cpi'));
  console.log("Unemployment:", await getTEData('unemployment-rate'));
  console.log("M2 Supply:", await getTEData('money-supply-m2'));
  console.log("High Yield:", await getTEData('high-yield-spread')); // Might not exist on TE like this
  console.log("Fed Assets (WALCL):", await getTEData('central-bank-balance-sheet')); 
}

testAll();
