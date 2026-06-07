async function run() {
  try {
    // Dynamically import the ES module api.js
    const api = await import('./src/services/api.js');
    
    console.log("Calling getYahooStockQuote for various tickers...");
    
    const dxy = await api.getDXYQuote();
    console.log("DXY Quote:", dxy);
    
    const yield10y = await api.getYahooStockQuote('^TNX');
    console.log("10Y Treasury Yield:", yield10y);
    
    const sp500 = await api.getFREDStockQuote('SP500');
    console.log("S&P 500 Quote:", sp500);
    
    const nasdaq = await api.getFREDStockQuote('NASDAQ100');
    console.log("Nasdaq 100 Quote:", nasdaq);
    
    const vix = await api.getFREDStockQuote('VIXCLS');
    console.log("VIX Quote:", vix);
    
  } catch (e) {
    console.error("Test execution failed:", e);
  }
}

run();
