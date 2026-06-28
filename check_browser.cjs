const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.toString()));
  
  // Go to HFT tab directly
  await page.goto('http://localhost:5174/crypto-news/#hft', { waitUntil: 'domcontentloaded' });
  
  // Wait a bit to let it render
  await new Promise(r => setTimeout(r, 4000));
  
  await browser.close();
})();
