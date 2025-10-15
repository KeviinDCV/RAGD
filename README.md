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
npm install
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

Edita `src/lib/rag.ts` línea 20 para usar tu propia API key de OpenRouter.

## Notas

- La primera carga descarga el modelo de embeddings (aproximadamente 40MB)
- Archivos grandes pueden causar problemas de memoria
- Los datos son de sesión, no persistentes
- Aplican límites de uso gratuito

## Licencia

MIT

---

Kevin Ch
