# RAG Document App

Aplicación web para consultar documentos usando RAG (Retrieval-Augmented Generation) completamente en el navegador.

## Características

- Procesamiento local con embeddings en el navegador
- Soporte multi-formato: PDF, Word, Excel, TXT
- Búsqueda semántica en tiempo real con respuestas LLM
- Interfaz minimalista monocromática
- Procesamiento del lado del cliente

## Stack Tecnológico

- React + TypeScript + Vite
- Tailwind CSS
- Transformers.js (all-MiniLM-L6-v2)
- PDF.js, Mammoth.js, SheetJS
- OpenRouter API (OpenAI gpt-oss-20b)

## Instalación

```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env.local

# Editar .env.local y agregar tu API key de OpenRouter
# VITE_OPENROUTER_API_KEY=tu_api_key_aqui

# Iniciar servidor de desarrollo
npm run dev
```

## Build

```bash
npm run build
```

## Deploy

Despliega en Vercel sin configuración adicional. Incluye `vercel.json` con configuración óptima.

## Uso

1. Sube documentos mediante la barra lateral
2. Espera la generación de embeddings
3. Haz preguntas en la interfaz de chat
4. Recibe respuestas basadas en el contexto

## Configuración

1. Obtén una API key gratuita en [OpenRouter.ai](https://openrouter.ai/keys)
2. Copia el archivo `.env.example` a `.env.local`
3. Agrega tu API key en `.env.local`:
   ```
   VITE_OPENROUTER_API_KEY=tu_api_key_aqui
   ```

## Notas

- La primera carga descarga el modelo de embeddings (aproximadamente 40MB)
- Archivos grandes pueden causar problemas de memoria
- Los datos son de sesión, no persistentes
- Aplican límites de uso gratuito

## Licencia

MIT

---

Kevin Ch
