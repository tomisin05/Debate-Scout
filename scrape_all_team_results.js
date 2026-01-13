const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrapeAllTeamResults() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    // Step 1: Get all record links
    console.log('Getting record links...');
    await page.goto('https://www.tabroom.com/index/tourn/fields.mhtml?tourn_id=36610');
    await page.waitForTimeout(3000);
    
    await page.evaluate(() => {
        const eventLinks = document.querySelectorAll('a[href*="event_id"]');
        if (eventLinks.length > 0) eventLinks[0].click();
    });
    await page.waitForTimeout(3000);
    
    const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href*="team_results"]')).map(link => link.href);
    });
    
    console.log(`Found ${links.length} team record links`);
    
    // Step 2: Scrape each team's results
    let allResults = [];
    
    for (let i = 0; i < links.length; i++) {
        console.log(`Scraping team ${i + 1}/${links.length}: ${links[i]}`);
        
        await page.goto(links[i], { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        
        const results = await page.evaluate(() => {
            const data = [];
            const tables = document.querySelectorAll('table');
            
            tables.forEach((table, tableIndex) => {
                const rows = table.querySelectorAll('tr');
                rows.forEach((row, rowIndex) => {
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
        
        allResults.push(results);
    }
    
    // Save results
    let csvContent = 'Team,URL,Data\n';
    allResults.forEach(team => {
        team.data.forEach(row => {
            const escapedRow = row.map(cell => 
                cell.includes(',') || cell.includes('"') ? `"${cell.replace(/"/g, '""')}"` : cell
            ).join(',');
            csvContent += `"${team.teamName}","${team.url}","${escapedRow}"\n`;
        });
    });
    
    fs.writeFileSync('all_team_results.csv', csvContent);
    fs.writeFileSync('all_team_results.json', JSON.stringify(allResults, null, 2));
    
    console.log(`Scraped ${allResults.length} teams. Data saved to all_team_results.csv and all_team_results.json`);
    
    await browser.close();
}

scrapeAllTeamResults();