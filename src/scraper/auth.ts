import puppeteer, { Browser, Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { CookieData, SessionState, SessionInfo } from './types';

const DEFAULT_COOKIE_PATH = path.join(process.cwd(), 'data', 'cookies.json');
const FB_TEST_URL = 'https://www.facebook.com/me';
const FB_LOGIN_URL = 'https://www.facebook.com/login';

let sessionInfo: SessionInfo = {
  state: 'unknown',
  cookies: [],
};

/**
 * Load cookies from a JSON file on disk.
 */
export function loadCookies(cookiePath: string = DEFAULT_COOKIE_PATH): CookieData[] {
  if (!fs.existsSync(cookiePath)) {
    console.warn(`[auth] Cookie file not found: ${cookiePath}`);
    sessionInfo.state = 'unknown';
    sessionInfo.cookies = [];
    return [];
  }

  const raw = fs.readFileSync(cookiePath, 'utf-8');
  const cookies: CookieData[] = JSON.parse(raw);

  sessionInfo.cookies = cookies;
  console.log(`[auth] Loaded ${cookies.length} cookies from ${cookiePath}`);
  return cookies;
}

/**
 * Save current cookies to a JSON file on disk.
 */
export function saveCookies(cookies: CookieData[], cookiePath: string = DEFAULT_COOKIE_PATH): void {
  const dir = path.dirname(cookiePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2), 'utf-8');
  sessionInfo.cookies = cookies;
  console.log(`[auth] Saved ${cookies.length} cookies to ${cookiePath}`);
}

/**
 * Validate the current session by navigating to Facebook and checking
 * whether we are redirected to a login page.
 */
export async function validateSession(page: Page): Promise<SessionState> {
  try {
    await page.goto(FB_TEST_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    const url = page.url();

    if (url.includes('/login') || url.includes('/checkpoint')) {
      console.log('[auth] Session is expired or invalid (redirected to login/checkpoint)');
      sessionInfo.state = 'expired';
      return 'expired';
    }

    console.log('[auth] Session is valid');
    sessionInfo.state = 'valid';
    sessionInfo.lastValidated = new Date().toISOString();
    return 'valid';
  } catch (err) {
    console.error('[auth] Session validation failed:', err);
    sessionInfo.state = 'unknown';
    return 'unknown';
  }
}

/**
 * Initialize a Puppeteer browser and page with saved cookies applied.
 * Returns the browser and page instances.
 */
export async function initBrowser(
  cookiePath: string = DEFAULT_COOKIE_PATH,
  headless: boolean = true
): Promise<{ browser: Browser; page: Page }> {
  const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    defaultViewport: { width: 1280, height: 800 },
  };

  // Use system Chromium on Raspberry Pi (set via PUPPETEER_EXECUTABLE_PATH)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const browser = await puppeteer.launch(launchOptions);

  const page = await browser.newPage();

  // Reduce automation detection
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  // Load and apply cookies
  const cookies = loadCookies(cookiePath);
  if (cookies.length > 0) {
    await page.setCookie(...cookies);
    console.log(`[auth] Applied ${cookies.length} cookies to browser session`);
  }

  return { browser, page };
}

/**
 * Extract cookies from the current browser page and persist them.
 */
export async function extractAndSaveCookies(
  page: Page,
  cookiePath: string = DEFAULT_COOKIE_PATH
): Promise<CookieData[]> {
  const browserCookies = await page.cookies();
  const cookies: CookieData[] = browserCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite as CookieData['sameSite'],
  }));

  saveCookies(cookies, cookiePath);
  return cookies;
}

/**
 * Get the current session info.
 */
export function getSessionInfo(): SessionInfo {
  return { ...sessionInfo };
}
