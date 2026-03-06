import { NextRequest, NextResponse } from 'next/server';

// This API is kept for potential future use with Groq for basic interpretation
// Currently, the main flow is: User -> Prompt -> External AI (ChatGPT/Claude) -> JSON -> Sonny executes

export async function POST(request: NextRequest) {
  return NextResponse.json({
    success: false,
    error: 'Este endpoint ya no se usa. El flujo correcto es:',
    instructions: [
      '1. Escribe tu solicitud en el chat',
      '2. Sonny genera un prompt para copiar',
      '3. Copia el prompt y pégalo en la IA externa (ChatGPT/Claude)',
      '4. Copia la respuesta JSON de la IA',
      '5. Pégala en Sonny y él ejecutará los pasos',
    ],
  });
}

export async function GET() {
  return NextResponse.json({
    message: 'Agent API - Modo Solo Ejecutor',
    description: 'Sonny no diseña, solo ejecuta. La IA externa es el cerebro.',
  });
}
