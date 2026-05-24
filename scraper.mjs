/**
 * opencaselist.com scraper — improved version
 *
 * Improvements over original:
 *  - Dynamic year discovery: no more hardcoding "ndtceda25"
 *  - Dynamic school discovery: reads schools from the caselist page
 *  - Resume support: skips schools/teams already present in output file
 *  - CLI flags (--year, --school, --output, --phase, --resume, --concurrency)
 *  - Session reuse: logs in once per browser lifecycle, not per page
 *  - Exponential backoff retries with jitter
 *  - Structured JSON output with metadata
 *  - Configurable batch size and delays
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

// ─── CLI argument parsing ─────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        year: null,            // e.g. "ndtceda25" — discovered dynamically if omitted
        schools: [],           // filter to specific schools (comma-separated)
        output: 'data.json',
        mapFile: 'round_count_map.json',
        errorsFile: 'scrape_errors.json',
        phase: 'all',          // "map" | "scrape" | "retry" | "all"
        resume: true,          // skip already-done teams
        batchSize: 5,
        batchDelay: 2 * 60_000, // ms between batches
        pageDelay: 1500,        // ms between page loads
        username: process.env.OPENCASELIST_USERNAME || 'tyur55357@gmail.com',
        password: process.env.OPENCASELIST_PASSWORD || 'Debate-Scrapper',
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--year':        opts.year        = args[++i]; break;
            case '--school':      opts.schools     = args[++i].split(',').map(s => s.trim()); break;
            case '--output':      opts.output      = args[++i]; break;
            case '--phase':       opts.phase       = args[++i]; break;
            case '--no-resume':   opts.resume      = false;     break;
            case '--batch-size':  opts.batchSize   = +args[++i]; break;
            case '--batch-delay': opts.batchDelay  = +args[++i] * 1000; break;
            case '--username':    opts.username    = args[++i]; break;
            case '--password':    opts.password    = args[++i]; break;
            case '--help':
                console.log(`Usage: node scraper.mjs [options]

Options:
  --year <slug>          Caselist year slug, e.g. ndtceda25 (auto-detected if omitted)
  --school <names>       Comma-separated school names to limit scraping to
  --output <file>        Output JSON file (default: data.json)
  --phase <phase>        One of: map | scrape | retry | all (default: all)
  --no-resume            Re-scrape everything, ignoring existing output
  --batch-size <n>       Schools per batch (default: 5)
  --batch-delay <secs>   Seconds between batches (default: 300)
  --username <email>     Login email
  --password <pass>      Login password

Environment variables:
  OPENCASELIST_USERNAME
  OPENCASELIST_PASSWORD
`);
                process.exit(0);
        }
    }
    return opts;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Jittered sleep: base ± 40% */
const jitter = ms => sleep(ms * (0.6 + Math.random() * 0.8));

function saveJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function loadJSON(filepath, fallback = null) {
    try {
        return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    } catch {
        return fallback;
    }
}

function schoolToSlug(school) {
    return school.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
}

/** Exponential backoff retry wrapper */
async function withRetry(fn, maxAttempts = 3, baseDelay = 2000) {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn(attempt);
        } catch (err) {
            lastErr = err;
            if (attempt < maxAttempts) {
                const delay = baseDelay * Math.pow(2, attempt - 1);
                console.log(`    ↺ attempt ${attempt} failed (${err.message}), retrying in ${delay / 1000}s…`);
                await sleep(delay);
            }
        }
    }
    throw lastErr;
}

// ─── Browser / session management ────────────────────────────────────────────

async function launchBrowser() {
    return puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
}

/**
 * Log in once on a page and persist the session.
 * Returns the page so callers can reuse it.
 */
