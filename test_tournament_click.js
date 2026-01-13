const puppeteer = require('puppeteer');

async function testTournamentClick() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    await page.goto('https://www.tabroom.com/index/results/team_results.mhtml?id1=1711795&id2=1712548');
    await page.waitForTimeout(3000);
    
    // Try clicking on tournament names in table
    const clicked = await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('td'));
        const tournamentCell = cells.find(cell => 
            cell.textContent.includes('FR Shirley') || 
            cell.textContent.includes('West Point') ||
            cell.textContent.includes('Memorial') ||
            cell.textContent.includes('Invitational')
        );
        
        if (tournamentCell) {
            tournamentCell.click();
            return tournamentCell.textContent.trim();
        }
        return null;
    });
    
    if (clicked) {
        console.log(`Clicked on: ${clicked}`);
        await page.waitForTimeout(2000);
        
        // Check for any new content, modals, or popups
        const newContent = await page.evaluate(() => {
            // Look for modals, popups, or new tables
            const modals = document.querySelectorAll('[class*="modal"], [class*="popup"], [id*="modal"], [id*="popup"]');
            const newTables = document.querySelectorAll('table');
            
            return {
                modalCount: modals.length,
                tableCount: newTables.length,
                bodyText: document.body.innerText.includes('Round') && document.body.innerText.includes('Judge') ? 
                    document.body.innerText.substring(0, 1000) : 'No round details found'
            };
        });
        
        console.log('After clicking:');
        console.log(`Modals found: ${newContent.modalCount}`);
        console.log(`Tables found: ${newContent.tableCount}`);
        console.log('Content preview:', newContent.bodyText);
    } else {
        console.log('No tournament cell found to click');
    }
    
    await browser.close();
}

testTournamentClick();