async function testCotUrl() {
  console.log('Testing tradingster.com/cot/cme-bitcoin-futures via Jina...');
  try {
    const url = 'https://r.jina.ai/https://tradingster.com/cot/cme-bitcoin-futures';
    console.log('Fetching:', url);
    const res = await fetch(url);
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Text length:', text.length);
    console.log('Sample text:', text.slice(0, 1500));
  } catch (err) {
    console.error('COT Fetch Error:', err.message);
  }
}

testCotUrl();
