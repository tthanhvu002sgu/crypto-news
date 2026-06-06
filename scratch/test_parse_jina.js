import fs from 'fs';

function parseFarside() {
  const content = fs.readFileSync('scratch/farside_jina.md', 'utf8');
  const lines = content.split('\n');
  const flowHistory = [];
  
  // Date regex: e.g. "26 May 2026" or "01 Jun 2026"
  const dateRegex = /^\s*\|\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s*\|/;
  
  for (const line of lines) {
    const match = line.match(dateRegex);
    if (match) {
      const dateStr = match[1];
      const cells = line.split('|').map(c => c.trim());
      // Let's filter out empty elements at the ends
      // The cells are: ["", dateStr, IBIT, FBTC, BITB, ARKB, BTCO, EZBC, BRRR, HODL, BTCW, MSBT, GBTC, BTC, Total, ""]
      // Total flow is the cell just before the last empty one, which should be cells[cells.length - 2]
      const totalStr = cells[cells.length - 2];
      
      // Parse float value from totalStr, e.g. "(333.6)" -> -333.6, "3.2" -> 3.2, "0.0" -> 0
      let flowVal = 0;
      if (totalStr) {
        let clean = totalStr.replace(/,/g, ''); // remove commas
        if (clean.includes('(') && clean.includes(')')) {
          flowVal = -parseFloat(clean.replace(/[()]/g, ''));
        } else {
          flowVal = parseFloat(clean);
        }
      }
      
      if (!isNaN(flowVal)) {
        // Format date as DD/MM
        const [day, monthStr] = dateStr.split(/\s+/);
        const months = {
          Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
          Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
        };
        const month = months[monthStr.substring(0, 3)] || '01';
        const formattedDate = `${day}/${month}`;
        
        flowHistory.push({
          date: formattedDate,
          flow: flowVal
        });
      }
    }
  }
  
  console.log('Parsed ETF Flow History (latest first):', flowHistory);
  console.log('Reversed (oldest first):', [...flowHistory].reverse());
}

parseFarside();
