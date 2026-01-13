const puppeteer = require('puppeteer');
const fs = require('fs');

async function inspectPage() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    await page.goto('https://www.tabroom.com/index/tourn/fields.mhtml?tourn_id=36610');
    await page.waitForTimeout(5000);
    
    const pageData = await page.evaluate(() => {
        const allLinks = Array.from(document.querySelectorAll('a')).map(link => ({
            text: link.textContent.trim(),
            href: link.href
        }));
        
        const recordLinks = allLinks.filter(link => 
            link.href.includes('team_results') || 
            link.text.toLowerCase().includes('record')
        );
        
        return {
            totalLinks: allLinks.length,
            recordLinks: recordLinks,
            sampleLinks: allLinks.slice(0, 10),
            pageTitle: document.title,
            hasTable: document.querySelectorAll('table').length > 0
        };
    });
    
    console.log('Page analysis:', pageData);
    fs.writeFileSync('page_analysis.json', JSON.stringify(pageData, null, 2));
    
    await browser.close();
}

inspectPage();