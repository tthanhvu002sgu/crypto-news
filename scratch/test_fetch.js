import fs from 'fs';

async function test() {
  console.log('Testing fetches to public ETF pages...');
  
  try {
    console.log('Fetching bitbo.io/etf/ ...');
    const res = await fetch('https://bitbo.io/etf/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    console.log('Bitbo Status:', res.status);
    const text = await res.text();
    console.log('Bitbo Length:', text.length);
    fs.writeFileSync('C:\\Users\\Vu\\Documents\\news\\scratch\\bitbo_sample.html', text.slice(0, 5000));
  } catch (err) {
    console.error('Bitbo Fetch Error:', err.message);
  }

  try {
    console.log('Fetching farside.co.uk/btc/ ...');
    const res = await fetch('https://farside.co.uk/btc/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    console.log('Farside Status:', res.status);
    const text = await res.text();
    console.log('Farside Length:', text.length);
    fs.writeFileSync('C:\\Users\\Vu\\Documents\\news\\scratch\\farside_sample.html', text.slice(0, 5000));
  } catch (err) {
    console.error('Farside Fetch Error:', err.message);
  }
}

test();
