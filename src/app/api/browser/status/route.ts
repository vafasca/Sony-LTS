import { NextRequest, NextResponse } from 'next/server';

/**
 * Browser Status API - Verifica el estado del navegador
 */

export async function GET(request: NextRequest) {
  try {
    const browserModule = await import('../../../../lib/browser');
    const status = browserModule.getBrowserStatus();
    
    return NextResponse.json({
      success: true,
      isOpen: status.isOpen,
      currentSite: status.currentSite,
      currentSiteName: status.currentSiteName,
      isLoggedIn: status.isOpen && status.currentSite !== null,
      needsLogin: false,
    });
  } catch {
    return NextResponse.json({
      success: false,
      isOpen: false,
      currentSite: null,
      currentSiteName: null,
      isLoggedIn: false,
      needsLogin: false,
      error: 'Error verificando estado',
    });
  }
}