async function loginPage(browser, username, password) {
    const page = await browser.newPage();
    page.setDefaultTimeout(60_000);
    await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });

    // Clear fields first in case of autofill
    await page.$eval('input[name="username"]', el => (el.value = ''));
    await page.type('input[name="username"]', username, { delay: 30 });
    await page.$eval('input[name="password"]', el => (el.value = ''));
    await page.type('input[name="password"]', password, { delay: 30 });
    await page.click('button[type="submit"]');
    await sleep(5000);

    // Verify login by checking for a logged-in indicator
    const loggedIn = await page.evaluate(() => {
        const text = document.body.innerText;
        return !text.includes('Log In') && !text.includes('Sign In');
    });
    if (!loggedIn) {
        console.warn('  ⚠  Login may have failed — continuing anyway');
    }
    return page;
}

// ─── Phase 0: Discover available years ───────────────────────────────────────

async function discoverYears(page) {
    console.log('Discovering available caselist years…');
    await page.goto('https://opencaselist.com', { waitUntil: 'networkidle2' });
    await sleep(2000);

    const years = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href]'));
        return links
            .map(a => a.href.match(/opencaselist\.com\/([a-z]+\d{2})\b/)?.[1])
            .filter(Boolean)
            .filter((v, i, arr) => arr.indexOf(v) === i); // unique
    });

    if (years.length === 0) {
        // Fallback: try known pattern
        return ['ndtceda25'];
    }
    console.log('  Found years:', years.join(', '));
    return years;
}

// ─── Phase 0b: Discover schools for a given year ─────────────────────────────

async function discoverSchools(page, yearSlug) {
    console.log(`\nDiscovering schools for ${yearSlug}…`);
    await page.goto(`https://opencaselist.com/${yearSlug}`, { waitUntil: 'networkidle2' });
    await sleep(3000);

    // Reload if page looks empty
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (bodyText.length < 500) {
        console.log('  Page looks thin, reloading…');
        await page.reload({ waitUntil: 'networkidle2' });
        await sleep(3000);
    }

    const schools = await page.evaluate((slug) => {
        const links = Array.from(document.querySelectorAll(`a[href*="/${slug}/"]`));
        return links
            .map(a => ({
                name: a.textContent.trim(),
                href: a.href,
                slug: a.href.match(new RegExp(`/${slug}/([^/]+)`))?.[1],
            }))
            .filter(s => {
                // Exclude bulk downloads and recently modified sections
                const name = s.name.toLowerCase();
                const slug = s.slug?.toLowerCase() || '';
                return s.name && s.slug && 
                       !s.href.includes('/All') &&
                       !name.includes('bulk download') &&
                       !name.includes('recently modified') &&
                       !name.includes('download') &&
                       !name.includes('modified') &&
                       !slug.includes('bulk') &&
                       !slug.includes('recently') &&
                       !slug.includes('modified') &&
                       s.name !== 'Recently Modified' &&
                       s.name !== 'Bulk Downloads' &&
                       s.slug !== 'RecentlyModified' &&
                       s.slug !== 'BulkDownloads' &&
                       s.name.length > 2; // Filter out very short names
            })
            .filter((s, i, arr) => arr.findIndex(x => x.slug === s.slug) === i);
    }, yearSlug);

    console.log(`  Found ${schools.length} schools`);
    return schools;
}

// ─── Phase 1: Round count map ─────────────────────────────────────────────────

/**
 * For a single team page, count how many valid rounds are listed.
 * Returns null if the table can't be found (page failed to load).
 */
async function countRoundsOnPage(page) {
    return page.evaluate(() => {
        const HEADERS = ['Tournament', 'Round', 'Side'];
        const tables = Array.from(document.querySelectorAll('table'));
        const roundsTable = tables.find(t => {
            const ths = Array.from(t.querySelectorAll('tr:first-child td, tr:first-child th'))
                .map(h => h.innerText.trim());
            return HEADERS.every(h => ths.includes(h));
        });

        if (!roundsTable) return null;
        if (document.body.innerText.includes('No rounds yet, add one!')) return 0;

        const rows = Array.from(roundsTable.querySelectorAll('tr')).slice(1);
        return rows.filter(r => {
            const cells = r.querySelectorAll('td');
            const tourn = cells[0]?.innerText.trim();
            const round = cells[1]?.innerText.trim();
            return tourn && round;
        }).length;
    });
}

