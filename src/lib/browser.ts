/**
 * Browser Module v13 - Basado en core/browser.py de Sonny
 *
 * FIX CRÍTICO v13:
 *   Eliminados completamente count_js y extract_js como strings.
 *   Playwright en Node.js serializa funciones reales correctamente.
 *   Los strings con '\n' dentro de template literals causaban
 *   SyntaxError al interpolarse en page.evaluate().
 *
 *   SOLUCIÓN: funciones TypeScript reales pasadas a page.evaluate(fn, arg).
 */

import type { BrowserContext, Page, Browser } from 'playwright';

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE SITIOS (solo URLs y selectores — sin JS strings)
// ══════════════════════════════════════════════════════════════════════════════

export const AI_SITES: Record<string, {
  url: string;
  name: string;
  input_sel: string;
  send_sel: string;
  response_sel: string;
  session_file: string;
}> = {
  chatgpt: {
    url: 'https://chatgpt.com/',
    name: 'ChatGPT',
    input_sel: '#prompt-textarea, textarea[placeholder*="Message"], div[contenteditable="true"]',
    send_sel: 'button[data-testid="send-button"], button[aria-label="Send"], button[type="submit"]',
    response_sel: '[data-message-author-role="assistant"]',
    session_file: 'chatgpt_session',
  },
  claude: {
    url: 'https://claude.ai/new',
    name: 'Claude',
    input_sel: '[contenteditable="true"]',
    send_sel: 'button[aria-label="Send message"], button[aria-label="Enviar mensaje"], button[aria-label="Enviar"]',
    response_sel: '[data-testid="assistant-message"], .font-claude-message',
    session_file: 'claude_session',
  },
  gemini: {
    url: 'https://gemini.google.com/app',
    name: 'Gemini',
    input_sel: '.ql-editor, textarea, div[contenteditable="true"]',
    send_sel: 'button[aria-label="Send"], button[aria-label="Enviar"], button[aria-label="Send message"]',
    response_sel: '.model-response-text',
    session_file: 'gemini_session',
  },
  qwen: {
    url: 'https://chat.qwen.ai/',
    name: 'Qwen',
    input_sel: 'textarea, div[contenteditable="true"]',
    send_sel: 'button[type="submit"], button[aria-label*="send" i]',
    response_sel: '.markdown-body',
    session_file: 'qwen_session',
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// FUNCIONES DE EXTRACCIÓN — funciones reales, NO strings
// Playwright las serializa y ejecuta correctamente en el navegador.
// ══════════════════════════════════════════════════════════════════════════════

async function countResponses(page: Page, siteKey: string): Promise<number> {
  if (siteKey === 'chatgpt') {
    return page.evaluate(() => {
      let count = document.querySelectorAll('[data-message-author-role="assistant"]').length;
      if (count > 0) return count;
      count = document.querySelectorAll('.agent-turn').length;
      if (count > 0) return count;
      const arts = document.querySelectorAll('article[data-testid*="conversation-turn"]');
      if (arts.length > 0) return Math.floor(arts.length / 2);
      return document.querySelectorAll('[class*="markdown"]').length;
    });
  }
  if (siteKey === 'claude') {
    return page.evaluate(() =>
      document.querySelectorAll('[data-test-render-count]').length
    );
  }
  if (siteKey === 'gemini') {
    return page.evaluate(() =>
      document.querySelectorAll('.model-response-text').length
    );
  }
  if (siteKey === 'qwen') {
    return page.evaluate(() =>
      document.querySelectorAll('.markdown-body').length
    );
  }
  return 0;
}

async function extractResponse(page: Page, siteKey: string, prevCount: number): Promise<string> {
  if (siteKey === 'chatgpt') {
    return page.evaluate((prev: number) => {
      // Intentar múltiples selectores
      let msgs: Element[] = Array.from(
        document.querySelectorAll('[data-message-author-role="assistant"]')
      );
      if (msgs.length === 0)
        msgs = Array.from(document.querySelectorAll('.agent-turn'));
      if (msgs.length === 0) {
        const arts = Array.from(
          document.querySelectorAll('article[data-testid*="conversation-turn"]')
        );
        if (arts.length >= 2) msgs = [arts[arts.length - 1]];
      }
      if (msgs.length === 0) {
        const md = Array.from(document.querySelectorAll('[class*="markdown"]'));
        if (md.length > 0) msgs = [md[md.length - 1]];
      }
      if (msgs.length <= prev) return '';

      const newest = msgs[msgs.length - 1] as HTMLElement;
      const quickText = (newest.innerText || newest.textContent || '').trim();
      if (!quickText || quickText.length < 2) return '';

      const clone = newest.cloneNode(true) as HTMLElement;

      // Eliminar botones de UI
      const uiSelectors = [
        '[data-testid="copy-turn-action-button"]',
        '[data-testid="good-response-turn-action-button"]',
        '[data-testid="bad-response-turn-action-button"]',
        '[data-testid="thumbs-up-button"]',
        '[data-testid="thumbs-down-button"]',
        '[data-testid="voice-play-turn-action-button"]',
        '[data-testid="regenerate-button"]',
        'button[aria-label="Copy"]',
        'button[aria-label="Copiar"]',
      ].join(', ');
      clone.querySelectorAll(uiSelectors).forEach(el => el.remove());

      // Preservar newlines en bloques <pre>
      clone.querySelectorAll('pre').forEach(pre => {
        pre.querySelectorAll('br').forEach(br => {
          br.parentNode!.replaceChild(document.createTextNode('\n'), br);
        });
        const txt = pre.textContent || '';
        pre.parentNode!.replaceChild(document.createTextNode('\n' + txt + '\n'), pre);
      });

      // <br> fuera de <pre>
      clone.querySelectorAll('br').forEach(br => {
        br.parentNode!.replaceChild(document.createTextNode('\n'), br);
      });

      const result = (clone.innerText || clone.textContent || '').trim();
      return result.length < 10 && quickText.length > result.length * 2
        ? quickText
        : result;
    }, prevCount);
  }

  if (siteKey === 'claude') {
    return page.evaluate((prev: number) => {
      const renders = Array.from(
        document.querySelectorAll('[data-test-render-count]')
      ) as HTMLElement[];
      if (renders.length <= prev) return '';
      const newest = renders[renders.length - 1];
      const responseDiv = (newest.querySelector('.font-claude-response') || newest) as HTMLElement;
      const clone = responseDiv.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-testid="thinking-block"], .thinking-block, details')
        .forEach(t => t.remove());
      return clone.innerText.trim();
    }, prevCount);
  }

  if (siteKey === 'gemini') {
    return page.evaluate((prev: number) => {
      const msgs = Array.from(
        document.querySelectorAll('.model-response-text')
      ) as HTMLElement[];
      if (msgs.length <= prev) return '';
      return msgs[msgs.length - 1].innerText.trim();
    }, prevCount);
  }

  if (siteKey === 'qwen') {
    return page.evaluate((prev: number) => {
      const msgs = Array.from(
        document.querySelectorAll('.markdown-body')
      ) as HTMLElement[];
      if (msgs.length <= prev) return '';
      return msgs[msgs.length - 1].innerText.trim();
    }, prevCount);
  }

  return '';
}

// ══════════════════════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ══════════════════════════════════════════════════════════════════════════════

declare global {
  // eslint-disable-next-line no-var
  var __sonnyBrowser: {
    playwright: typeof import('playwright') | null;
    context: BrowserContext | null;
    page: Page | null;
    browser: Browser | null;
    currentSiteKey: string | null;
    isStarted: boolean;
  } | undefined;
}

function getBrowserState() {
  if (!globalThis.__sonnyBrowser) {
    globalThis.__sonnyBrowser = {
      playwright: null,
      context: null,
      page: null,
      browser: null,
      currentSiteKey: null,
      isStarted: false,
    };
  }
  return globalThis.__sonnyBrowser;
}

const EDGE_PROFILES_DIR = '/home/z/my-project/edge-profiles';

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

async function ensureDirs(): Promise<void> {
  const fs = await import('fs');
  [EDGE_PROFILES_DIR, `${EDGE_PROFILES_DIR}/default`].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

async function loadPlaywright(): Promise<typeof import('playwright') | null> {
  const state = getBrowserState();
  if (state.playwright) return state.playwright;
  try {
    state.playwright = await import('playwright');
    return state.playwright;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// FUNCIONES PÚBLICAS
// ══════════════════════════════════════════════════════════════════════════════

export async function checkPlaywrightAvailable(): Promise<{ available: boolean; message: string }> {
  const pw = await loadPlaywright();
  return pw
    ? { available: true, message: 'Playwright disponible' }
    : { available: false, message: 'Playwright no instalado. Ejecuta: npx playwright install chromium' };
}

export async function launchBrowser(): Promise<{ success: boolean; message: string }> {
  const state = getBrowserState();
  try {
    await ensureDirs();
    const playwright = await loadPlaywright();
    if (!playwright) return { success: false, message: 'Playwright no instalado' };

    if (state.isStarted && state.page && state.context) {
      try {
        state.page.url();
        return { success: true, message: 'Navegador ya está abierto' };
      } catch {
        state.isStarted = false;
        state.context = null;
        state.page = null;
      }
    }

    const hasDisplay = process.env.DISPLAY || process.env.WAYLAND_DISPLAY;
    const isHeadless = !hasDisplay || process.env.HEADLESS === 'true' || process.env.NODE_ENV === 'production';
    console.log(`[Browser] Modo: ${isHeadless ? 'headless' : 'headed'}`);

    const context = await playwright.chromium.launchPersistentContext(
      `${EDGE_PROFILES_DIR}/default`,
      {
        headless: isHeadless,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    );

    await context.addInitScript(
      "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
    );

    const pages = context.pages();
    state.page = pages.length > 0 ? pages[0] : await context.newPage();
    state.context = context;
    state.isStarted = true;

    console.log('[Browser] ✅ Navegador iniciado');
    return { success: true, message: 'Navegador iniciado correctamente' };
  } catch (error) {
    return { success: false, message: `Error iniciando navegador: ${error}` };
  }
}

export async function openSite(siteKey: string): Promise<{
  success: boolean;
  message: string;
  needsLogin: boolean;
  url?: string;
}> {
  const state = getBrowserState();
  const site = AI_SITES[siteKey];
  if (!site) return { success: false, message: `Sitio no encontrado: ${siteKey}`, needsLogin: false };

  try {
    if (!state.isStarted || !state.page || !state.context) {
      const r = await launchBrowser();
      if (!r.success) return { success: false, message: r.message, needsLogin: false };
    }

    state.currentSiteKey = siteKey;
    await state.page!.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await state.page!.waitForTimeout(3000);

    const needsLogin = await detectNeedLogin(state.page!, siteKey);
    return {
      success: true,
      message: needsLogin ? 'Necesita login' : 'Sesión activa',
      needsLogin,
      url: site.url,
    };
  } catch (error) {
    return { success: false, message: `Error: ${error}`, needsLogin: false };
  }
}

async function detectNeedLogin(page: Page, siteKey: string): Promise<boolean> {
  const site = AI_SITES[siteKey];
  if (!site) return true;

  for (const sel of site.input_sel.split(',').map(s => s.trim())) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        console.log(`[Browser] Input encontrado: ${sel}`);
        return false;
      }
    } catch { /* ignorar */ }
  }

  for (const sel of [
    'button:has-text("Log in")',
    'button:has-text("Sign in")',
    'button:has-text("Iniciar sesión")',
    'input[type="email"]',
  ]) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) return true;
    } catch { /* ignorar */ }
  }

  return true;
}

