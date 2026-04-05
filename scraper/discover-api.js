#!/usr/bin/env node
/**
 * Discovery Script — Ironforge.pro API Sniffer
 * 
 * Loads the TBC Anniversary leaderboard page with Puppeteer,
 * intercepts all network requests, and logs any XHR/fetch calls
 * to help us find the internal API endpoint for player data.
 * 
 * Usage: node scraper/discover-api.js
 */

const puppeteer = require('puppeteer');

const TARGET_URL = 'https://ironforge.pro/anniversary/leaderboards/EU/3/';

(async () => {
  console.log('🔍 Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Collect all network requests
  const apiCalls = [];

  page.on('request', (req) => {
    const type = req.resourceType();
    const url = req.url();
    // Only log XHR, fetch, and interesting requests (skip images/css/fonts)
    if (['xhr', 'fetch', 'websocket', 'other'].includes(type)) {
      apiCalls.push({ type, method: req.method(), url });
    }
  });

  page.on('response', async (res) => {
    const url = res.url();
    const type = res.request().resourceType();
    if (['xhr', 'fetch'].includes(type)) {
      const status = res.status();
      const contentType = res.headers()['content-type'] || '';
      console.log(`  📡 ${res.request().method()} ${status} ${url}`);
      console.log(`      Content-Type: ${contentType}`);
      
      // Try to peek at JSON responses
      if (contentType.includes('json')) {
        try {
          const body = await res.text();
          const preview = body.substring(0, 500);
          console.log(`      Preview: ${preview}...`);
        } catch (e) {
          console.log(`      (Could not read body)`);
        }
      }
    }
  });

  console.log(`🌐 Navigating to ${TARGET_URL}`);
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait a bit for any lazy-loaded data
  await new Promise(r => setTimeout(r, 3000));

  console.log('\n═══════════════════════════════════════════');
  console.log('📋 All XHR/Fetch requests captured:');
  console.log('═══════════════════════════════════════════');
  apiCalls.forEach((call, i) => {
    console.log(`  ${i + 1}. [${call.type}] ${call.method} ${call.url}`);
  });

  // Also try to extract data from the page itself
  console.log('\n═══════════════════════════════════════════');
  console.log('🔎 Searching for embedded data in page...');
  console.log('═══════════════════════════════════════════');

  const pageData = await page.evaluate(() => {
    // Check for __NEXT_DATA__ (Next.js)
    const nextData = document.getElementById('__NEXT_DATA__');
    if (nextData) return { source: '__NEXT_DATA__', data: nextData.textContent.substring(0, 2000) };

    // Check for any script tags with JSON data
    const scripts = Array.from(document.querySelectorAll('script'));
    for (const script of scripts) {
      const text = script.textContent;
      if (text.includes('leaderboard') || text.includes('character') || text.includes('rating')) {
        return { source: 'inline-script', data: text.substring(0, 2000) };
      }
    }

    // Check for window.__DATA__ or similar
    const windowKeys = Object.keys(window).filter(k => 
      k.startsWith('__') || k.includes('data') || k.includes('Data') || k.includes('STATE')
    );
    
    return { source: 'window-keys', data: windowKeys.join(', ') };
  });

  console.log(`  Source: ${pageData.source}`);
  console.log(`  Data: ${pageData.data}`);

  // Try to grab the visible table data
  console.log('\n═══════════════════════════════════════════');
  console.log('📊 Visible leaderboard table data:');
  console.log('═══════════════════════════════════════════');

  const tableData = await page.evaluate(() => {
    // Try common table selectors
    const rows = document.querySelectorAll('table tr, .leaderboard-row, [class*="player"], [class*="row"], [class*="entry"]');
    const data = [];
    rows.forEach((row, i) => {
      if (i < 20) { // First 20 rows
        data.push(row.textContent.trim().replace(/\s+/g, ' ').substring(0, 200));
      }
    });
    return data;
  });

  if (tableData.length > 0) {
    tableData.forEach((row, i) => console.log(`  ${i + 1}. ${row}`));
  } else {
    console.log('  No table rows found with standard selectors.');
    
    // Dump the main content area
    const bodyText = await page.evaluate(() => {
      const main = document.querySelector('main, #app, #root, .content, [class*="content"]');
      if (main) return main.textContent.trim().replace(/\s+/g, ' ').substring(0, 3000);
      return document.body.textContent.trim().replace(/\s+/g, ' ').substring(0, 3000);
    });
    console.log(`  Page content preview: ${bodyText}`);
  }

  // Take a screenshot for debugging
  await page.screenshot({ path: 'scraper/leaderboard-screenshot.png', fullPage: true });
  console.log('\n📸 Screenshot saved to scraper/leaderboard-screenshot.png');

  await browser.close();
  console.log('✅ Done!');
})();