async function createRoundCountMap(browser, schools, yearSlug, opts) {
    console.log('\n═══ PHASE 1: Building round-count map ═══\n');
    const existing = opts.resume ? loadJSON(opts.mapFile, {}) : {};

    for (let i = 0; i < schools.length; i += opts.batchSize) {
        const batch = schools.slice(i, i + opts.batchSize);
        console.log(`\nBatch ${Math.floor(i / opts.batchSize) + 1}/${Math.ceil(schools.length / opts.batchSize)}`);

        for (const school of batch) {
            if (opts.resume && existing[school.name] && Object.keys(existing[school.name]).length > 0) {
                console.log(`  ✓ ${school.name} already mapped, skipping`);
                continue;
            }

            let page;
            try {
                page = await loginPage(browser, opts.username, opts.password);
                console.log(`  Mapping: ${school.name}`);

                await page.goto(school.href || `https://opencaselist.com/${yearSlug}/${school.slug}`,
                    { waitUntil: 'networkidle2' });
                await jitter(opts.pageDelay);

                const teamLinks = await page.evaluate((yearSlug) => {
                    const links = Array.from(document.querySelectorAll('a[href]'));
                    return links
                        .filter(a => {
                            const m = a.href.match(new RegExp(`/${yearSlug}/([^/]+)/([^/]+)`));
                            return m && !a.href.includes('/All');
                        })
                        .map(a => ({ name: a.textContent.trim(), href: a.href }))
                        .filter(l => l.name && l.name !== 'Aff' && l.name !== 'Neg')
                        .filter((l, i, arr) => arr.findIndex(x => x.href === l.href) === i);
                }, yearSlug);

                console.log(`    Found ${teamLinks.length} teams`);
                existing[school.name] = existing[school.name] || {};

                for (const team of teamLinks) {
                    if (opts.resume && team.name in (existing[school.name] || {})) continue;
                    try {
                        await page.goto(team.href, { waitUntil: 'domcontentloaded' });
                        await jitter(opts.pageDelay);
                        const count = await countRoundsOnPage(page);
                        if (count !== null) {
                            existing[school.name][team.name] = count;
                            console.log(`      ${team.name}: ${count} rounds`);
                        } else {
                            console.log(`      ${team.name}: table not found (will retry)`);
                        }
                    } catch (err) {
                        console.log(`      ${team.name}: error — ${err.message}`);
                    }
                }
            } catch (err) {
                console.log(`  Error mapping ${school.name}: ${err.message}`);
            } finally {
                if (page) await page.close();
            }
        }

        saveJSON(opts.mapFile, existing);
        console.log(`  ✔ Map saved (${Object.keys(existing).length} schools)`);

        if (i + opts.batchSize < schools.length) {
            console.log(`\n⏳ Waiting ${opts.batchDelay / 1000}s before next batch…`);
            await sleep(opts.batchDelay);
        }
    }

    return existing;
}

// ─── Phase 1.5: Retry teams missing from map ─────────────────────────────────

