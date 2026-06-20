import axios from 'axios';

export const fetchWithJina = async (targetUrlStr) => {
  const jinaUrl = `https://r.jina.ai/${targetUrlStr}?v=${Date.now()}`;
  try {
    const res = await axios.get(jinaUrl, {
      headers: {
        'Accept': 'text/plain',
      },
      timeout: 15000
    });
    return res.data;
  } catch (e) {
    console.warn(`[Jina Proxy] Failed for ${targetUrlStr}:`, e.message);
    return null;
  }
};

export const getCMECot = async () => {
  try {
    const url = 'https://tradingster.com/cot/futures/fin/133741';
    const markdown = await fetchWithJina(url);
    if (!markdown) return null;
    
    const lines = markdown.split('\n');
    let dateStr = 'N/A';
    
    for (const line of lines) {
      if (line.includes('AS OF:')) {
        const match = line.match(/AS OF:\s*([0-9-]+)/);
        if (match) dateStr = match[1];
      }
    }

    console.log("Date:", dateStr);

  } catch (e) {
    console.error('[API] CME COT error:', e.message);
    return null;
  }
};

getCMECot();
