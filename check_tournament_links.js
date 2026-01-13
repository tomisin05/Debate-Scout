const puppeteer = require('puppeteer');

async function checkTournamentLinks() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    // Go to a team results page
    await page.goto('https://www.tabroom.com/index/results/team_results.mhtml?id1=1529763&id2=1535986');
    await page.waitForTimeout(3000);
    
    // Find tournament name links
    const tournamentLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a')).filter(link => 
            link.textContent.includes('Tournament') || 
            link.textContent.includes('Memorial') ||
            link.textContent.includes('Invitational') ||
            link.textContent.includes('Championship')
        );
        return links.map(link => ({
            text: link.textContent.trim(),
            href: link.href
        }));
    });
    
    console.log(`Found ${tournamentLinks.length} tournament links:`);
    tournamentLinks.forEach((link, i) => console.log(`${i + 1}. ${link.text} - ${link.href}`));
    
    if (tournamentLinks.length > 0) {
        console.log('\nClicking on first tournament link...');
        await page.click(`a[href="${tournamentLinks[0].href}"]`);
        await page.waitForTimeout(3000);
        
        const pageInfo = await page.evaluate(() => ({
            title: document.title,
            url: window.location.href,
            content: document.body.innerText.substring(0, 500)
        }));
        
        console.log('After clicking tournament link:');
        console.log('Title:', pageInfo.title);
        console.log('URL:', pageInfo.url);
        console.log('Content preview:', pageInfo.content);
    }
    
    await browser.close();
}

checkTournamentLinks();