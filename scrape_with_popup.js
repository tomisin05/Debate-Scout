const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrapeWithPopupHandling() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    // Set up dialog handler before navigation
    page.on('dialog', async dialog => {
        console.log(`Alert popup: "${dialog.message()}"`);
        await dialog.accept();
        console.log('Clicked OK on popup');
    });
    
    await page.goto('https://www.tabroom.com/index/results/team_results.mhtml?id1=1529763&id2=1535986');
    await page.waitForTimeout(3000);
    
    let allTournamentData = [];
    
    // Find tournament cells
    const tournaments = await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('td'));
        return cells.filter(cell => 
            cell.textContent.includes('Memorial') || 
            cell.textContent.includes('Invitational') ||
            cell.textContent.includes('Championship') ||
            cell.textContent.includes('Tournament')
        ).map(cell => cell.textContent.trim()).slice(0, 3);
    });
    
    console.log(`Found ${tournaments.length} tournaments to check`);
    
    for (let i = 0; i < tournaments.length; i++) {
        const tournament = tournaments[i];
        console.log(`\\nClicking tournament ${i + 1}: ${tournament.substring(0, 40)}...`);
        
        // Click tournament
        await page.evaluate((tournamentText) => {
            const cells = Array.from(document.querySelectorAll('td'));
            const cell = cells.find(c => c.textContent.trim() === tournamentText);
            if (cell) cell.click();
        }, tournament);
        
        // Wait for popup and content
        await page.waitForTimeout(3000);
        
        // Extract any new content
        const tournamentData = await page.evaluate(() => {
            const tables = document.querySelectorAll('table');
            const roundData = [];
            
            tables.forEach(table => {
                if (table.innerText.includes('Round') || table.innerText.includes('Judge')) {
                    const rows = table.querySelectorAll('tr');
                    rows.forEach(row => {
                        const cells = row.querySelectorAll('td, th');
                        if (cells.length > 0) {
                            const rowData = Array.from(cells).map(cell => 
                                cell.textContent.trim().replace(/\\s+/g, ' ')
                            );
                            if (rowData.some(cell => cell.length > 0)) {
                                roundData.push(rowData);
                            }
                        }
                    });
                }
            });
            
            return {
                hasRoundData: roundData.length > 0,
                roundData: roundData,
                pageContent: document.body.innerText.includes('Round') ? 
                    document.body.innerText.substring(0, 800) : 'No round data'
            };
        });
        
        if (tournamentData.hasRoundData) {
            console.log(`Found ${tournamentData.roundData.length} rows of round data`);
            allTournamentData.push({
                tournament: tournament,
                data: tournamentData.roundData
            });
        } else {
            console.log('No detailed round data found');
        }
        
        await page.waitForTimeout(1000);
    }
    
    // Save results
    if (allTournamentData.length > 0) {
        fs.writeFileSync('tournament_details_with_popup.json', JSON.stringify(allTournamentData, null, 2));
        console.log(`\\nSaved detailed data for ${allTournamentData.length} tournaments`);
    } else {
        console.log('\\nNo tournament detail data was extracted');
    }
    
    await browser.close();
}

scrapeWithPopupHandling();