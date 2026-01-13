const puppeteer = require('puppeteer');

async function handleTournamentPopup() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    await page.goto('https://www.tabroom.com/index/results/team_results.mhtml?id1=1529763&id2=1535986');
    await page.waitForTimeout(3000);
    
    // Click on tournament name
    await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('td'));
        const tournamentCell = cells.find(cell => 
            cell.textContent.includes('Memorial') || 
            cell.textContent.includes('Invitational') ||
            cell.textContent.includes('Championship')
        );
        if (tournamentCell) tournamentCell.click();
    });
    
    await page.waitForTimeout(1000);
    
    // Handle alert popup and click OK
    page.on('dialog', async dialog => {
        console.log('Alert popup:', dialog.message());
        await dialog.accept();
    });
    
    // Wait for any content after clicking OK
    await page.waitForTimeout(2000);
    
    const content = await page.evaluate(() => {
        return {
            title: document.title,
            bodyText: document.body.innerText.substring(0, 500)
        };
    });
    
    console.log('After handling popup:', content);
    
    await browser.close();
}

handleTournamentPopup();