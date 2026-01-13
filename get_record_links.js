const puppeteer = require('puppeteer');
const fs = require('fs');

async function getRecordLinks() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    await page.goto('https://www.tabroom.com/index/tourn/fields.mhtml?tourn_id=36610');
    await page.waitForTimeout(3000);
    
    const links = await page.evaluate(() => {
        const allLinks = [];
        const tables = document.querySelectorAll('table');
        
        tables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                cells.forEach(cell => {
                    const links = cell.querySelectorAll('a');
                    links.forEach(link => {
                        if (link.href.includes('team_results') || 
                            link.textContent.toLowerCase().includes('record') ||
                            cell.textContent.toLowerCase().includes('record')) {
                            allLinks.push({
                                text: link.textContent.trim(),
                                href: link.href,
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
    fs.writeFileSync('record_links.json', JSON.stringify(links, null, 2));
    
    await browser.close();
    return links;
}

getRecordLinks();