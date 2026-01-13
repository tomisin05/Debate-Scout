const puppeteer = require('puppeteer');
const fs = require('fs');

async function getRecordLinksWithLogin() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    // Go to the target page first to see if login is required
    await page.goto('https://www.tabroom.com/index/tourn/fields.mhtml?tourn_id=36610');
    await page.waitForTimeout(3000);
    
    // Check if we need to login
    const needsLogin = await page.evaluate(() => {
        return document.body.innerText.includes('Login') || 
               document.querySelector('input[type="password"]') !== null;
    });
    
    if (needsLogin) {
        console.log('Login required. Please login manually in the browser window.');
        console.log('Press Enter after logging in...');
        
        // Wait for user to login manually
        await new Promise(resolve => {
            process.stdin.once('data', () => resolve());
        });
        
        // Navigate back to the page after login
        await page.goto('https://www.tabroom.com/index/tourn/fields.mhtml?tourn_id=36610');
        await page.waitForTimeout(3000);
    }
    
    // Extract all links that might be record links
    const links = await page.evaluate(() => {
        const allLinks = [];
        
        // Look for all links in table cells
        const tables = document.querySelectorAll('table');
        tables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            rows.forEach((row, rowIndex) => {
                const cells = row.querySelectorAll('td, th');
                cells.forEach((cell, cellIndex) => {
                    const cellLinks = cell.querySelectorAll('a');
                    cellLinks.forEach(link => {
                        if (link.href && link.href.includes('team_results')) {
                            allLinks.push({
                                text: link.textContent.trim(),
                                href: link.href,
                                rowIndex,
                                cellIndex,
                                cellText: cell.textContent.trim()
                            });
                        }
                    });
                });
            });
        });
        
        return allLinks;
    });
    
    console.log(`Found ${links.length} record links`);
    console.log(links);
    
    fs.writeFileSync('record_links_final.json', JSON.stringify(links, null, 2));
    
    await browser.close();
    return links;
}

getRecordLinksWithLogin();