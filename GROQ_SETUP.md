# Configuración de Groq

Este proyecto usa **Groq** para la comparación de documentos (sin rate limits, super rápido).

## Cómo configurar:

1. Crea un archivo `.env.local` en la raíz del proyecto
2. Agrega tus API keys:

```env
# OpenRouter (para queries generales)
VITE_OPENROUTER_API_KEY=tu_key_de_openrouter

# Groq (para comparación de documentos)
VITE_GROQ_API_KEY=tu_groq_api_key_aqui
```

## Ventajas de Groq:

✅ **Completamente gratuito**
✅ **Velocidad extrema**: 280-560 tokens/segundo
✅ **Rate limits generosos**: 300K TPM, 1K RPM
✅ **Sin errores 429**
✅ **Modelos potentes**: Llama 3.3 70B, Llama 3.1 8B

## Uso en la app:

- **Groq**: Comparación de documentos (2 pasos: resumen + comparación)
- **OpenRouter**: Queries normales con Gemini 2.0 Flash

## Más info:

- [Groq Console](https://console.groq.com)
- [Modelos disponibles](https://console.groq.com/docs/models)