async function retryMissingTeams(browser, schools, yearSlug, opts) {
    console.log('\n═══ PHASE 1.5: Retrying missing teams ═══\n');
    const map = loadJSON(opts.mapFile, {});
    const missing = [];

    let page = await loginPage(browser, opts.username, opts.password);
    try {
        for (const school of schools) {
            if (!map[school.name]) continue;
            await page.goto(school.href || `https://opencaselist.com/${yearSlug}/${school.slug}`,
                { waitUntil: 'networkidle2' });
            await jitter(opts.pageDelay);

            const teamLinks = await page.evaluate((yearSlug) => {
                return Array.from(document.querySelectorAll('a[href]'))
                    .filter(a => new RegExp(`/${yearSlug}/[^/]+/[^/]+`).test(a.href) && !a.href.includes('/All'))
                    .map(a => ({ name: a.textContent.trim(), href: a.href }))
                    .filter(l => l.name && l.name !== 'Aff' && l.name !== 'Neg')
                    .filter((l, i, arr) => arr.findIndex(x => x.href === l.href) === i);
            }, yearSlug);

            for (const team of teamLinks) {
                if (!(team.name in map[school.name])) {
                    missing.push({ school: school.name, team, href: team.href });
                }
            }
        }
    } finally {
        await page.close();
    }

    console.log(`Found ${missing.length} teams to retry`);

    for (const { school, team } of missing) {
        let pg;
        try {
            pg = await loginPage(browser, opts.username, opts.password);
            await pg.goto(team.href, { waitUntil: 'domcontentloaded' });
            await jitter(opts.pageDelay);
            const count = await countRoundsOnPage(pg);
            if (count !== null) {
                map[school][team.name] = count;
                console.log(`  ${school} / ${team.name}: ${count} rounds`);
            } else {
                console.log(`  ${school} / ${team.name}: still failing`);
            }
        } catch (err) {
            console.log(`  ${school} / ${team.name}: ${err.message}`);
        } finally {
            if (pg) await pg.close();
        }
    }

    saveJSON(opts.mapFile, map);
    return map;
}

// ─── Phase 2: Full scrape with verification ───────────────────────────────────

/**
 * Extract all round data from the current team page.
 */
async function extractRounds(page) {
    return page.evaluate(() => {
        const HEADERS = ['Tournament', 'Round', 'Side'];
        const tables = Array.from(document.querySelectorAll('table'));
        const roundsTable = tables.find(t => {
            const ths = Array.from(t.querySelectorAll('tr:first-child td, tr:first-child th'))
                .map(h => h.innerText.trim());
            return HEADERS.every(h => ths.includes(h));
        });

        if (!roundsTable) return [];
        if (document.body.innerText.includes('No rounds yet, add one!')) return [];

        return Array.from(roundsTable.querySelectorAll('tr')).slice(1).reduce((acc, row) => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 6) return acc;

            const tournament = cells[0]?.innerText.trim();
            const round      = cells[1]?.innerText.trim();
            if (!tournament || !round) return acc;

            const side        = cells[2]?.innerText.trim() || '';
            const opponent    = cells[3]?.innerText.trim() || '';
            const judge       = cells[4]?.innerText.trim() || '';
            const roundReport = cells[5]?.innerText.trim() || '';

            let previewUrl  = null;
            let downloadUrl = null;

            if (cells[6]) {
                const link = cells[6].querySelector('a[href*="/preview"]');
                if (link) {
                    previewUrl = link.href;
                    try {
                        const p = new URLSearchParams(new URL(previewUrl).search).get('path');
                        if (p) downloadUrl = `https://api.opencaselist.com/v1/download?path=${encodeURIComponent(p)}`;
                    } catch {}
                }
            }

            acc.push({ tournament, round, side, opponent, judge, roundReport, previewUrl, downloadUrl });
            return acc;
        }, []);
    });
}

