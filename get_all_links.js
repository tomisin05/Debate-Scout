const puppeteer = require('puppeteer');
const fs = require('fs');

async function getAllLinks() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    await page.goto('https://www.tabroom.com/index/tourn/fields.mhtml?tourn_id=36610');
    await page.waitForTimeout(3000);
    
    const allLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a')).map(link => ({
            text: link.textContent.trim(),
            href: link.href
        })).filter(link => link.href.includes('team_results'));
    });
    
    console.log(`Found ${allLinks.length} team result links`);
    console.log(allLinks);
    fs.writeFileSync('all_record_links.json', JSON.stringify(allLinks, null, 2));
    
    await browser.close();
}

getAllLinks();