export async function waitForLogin(timeout = 120000): Promise<{ success: boolean; message: string }> {
  const state = getBrowserState();
  if (!state.page || !state.currentSiteKey) return { success: false, message: 'Navegador no iniciado' };

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (!await detectNeedLogin(state.page, state.currentSiteKey)) {
        return { success: true, message: 'Login detectado' };
      }
    } catch { /* ignorar */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  return { success: false, message: 'Timeout esperando login' };
}

// ══════════════════════════════════════════════════════════════════════════════
// ENVIAR PROMPT Y CAPTURAR RESPUESTA
// ══════════════════════════════════════════════════════════════════════════════

export async function sendPrompt(prompt: string): Promise<{
  success: boolean;
  response: string;
  error?: string;
}> {
  const state = getBrowserState();
  if (!state.page || !state.currentSiteKey) {
    return { success: false, response: '', error: 'Navegador no iniciado o sitio no seleccionado' };
  }

  const site = AI_SITES[state.currentSiteKey];
  const siteKey = state.currentSiteKey;
  if (!site) return { success: false, response: '', error: 'Sitio no configurado' };

  try {
    console.log(`[Browser] Enviando prompt (${prompt.length} chars)...`);

    // Contar respuestas previas
    const prevCount = await countResponses(state.page, siteKey);
    console.log(`[Browser] Respuestas previas: ${prevCount}`);

    // Encontrar input
    let input = null;
    for (const sel of site.input_sel.split(',').map(s => s.trim())) {
      try {
        input = await state.page.waitForSelector(sel, { timeout: 10000 });
        if (input) { console.log(`[Browser] Input encontrado: ${sel}`); break; }
      } catch { continue; }
    }
    if (!input) return { success: false, response: '', error: 'No se encontró el input' };

    // Escribir prompt
    await input.click();
    await state.page.waitForTimeout(300);
    await state.page.keyboard.press('Control+a');
    await state.page.keyboard.press('Backspace');
    await state.page.waitForTimeout(200);

    if (prompt.length > 500) {
      await input.evaluate((el: HTMLElement, text: string) => {
        el.focus();
        if (el.isContentEditable) {
          el.innerText = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) {
            setter.call(el, text);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }, prompt);
    } else {
      await input.fill(prompt);
    }
    await state.page.waitForTimeout(500);

    // Clic en enviar
    let sendButton = null;
    for (const sel of site.send_sel.split(',').map(s => s.trim())) {
      try {
        sendButton = await state.page.$(sel);
        if (sendButton) { console.log(`[Browser] Botón enviar: ${sel}`); break; }
      } catch { continue; }
    }

    if (!sendButton) {
      console.log('[Browser] Sin botón enviar — usando Enter');
      await state.page.keyboard.press('Enter');
    } else {
      await sendButton.click();
    }

    console.log('[Browser] Esperando respuesta...');
    const response = await waitForResponse(state.page, siteKey, prevCount, 300000);
    return { success: true, response };

  } catch (error) {
    console.error('[Browser] Error en sendPrompt:', error);
    return { success: false, response: '', error: String(error) };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ESPERAR Y CAPTURAR RESPUESTA
// ══════════════════════════════════════════════════════════════════════════════

async function waitForResponse(
  page: Page,
  siteKey: string,
  prevCount: number,
  maxWait = 300000
): Promise<string> {
  const startTime = Date.now();
  let lastText = '';
  let stable = 0;
  let noTextCount = 0;

  console.log('[Browser] Iniciando espera de respuesta...');
  await page.waitForTimeout(3000);

  while (Date.now() - startTime < maxWait) {
    await page.waitForTimeout(2000);

    try {
      const current = await extractResponse(page, siteKey, prevCount);

      if (current && current.length > 3) {
        noTextCount = 0;

        if (!lastText) {
          console.log(`[Browser] ✅ Nueva respuesta detectada (${current.length} chars)`);
        }

        if (current === lastText) {
          stable++;
          if (stable >= 3) {
            const generating = await checkIsGenerating(page);
            if (!generating) {
              console.log(`[Browser] ✅ Respuesta completa (${current.length} chars)`);
              return current;
            }
            console.log('[Browser] Aún generando...');
            stable = 0;
          }
        } else {
          stable = 0;
          lastText = current;
          console.log(`[Browser] Texto actualizado (${current.length} chars)`);
        }
      } else {
        noTextCount++;
        if (noTextCount % 10 === 0) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`[Browser] Esperando... (${elapsed}s, ${noTextCount} intentos sin texto)`);
        }
        if (noTextCount >= 30 && lastText) {
          if (!await checkIsGenerating(page)) {
            console.log('[Browser] Devolviendo último texto conocido');
            return lastText;
          }
        }
      }
    } catch (err) {
      console.log('[Browser] Error durante espera:', err);
    }
  }

  console.log('[Browser] Timeout');
  return lastText || 'No se pudo leer la respuesta.';
}

// ══════════════════════════════════════════════════════════════════════════════
// DETECTAR SI ESTÁ GENERANDO
// ══════════════════════════════════════════════════════════════════════════════

async function checkIsGenerating(page: Page): Promise<boolean> {
  // Botones Stop — solo visibles mientras genera
  for (const sel of [
    'button[aria-label="Stop generating"]',
    'button[aria-label="Detener generación"]',
    '[data-testid="stop-button"]',
    'button[aria-label="Stop"]',
    'button[aria-label="Detener"]',
  ]) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        console.log(`[Browser] Generando (Stop visible): ${sel}`);
        return true;
      }
    } catch { /* ignorar */ }
  }

  // Botones que SOLO aparecen cuando ChatGPT terminó
  for (const sel of [
    'button[aria-label="Iniciar voz"]',
    'button[aria-label="Start voice"]',
    'button[data-testid="composer-plus-btn"]',
    'button[aria-label="Agregar archivos y más"]',
  ]) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        console.log(`[Browser] Generación terminada: ${sel}`);
        return false;
      }
    } catch { /* ignorar */ }
  }

  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// CERRAR Y ESTADO
// ══════════════════════════════════════════════════════════════════════════════

export async function closeBrowser(): Promise<{ success: boolean; message: string }> {
  const state = getBrowserState();
  try {
    if (state.context) await state.context.close();
    if (state.browser) await state.browser.close();
    state.context = null;
    state.page = null;
    state.browser = null;
    state.currentSiteKey = null;
    state.isStarted = false;
    return { success: true, message: 'Navegador cerrado' };
  } catch (error) {
    return { success: false, message: `Error: ${error}` };
  }
}

export function getBrowserStatus(): {
  isOpen: boolean;
  currentSite: string | null;
  currentSiteName: string | null;
} {
  const state = getBrowserState();
  return {
    isOpen: state.isStarted && state.context !== null,
    currentSite: state.currentSiteKey,
    currentSiteName: state.currentSiteKey ? AI_SITES[state.currentSiteKey]?.name ?? null : null,
  };
}
