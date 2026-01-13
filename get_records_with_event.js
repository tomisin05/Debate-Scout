const puppeteer = require('puppeteer');
const fs = require('fs');

async function getRecordLinks() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    await page.goto('https://www.tabroom.com/index/tourn/fields.mhtml?tourn_id=36610');
    await page.waitForTimeout(3000);
    
    // Click on the first event/division link
    await page.evaluate(() => {
        const eventLinks = document.querySelectorAll('a[href*="event_id"]');
        if (eventLinks.length > 0) {
            eventLinks[0].click();
        }
    });
    
    await page.waitForTimeout(3000);
    
    // Extract record links from the table
    const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href*="team_results"]')).map(link => ({
            text: link.textContent.trim(),
            href: link.href
        }));
    });
    
    console.log(`Found ${links.length} record links`);
    fs.writeFileSync('record_links.json', JSON.stringify(links, null, 2));
    
    await browser.close();
}

getRecordLinks();