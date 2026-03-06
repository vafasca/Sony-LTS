/**
 * Proveedores de IA - Configuración similar a config.py original
 * 
 * Orden de preferencia:
 * 1. Groq-70B (más inteligente)
 * 2. Groq-8B (fallback rápido)
 * 3. OpenRouter (modelos gratuitos)
 * 4. Gemini (gratuito, 1500 req/día)
 */

export interface Provider {
  name: string;
  apiKey: string;
  url: string;
  model: string;
  format: 'openai' | 'gemini';
  extraHeaders?: Record<string, string>;
}

// Configuración de proveedores
export function getProviders(groqApiKey?: string): Provider[] {
  return [
    {
      name: 'Groq-70B',
      apiKey: groqApiKey || '',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      model: 'llama-3.3-70b-versatile',
      format: 'openai',
    },
    {
      name: 'Groq-8B',
      apiKey: groqApiKey || '',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      model: 'llama-3.1-8b-instant',
      format: 'openai',
    },
  ];
}

// Llamar a proveedor OpenAI-compatible
export async function callOpenAIProvider(
  provider: Provider,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 200
): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    if (!provider.apiKey) {
      return { success: false, error: 'API Key no configurada' };
    }

    const response = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
        ...provider.extraHeaders,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.1,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Error ${response.status}`;
      
      if (response.status === 403) {
        errorMessage = 'API Key sin permisos. Verifica en https://console.groq.com';
      } else if (response.status === 401) {
        errorMessage = 'API Key inválida';
      } else if (response.status === 429) {
        errorMessage = 'Rate limit alcanzado';
      }
      
      return { success: false, error: errorMessage };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    return { success: true, content };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Llamar a Gemini
export async function callGeminiProvider(
  provider: Provider,
  systemPrompt: string,
  userMessage: string
): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    if (!provider.apiKey) {
      return { success: false, error: 'API Key no configurada' };
    }

    const url = `${provider.url}?key=${provider.apiKey}`;
    const fullPrompt = `${systemPrompt}\n\nUsuario: ${userMessage}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: fullPrompt }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200,
        },
      }),
    });

    if (!response.ok) {
      return { success: false, error: `Error ${response.status}` };
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    return { success: true, content };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Intentar con todos los proveedores en orden
export async function tryProviders(
  groqApiKey: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 200
): Promise<{ success: boolean; content?: string; provider?: string; error?: string }> {
  const providers = getProviders(groqApiKey);

  for (const provider of providers) {
    if (!provider.apiKey) continue;

    console.log(`Intentando con ${provider.name}...`);
    
    let result;
    if (provider.format === 'gemini') {
      result = await callGeminiProvider(provider, systemPrompt, userMessage);
    } else {
      result = await callOpenAIProvider(provider, systemPrompt, userMessage, maxTokens);
    }

    if (result.success && result.content) {
      return { 
        success: true, 
        content: result.content, 
        provider: provider.name 
      };
    }

    console.log(`${provider.name} falló: ${result.error}`);
  }

  return { 
    success: false, 
    error: 'Todos los proveedores fallaron. Verifica tu API Key.' 
  };
}
