const puppeteer = require('puppeteer');

async function checkEvents() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    await page.goto('https://www.tabroom.com/index/tourn/fields.mhtml?tourn_id=36610');
    await page.waitForTimeout(3000);
    
    const events = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href*="event_id"]')).map(link => ({
            text: link.textContent.trim(),
            href: link.href
        }));
    });
    
    console.log(`Found ${events.length} events:`);
    events.forEach((event, i) => console.log(`${i + 1}. ${event.text} - ${event.href}`));
    
    await browser.close();
}

checkEvents();