# Sonny Agent - Agente de Desarrollo Autónomo

## Descripción

Sonny Agent es un agente de desarrollo que utiliza IAs externas (ChatGPT, Claude, Gemini, Qwen) como "cerebro" para ejecutar tareas de programación automáticamente. El agente interpreta las solicitudes del usuario y las envía a la IA seleccionada para obtener instrucciones paso a paso en formato JSON, las cuales luego ejecuta automáticamente.

## Características

### Interfaz tipo Z.ai
- **Panel de Chat**: Interactúa con el agente mediante mensajes
- **Panel de Código**: Visualiza y edita el código generado
- **Panel de Preview**: Vista previa en vivo de aplicaciones HTML

### IAs Soportadas
- ChatGPT (OpenAI)
- Claude (Anthropic)
- Gemini (Google)
- Qwen (Alibaba)

### Sistema de Prompts Configurables
El prompt del sistema se puede personalizar completamente. El formato predeterminado solicita respuestas en JSON con la siguiente estructura:

```json
{
  "accion": "crear|editar|eliminar|validar|corregir",
  "descripcion": "Breve descripción del paso",
  "archivos": [
    {
      "nombre": "ruta/archivo.ext",
      "contenido": "código completo"
    }
  ],
  "comandos": ["comando a ejecutar"],
  "validacion": "cómo probar este paso"
}
```

### Manejo de Errores
Cuando ocurre un error, el agente envía un reporte a la IA:

```json
{
  "accion": "error_reportado",
  "descripcion": "Error al ejecutar comando",
  "mensaje_error": "Mensaje de error completo",
  "estructura_proyecto": { /* estructura */ },
  "archivos_afectados": ["archivo1.ts"]
}
```

La IA responde con una corrección:

```json
{
  "accion": "corregir",
  "descripcion": "Corrección aplicada",
  "archivos": [
    { "nombre": "archivo.ts", "contenido": "código corregido" }
  ],
  "comandos": ["npm run build"],
  "validacion": "Cómo verificar la corrección"
}
```

## APIs Disponibles

### `/api/agent` - Agente Principal
- **POST**: Envía una solicitud al agente
  - Body: `{ message, aiProvider, systemPrompt, groqApiKey }`

### `/api/browser/open` - Abrir Navegador
- **POST**: Abre el navegador con la IA seleccionada
  - Body: `{ provider: "chatgpt" | "claude" | "gemini" | "qwen" }`

### `/api/execute` - Ejecutar Comandos
- **POST**: Ejecuta un comando del sistema
  - Body: `{ command, timeout }`
- **GET**: Lista comandos permitidos

### `/api/search` - Búsqueda de Archivos
- **POST**: Busca archivos en el sistema
  - Body: `{ query, basePath, fileTypes, maxDepth, maxResults, searchContent }`

### `/api/files` - Gestión de Archivos
- **POST**: Crea, lee, elimina o lista archivos
  - Body: `{ action: "create"|"read"|"delete"|"list", path, content }`

### `/api/error` - Manejo de Errores
- **POST**: Reporta y analiza errores
  - Body: Error report en formato JSON

## Uso con Groq API (Opcional)

Para usar Groq como intérprete básico de comandos:
1. Obtén una API key de [Groq Console](https://console.groq.com/)
2. Configúrala en el diálogo de ajustes de la aplicación

## Integración con Playwright

La aplicación está diseñada para integrarse con Playwright para:
- Abrir navegadores Edge con sesiones persistentes
- Mantener sesiones activas con IAs externas
- Enviar prompts automáticamente

## Seguridad

- Comandos peligrosos están bloqueados (rm -rf, sudo, etc.)
- Búsqueda limitada a directorios seguros
- Validación de rutas de archivo

## Ejemplos de Uso

### Crear una Landing Page
```
"Desarrolla una landing page para una farmacia"
```

### Crear una Calculadora
```
"Crea una calculadora interactiva"
```

### Crear una Aplicación Angular
```
"Desarrolla una landing page en Angular para una farmacia"
```

## Estructura del Proyecto

```
src/
├── app/
│   ├── api/
│   │   ├── agent/route.ts      # API principal del agente
│   │   ├── browser/open/route.ts # API para abrir navegador
│   │   ├── execute/route.ts    # API para ejecutar comandos
│   │   ├── search/route.ts     # API para buscar archivos
│   │   ├── files/route.ts      # API para gestionar archivos
│   │   └── error/route.ts      # API para manejar errores
│   ├── layout.tsx              # Layout principal
│   ├── page.tsx                # UI principal
│   └── globals.css             # Estilos globales
└── components/ui/              # Componentes shadcn/ui
```

## Tecnologías

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui
- Lucide Icons
- Groq API (opcional)

## Licencia

MIT
