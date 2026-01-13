const puppeteer = require('puppeteer');

async function checkTournamentClicks() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    await page.goto('https://www.tabroom.com/index/results/team_results.mhtml?id1=1529763&id2=1535986');
    await page.waitForTimeout(3000);
    
    // Look for clickable tournament names in table cells
    const clickableElements = await page.evaluate(() => {
        const elements = [];
        const cells = document.querySelectorAll('td');
        
        cells.forEach(cell => {
            if (cell.textContent.includes('Memorial') || 
                cell.textContent.includes('Invitational') ||
                cell.textContent.includes('Championship') ||
                cell.textContent.includes('Tournament')) {
                
                // Check if cell or its content is clickable
                const links = cell.querySelectorAll('a');
                if (links.length > 0) {
                    links.forEach(link => {
                        elements.push({
                            text: link.textContent.trim(),
                            href: link.href,
                            type: 'link'
                        });
                    });
                } else if (cell.onclick || cell.style.cursor === 'pointer') {
                    elements.push({
                        text: cell.textContent.trim(),
                        type: 'clickable_cell'
                    });
                }
            }
        });
        
        return elements;
    });
    
    console.log(`Found ${clickableElements.length} clickable tournament elements:`);
    clickableElements.forEach((el, i) => console.log(`${i + 1}. ${el.text} (${el.type})`));
    
    if (clickableElements.length > 0) {
        const firstElement = clickableElements[0];
        console.log(`\nClicking on: ${firstElement.text}`);
        
        if (firstElement.type === 'link') {
            await page.goto(firstElement.href);
        } else {
            // Try clicking on the cell
            await page.click(`td:contains("${firstElement.text.substring(0, 20)}")`);
        }
        
        await page.waitForTimeout(3000);
        
        const pageInfo = await page.evaluate(() => ({
            title: document.title,
            url: window.location.href,
            content: document.body.innerText.substring(0, 500)
        }));
        
        console.log('\nAfter clicking:');
        console.log('Title:', pageInfo.title);
        console.log('URL:', pageInfo.url);
        console.log('Content preview:', pageInfo.content);
    }
    
    await browser.close();
}

checkTournamentClicks();