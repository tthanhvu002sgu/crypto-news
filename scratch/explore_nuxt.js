import fs from 'fs';

function run() {
  const content = fs.readFileSync('C:\\Users\\Vu\\Documents\\news\\scratch\\nuxt_state.js', 'utf8');
  
  // The __NUXT__ state is usually a function or an object.
  // In modern Nuxt, it looks like: (function(a, b, c...){ return { data: [ ... ] } })(value1, value2...)
  // Let's write a small script to safely evaluate it or dump it.
  
  try {
    // We can evaluate it in a sandboxed way by wrapping it in an ESM module context
    const parsed = new Function(`
      let window = {};
      ${content};
      return window.__NUXT__;
    `)();
    
    console.log('Nuxt object keys:', Object.keys(parsed));
    fs.writeFileSync('C:\\Users\\Vu\\Documents\\news\\scratch\\nuxt_parsed.json', JSON.stringify(parsed, null, 2));
    console.log('Saved parsed state to nuxt_parsed.json');
    
    // Search for keys like 'etfs', 'etf', 'holdings' or values matching ETF tickers
    // Let's recursively search the object for interesting keys/values
    const results = [];
    function search(obj, path = '') {
      if (obj == null) return;
      if (typeof obj === 'object') {
        for (const k of Object.keys(obj)) {
          search(obj[k], path ? `${path}.${k}` : k);
        }
      } else if (typeof obj === 'string' || typeof obj === 'number') {
        const valStr = String(obj);
        if (valStr.includes('IBIT') || valStr.includes('GBTC') || valStr.includes('FBTC')) {
          results.push({ path, value: obj });
        }
      }
    }
    search(parsed);
    console.log('Matches in parsed __NUXT__ state:', results.slice(0, 15));
  } catch (err) {
    console.error('Failed to parse nuxt state:', err.message);
  }
}

run();
