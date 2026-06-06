import fs from 'fs';

async function testCotContent() {
  console.log('Fetching Bitcoin CME COT disaggregated data from Tradingster...');
  try {
    const url = 'https://r.jina.ai/https://tradingster.com/cot/futures/fin/133741';
    console.log('Fetching:', url);
    const res = await fetch(url);
    console.log('Status:', res.status);
    const text = await res.text();
    fs.writeFileSync('scratch/cot_jina.md', text);
    console.log('COT Jina output saved. Length:', text.length);
    console.log('Sample text:', text.slice(0, 1500));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testCotContent();
