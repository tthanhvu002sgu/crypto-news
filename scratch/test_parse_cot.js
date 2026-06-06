import fs from 'fs';

function testParseCot() {
  const content = fs.readFileSync('scratch/cot_jina.md', 'utf8');
  const lines = content.split('\n');
  
  let assetManager = null;
  let leveragedFunds = null;
  let dateStr = 'N/A';
  let openInterest = 0;
  
  // Find Date
  // e.g. "Below is the Commitments of Traders (COT) report for BITCOIN... as of 2026-06-02."
  // or "AS OF: 2026-06-02"
  for (const line of lines) {
    if (line.includes('AS OF:')) {
      const match = line.match(/AS OF:\s*([0-9-]+)/);
      if (match) dateStr = match[1];
    }
    if (line.includes('Open Interest:')) {
      const match = line.match(/Open Interest:\s*([\d,]+)/);
      if (match) openInterest = parseInt(match[1].replace(/,/g, ''));
    }
  }

  const parseCell = (cell) => {
    if (!cell) return { pos: 0, change: 0 };
    const parts = cell.trim().split(/\s+/);
    const pos = parseInt(parts[0].replace(/,/g, '')) || 0;
    const change = parts[1] ? parseInt(parts[1].replace(/,/g, '')) : 0;
    return { pos, change };
  };

  for (const line of lines) {
    if (line.includes('**Asset Manager/ Institutional**')) {
      const cells = line.split('|').map(c => c.trim());
      const longData = parseCell(cells[2]);
      const shortData = parseCell(cells[5]);
      assetManager = {
        long: longData.pos,
        longChange: longData.change,
        short: shortData.pos,
        shortChange: shortData.change,
        net: longData.pos - shortData.pos,
        netChange: longData.change - shortData.change
      };
    }
    if (line.includes('**Leveraged Funds**')) {
      const cells = line.split('|').map(c => c.trim());
      const longData = parseCell(cells[2]);
      const shortData = parseCell(cells[5]);
      leveragedFunds = {
        long: longData.pos,
        longChange: longData.change,
        short: shortData.pos,
        shortChange: shortData.change,
        net: longData.pos - shortData.pos,
        netChange: longData.change - shortData.change
      };
    }
  }

  console.log('COT Date:', dateStr);
  console.log('Open Interest:', openInterest);
  console.log('Asset Manager:', assetManager);
  console.log('Leveraged Funds:', leveragedFunds);
}

testParseCot();
