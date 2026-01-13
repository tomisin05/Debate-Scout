const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrapeAllEvents() {
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
    
    console.log(`Found ${events.length} events`);
    let allResults = [];
    
    for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
        const event = events[eventIndex];
        console.log(`\nScraping event ${eventIndex + 1}: ${event.text}`);
        
        await page.goto(event.href);
        await page.waitForTimeout(3000);
        
        const links = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href*="team_results"]')).map(link => link.href);
        });
        
        console.log(`Found ${links.length} teams in ${event.text}`);
        
        for (let i = 0; i < links.length; i++) {
            console.log(`Scraping team ${i + 1}/${links.length} from ${event.text}`);
            
            await page.goto(links[i], { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
            
            const results = await page.evaluate(() => {
                const data = [];
                const tables = document.querySelectorAll('table');
                
                tables.forEach(table => {
                    const rows = table.querySelectorAll('tr');
                    rows.forEach(row => {
                        const cells = row.querySelectorAll('td, th');
                        if (cells.length > 0) {
                            const rowData = Array.from(cells).map(cell => 
                                cell.textContent.trim().replace(/\s+/g, ' ')
                            );
                            if (rowData.some(cell => cell.length > 0)) {
                                data.push(rowData);
                            }
                        }
                    });
                });
                
                const teamName = document.querySelector('h3')?.textContent.trim() || 'Unknown Team';
                return { teamName, data, url: window.location.href };
            });
            
            results.event = event.text;
            allResults.push(results);
        }
    }
    
    let csvContent = 'Event,Team,URL,Data\n';
    allResults.forEach(team => {
        team.data.forEach(row => {
            const escapedRow = row.map(cell => 
                cell.includes(',') || cell.includes('"') ? `"${cell.replace(/"/g, '""')}"` : cell
            ).join(',');
            csvContent += `"${team.event}","${team.teamName}","${team.url}","${escapedRow}"\n`;
        });
    });
    
    fs.writeFileSync('all_events_results.csv', csvContent);
    fs.writeFileSync('all_events_results.json', JSON.stringify(allResults, null, 2));
    
    console.log(`\nScraped ${allResults.length} teams from ${events.length} events`);
    
    await browser.close();
}

scrapeAllEvents();