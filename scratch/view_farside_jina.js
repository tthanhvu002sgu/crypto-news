import fs from 'fs';

async function dumpFarside() {
  try {
    const url = 'https://r.jina.ai/https://farside.co.uk/btc/';
    console.log('Fetching Farside...');
    const res = await fetch(url);
    const text = await res.text();
    fs.writeFileSync('scratch/farside_jina.md', text);
    console.log('Farside Jina output saved to scratch/farside_jina.md. Length:', text.length);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

dumpFarside();