async function scrapeWithVerification(browser, schools, yearSlug, roundCountMap, opts) {
    console.log('\n═══ PHASE 2: Scraping rounds ═══\n');

    const existing = opts.resume ? loadJSON(opts.output, { meta: {}, rounds: [] }) : { meta: {}, rounds: [] };
    if (!existing.rounds) existing.rounds = [];

    // Build a set of already-scraped (school, team) pairs for resume
    const done = new Set(existing.rounds.map(r => `${r.year}|${r.school}|${r.team}`));
    const errors = [];
    let totalAdded = 0;

    for (let i = 0; i < schools.length; i += opts.batchSize) {
        const batch = schools.slice(i, i + opts.batchSize);
        console.log(`\nBatch ${Math.floor(i / opts.batchSize) + 1}/${Math.ceil(schools.length / opts.batchSize)}`);

        for (const school of batch) {
            let page;
            try {
                console.log(`\n  School: ${school.name}`);
                page = await loginPage(browser, opts.username, opts.password);

                await page.goto(school.href || `https://opencaselist.com/${yearSlug}/${school.slug}`,
                    { waitUntil: 'networkidle2' });
                await jitter(opts.pageDelay);

                const teamLinks = await page.evaluate((yearSlug) => {
                    return Array.from(document.querySelectorAll('a[href]'))
                        .filter(a => new RegExp(`/${yearSlug}/[^/]+/[^/]+`).test(a.href) && !a.href.includes('/All'))
                        .map(a => ({ name: a.textContent.trim(), href: a.href }))
                        .filter(l => l.name && l.name !== 'Aff' && l.name !== 'Neg')
                        .filter((l, i, arr) => arr.findIndex(x => x.href === l.href) === i);
                }, yearSlug);

                console.log(`    Teams: ${teamLinks.length}`);

                for (const team of teamLinks) {
                    const doneKey = `${yearSlug}|${school.name}|${team.name}`;
                    if (opts.resume && done.has(doneKey)) {
                        console.log(`    ✓ ${team.name} already scraped`);
                        continue;
                    }

                    const expected = roundCountMap[school.name]?.[team.name] ?? null;

                    let rounds = [];
                    let succeeded = false;

                    try {
                        await withRetry(async (attempt) => {
                            await page.goto(team.href, { waitUntil: 'domcontentloaded' });
                            await jitter(opts.pageDelay);
                            rounds = await extractRounds(page);

                            if (expected !== null && expected > 0 && rounds.length !== expected) {
                                throw new Error(`round mismatch: got ${rounds.length}, expected ${expected}`);
                            }
                            succeeded = true;
                        }, 3, 2000);
                    } catch (err) {
                        console.log(`    ✗ ${team.name}: ${err.message}`);
                        errors.push({ year: yearSlug, school: school.name, team: team.name, error: err.message });
                    }

                    if (succeeded) {
                        const records = rounds.map(r => ({
                            year: yearSlug,
                            school: school.name,
                            team: team.name,
                            ...r,
                            scrapedAt: new Date().toISOString(),
                        }));
                        existing.rounds.push(...records);
                        totalAdded += records.length;
                        console.log(`    ✓ ${team.name}: ${rounds.length} rounds`);
                    }

                    await jitter(500);
                }

                // Save progress after each school
                existing.meta = {
                    lastUpdated: new Date().toISOString(),
                    totalRounds: existing.rounds.length,
                    year: yearSlug,
                };
                saveJSON(opts.output, existing);
                console.log(`    Progress saved — ${existing.rounds.length} total rounds`);

            } catch (err) {
                console.log(`  Error on ${school.name}: ${err.message}`);
                errors.push({ year: yearSlug, school: school.name, error: err.message });
            } finally {
                if (page) await page.close();
            }
        }

        if (i + opts.batchSize < schools.length) {
            console.log(`\n⏳ Waiting ${opts.batchDelay / 1000}s…`);
            await sleep(opts.batchDelay);
        }
    }

    if (errors.length > 0) {
        const prev = loadJSON(opts.errorsFile, []);
        saveJSON(opts.errorsFile, [...prev, ...errors]);
        console.log(`\n${errors.length} errors saved to ${opts.errorsFile}`);
    }

    return existing;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const opts = parseArgs();
    console.log('═══ opencaselist scraper ═══');
    console.log('Phase:', opts.phase);
    console.log('Resume:', opts.resume);
    console.log('Output:', opts.output);

    let browser;
    try {
        browser = await launchBrowser();

        // ── Step 1: Determine which year(s) to scrape ───────────────────────
        let yearsToScrape = [];
        
        if (opts.year) {
            // Single year specified
            yearsToScrape = [opts.year];
        } else {
            // Discover all available years
            const page = await loginPage(browser, opts.username, opts.password);
            const allYears = await discoverYears(page);
            await page.close();

            if (allYears.length === 0) {
                console.error('No caselist years found. Use --year to specify one manually.');
                process.exit(1);
            }

            // Filter years 2020-2025 (only ndtceda format)
            yearsToScrape = allYears.filter(year => {
                const match = year.match(/^ndtceda(\d{2})$/);
                if (match) {
                    const yearNum = parseInt(match[1]);
                    return yearNum >= 20 && yearNum <= 25;
                }
                return false;
            }).sort(); // Sort to process chronologically

            console.log(`Found years 2020-2025: ${yearsToScrape.join(', ')}`);
        }

        // ── Step 2: Process each year ────────────────────────────────────────
        for (const yearSlug of yearsToScrape) {
            console.log(`\n\n🗓️  Processing year: ${yearSlug}`);
            console.log('═'.repeat(50));

            // Create year-specific output files
            const yearOpts = {
                ...opts,
                output: `data_${yearSlug}.json`,
                mapFile: `round_count_map_${yearSlug}.json`,
                errorsFile: `scrape_errors_${yearSlug}.json`
            };

            try {
                // ── Discover schools for this year ──────────────────────────
                let schools;
                {
                    const page = await loginPage(browser, yearOpts.username, yearOpts.password);
                    schools = await discoverSchools(page, yearSlug);
                    await page.close();
                }

                if (yearOpts.schools.length > 0) {
                    const filter = new Set(yearOpts.schools.map(s => s.toLowerCase()));
                    schools = schools.filter(s => filter.has(s.name.toLowerCase()) || filter.has(s.slug?.toLowerCase()));
                    console.log(`Filtered to ${schools.length} schools: ${schools.map(s => s.name).join(', ')}`);
                }

                if (schools.length === 0) {
                    console.log(`⚠️  No schools found for ${yearSlug}, skipping`);
                    continue;
                }

                // ── Run selected phases for this year ───────────────────────
                let roundCountMap = {};

                if (['map', 'all'].includes(yearOpts.phase)) {
                    roundCountMap = await createRoundCountMap(browser, schools, yearSlug, yearOpts);
                    await retryMissingTeams(browser, schools, yearSlug, yearOpts);
                }

                // Always reload map from disk (may have been updated by retry phase)
                roundCountMap = loadJSON(yearOpts.mapFile, {});

                if (['scrape', 'all'].includes(yearOpts.phase)) {
                    const result = await scrapeWithVerification(browser, schools, yearSlug, roundCountMap, yearOpts);
                    console.log(`\n✔ ${yearSlug} completed. ${result.rounds.length} rounds in ${yearOpts.output}`);
                }

                if (yearOpts.phase === 'retry') {
                    await retryMissingTeams(browser, schools, yearSlug, yearOpts);
                }

            } catch (yearError) {
                console.error(`❌ Error processing ${yearSlug}:`, yearError.message);
                console.log(`Continuing with next year...\n`);
            }
        }

        // ── Combine all years into single file (optional) ────────────────────
        if (yearsToScrape.length > 1 && ['scrape', 'all'].includes(opts.phase)) {
            console.log('\n🔗 Combining all years into single file...');
            const combinedData = {
                meta: {
                    lastUpdated: new Date().toISOString(),
                    years: yearsToScrape,
                    totalRounds: 0
                },
                rounds: []
            };

            for (const yearSlug of yearsToScrape) {
                const yearData = loadJSON(`data_${yearSlug}.json`, { rounds: [] });
                if (yearData.rounds) {
                    combinedData.rounds.push(...yearData.rounds);
                }
            }

            combinedData.meta.totalRounds = combinedData.rounds.length;
            saveJSON('data_all_years.json', combinedData);
            console.log(`✔ Combined file saved: data_all_years.json (${combinedData.rounds.length} total rounds)`);
        }

    } finally {
        if (browser) await browser.close();
    }
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
