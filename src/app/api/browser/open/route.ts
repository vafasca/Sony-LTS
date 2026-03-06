import { NextRequest, NextResponse } from 'next/server';

/**
 * Browser Open API - Abre navegador con Playwright
 * 
 * Basado en core/browser.py de Sonny v10
 * 
 * Maneja:
 * - Lanzamiento de navegador (Edge/Chromium)
 * - Apertura de sitios de IA
 * - Detección de login
 * - Espera de login del usuario
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { provider, action } = body;

    console.log('[Browser API] Request:', { provider, action });

    // Importar el módulo dinámicamente para evitar problemas con Turbopack
    let browserModule;
    try {
      browserModule = await import('../../../../lib/browser');
    } catch (importError) {
      console.error('[Browser API] Import error:', importError);
      return NextResponse.json({
        success: false,
        error: 'No se pudo cargar el módulo de navegador',
        message: 'No se pudo cargar el módulo de navegador',
        instructions: [
          'El módulo de Playwright no está disponible.',
          'Verifica que el archivo src/lib/browser.ts existe.',
          'Ejecuta: npm install playwright',
        ],
      });
    }
    
    const { 
      launchBrowser, 
      openSite, 
      closeBrowser, 
      getBrowserStatus,
      waitForLogin,
      checkPlaywrightAvailable,
    } = browserModule;

    // Verificar si Playwright está disponible
    const pwStatus = await checkPlaywrightAvailable();
    if (!pwStatus.available) {
      return NextResponse.json({
        success: false,
        error: pwStatus.message,
        message: pwStatus.message,
        instructions: [
          '1. Ejecuta: npx playwright install chromium',
          '2. Reinicia el servidor',
        ],
      });
    }

    // Acción: status
    if (action === 'status') {
      const status = getBrowserStatus();
      return NextResponse.json({
        success: true,
        isOpen: status.isOpen,
        currentSite: status.currentSite,
        currentSiteName: status.currentSiteName,
      });
    }

    // Acción: close
    if (action === 'close') {
      const result = await closeBrowser();
      return NextResponse.json({
        success: result.success,
        error: result.success ? undefined : result.message,
        message: result.message,
      });
    }

    // Acción: wait_login
    if (action === 'wait_login') {
      const result = await waitForLogin(120000);
      return NextResponse.json({
        success: result.success,
        error: result.success ? undefined : result.message,
        message: result.message,
      });
    }

    // Sin provider: solo abrir navegador
    if (!provider) {
      console.log('[Browser API] Launching browser...');
      const result = await launchBrowser();
      console.log('[Browser API] Launch result:', result);
      
      return NextResponse.json({
        success: result.success,
        error: result.success ? undefined : result.message,
        message: result.message,
        instructions: result.success ? [
          '✅ Navegador abierto',
          'Selecciona una IA y haz click en 🌐',
        ] : [result.message],
      });
    }

    // Abrir sitio específico
    console.log('[Browser API] Opening site:', provider);
    const result = await openSite(provider);
    console.log('[Browser API] Open result:', result);
    
    return NextResponse.json({
      success: result.success,
      error: result.success ? undefined : result.message,
      message: result.message,
      needsLogin: result.needsLogin,
      url: result.url,
      instructions: result.needsLogin ? [
        `🌐 Se abrió ${result.url}`,
        '⚠️ NECESITAS HACER LOGIN',
        '1. Inicia sesión con tu cuenta',
        '2. Haz click en "Confirmar Login"',
      ] : [
        `✅ Se abrió ${result.url}`,
        'Sesión activa - ya puedes enviar prompts',
      ],
    });

  } catch (error) {
    console.error('[Browser API] Error:', error);
    
    // Proporcionar más detalles del error
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    return NextResponse.json({
      success: false,
      error: errorMessage,
      message: errorMessage,
      stack: process.env.NODE_ENV === 'development' ? errorStack : undefined,
    });
  }
}

export async function GET() {
  try {
    const browserModule = await import('../../../../lib/browser');
    const status = browserModule.getBrowserStatus();
    
    return NextResponse.json({
      isOpen: status.isOpen,
      currentSite: status.currentSite,
      currentSiteName: status.currentSiteName,
      isLoggedIn: status.isOpen && status.currentSite !== null,
      needsLogin: false,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return NextResponse.json({
      isOpen: false,
      currentSite: null,
      currentSiteName: null,
      isLoggedIn: false,
      needsLogin: false,
      error: errorMessage,
    });
  }
}
