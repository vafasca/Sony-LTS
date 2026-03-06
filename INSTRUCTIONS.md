# Sonny Agent - Instrucciones de Instalación

## Navegador

### Opción A: Usar Chromium (Recomendado para Linux/Servidor)
Ya está instalado automáticamente con Playwright:
```bash
npx playwright install chromium
```

### Opción B: Usar Microsoft Edge (Solo Windows)
En Windows, ejecuta:
```bash
npx playwright install msedge
```

El código intentará Edge primero, y si no está disponible, usará Chromium.

## API Keys

Configura tus API Keys en Settings (⚙️):

1. **Groq** (Gratis)
   - Ve a: https://console.groq.com
   - Crea una API Key
   - Modelos: llama-3.3-70b-versatile, llama-3.1-8b-instant

2. **OpenRouter** (Opcional)
   - Ve a: https://openrouter.ai
   - Modelos gratuitos terminan en `:free`

3. **Gemini** (Opcional, 1500 req/día gratis)
   - Ve a: https://aistudio.google.com
   - Get API key

## Flujo de Sonny

```
Usuario escribe solicitud
        ↓
Groq interpreta (mínimo)
        ↓
Sonny abre navegador
        ↓
IA externa diseña (ChatGPT/Claude)
        ↓
Sonny ejecuta pasos automáticamente
```

## Solución de Problemas

### Error: "Playwright no disponible"
```bash
bun add playwright
npx playwright install chromium
```

### Error 403 de Groq
- Verifica tu API Key en https://console.groq.com
- Asegúrate de que la key tenga permisos

### Navegador no abre
- En servidor Linux: usa Chromium
- En Windows: puedes instalar Edge
