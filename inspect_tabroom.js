const puppeteer = require('puppeteer');

async function inspectTabroomPage() {
    try {
        const browser = await puppeteer.launch({ headless: false });
        const page = await browser.newPage();
        
        // First check the prelims page directly
        console.log('Checking prelims page...');
        await page.goto('https://www.tabroom.com/index/tourn/results/prelims_table.mhtml?tourn_id=36431&result_id=400612', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        
        const pageContent = await page.evaluate(() => {
            return {
                title: document.title,
                bodyText: document.body.innerText.substring(0, 1000),
                loginButtons: Array.from(document.querySelectorAll('a, button')).filter(el => 
                    el.textContent.toLowerCase().includes('login') || 
                    el.textContent.toLowerCase().includes('account')
                ).map(el => ({
                    text: el.textContent.trim(),
                    href: el.href || 'no href',
                    tag: el.tagName
                }))
            };
        });
        
        console.log('Page Title:', pageContent.title);
        console.log('Page Content (first 1000 chars):', pageContent.bodyText);
        console.log('Login/Account buttons found:', pageContent.loginButtons);
        
        await browser.close();
    } catch (error) {
        console.log('Error:', error.message);
    }
}

inspectTabroomPage();