#!/usr/bin/env node
/**
 * Discovery Script — Find the character gear API endpoint
 * 
 * Loads a specific player page and intercepts XHR/fetch requests
 * to find the API that returns character equipment data.
 */

const puppeteer = require('puppeteer');

const PLAYER_URL = 'https://ironforge.pro/anniversary/player/Spineshatter/G%C3%B9cci/';

(async () => {
  console.log('🔍 Launching browser to find character gear API...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const apiCalls = [];

  page.on('response', async (res) => {
    const url = res.url();
    const type = res.request().resourceType();
    if (['xhr', 'fetch'].includes(type) && url.includes('ironforge.pro')) {
      const status = res.status();
      const contentType = res.headers()['content-type'] || '';
      console.log(`  📡 ${res.request().method()} ${status} ${url}`);
      
      if (contentType.includes('json')) {
        try {
          const body = await res.text();
          console.log(`      Preview (${body.length} chars): ${body.substring(0, 800)}`);
          apiCalls.push({ url, body: body.substring(0, 5000) });
        } catch (e) {
          console.log(`      (Could not read body)`);
        }
      }
    }
  });

  console.log(`🌐 Navigating to ${PLAYER_URL}`);
  await page.goto(PLAYER_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  console.log(`\n📋 Found ${apiCalls.length} Ironforge API calls`);
  
  await browser.close();
  console.log('✅ Done!');
})();
