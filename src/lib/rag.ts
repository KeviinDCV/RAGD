import { parseDocument, getFileTypeDescription } from './documentParser'

interface Document {
  id: string
  name: string
  content: string
  chunks: string[]
  type?: string
  metadata?: Record<string, any>
}

interface ChunkWithEmbedding {
  text: string
  embedding: number[]
  documentId: string
}

export interface Source {
  text: string
  documentId: string
  documentName: string
  similarity: number
}

export interface QueryResponse {
  answer: string
  sources: Source[]
}

// OpenRouter API configuration
const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY || ''
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

// Check if running in production
const isProduction = import.meta.env.PROD

// Store embeddings in memory
const chunksWithEmbeddings: ChunkWithEmbedding[] = []

// Web Worker for embeddings
let worker: Worker | null = null

function getWorker(): Worker {
  if (!worker) {
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    } catch (error) {
      console.error('Failed to initialize worker:', error)
      throw new Error('No se pudo inicializar el procesador de embeddings')
    }
  }
  return worker
}

// Split text into chunks
function splitIntoChunks(text: string, chunkSize: number = 500, overlap: number = 100): string[] {
  const chunks: string[] = []
  const words = text.split(/\s+/)
  
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ')
    if (chunk.trim()) {
      chunks.push(chunk.trim())
    }
  }
  
  return chunks
}

// Generate embeddings for text using worker
async function generateEmbedding(text: string): Promise<number[]> {
  const embedWorker = getWorker()
  
  return new Promise((resolve, reject) => {
    // Set timeout of 60 seconds
    const timeout = setTimeout(() => {
      embedWorker.removeEventListener('message', handleMessage)
      reject(new Error('Timeout generando embeddings. El modelo puede estar descargándose por primera vez. Intenta de nuevo en unos segundos.'))
    }, 60000)
    
    const handleMessage = (event: MessageEvent) => {
      const { type, data } = event.data
      
      if (type === 'embedding-result') {
        clearTimeout(timeout)
        embedWorker.removeEventListener('message', handleMessage)
        resolve(data.embedding)
      } else if (type === 'error') {
        clearTimeout(timeout)
        embedWorker.removeEventListener('message', handleMessage)
        reject(new Error(data.message))
      } else if (type === 'progress') {
        console.log('Embedding model loading:', data)
      }
    }
    
    embedWorker.addEventListener('message', handleMessage)
    embedWorker.postMessage({ type: 'generate-embedding', data: { text } })
  })
}

// Calculate cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0)
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))
  return dotProduct / (magnitudeA * magnitudeB)
}

// Upload and process document from file
export async function uploadDocument(file: File): Promise<Document> {
  const id = `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  
  // Parse document based on file type
  const parsed = await parseDocument(file)
  const content = parsed.text
  
  if (!content || content.trim().length === 0) {
    throw new Error('El documento está vacío o no se pudo extraer el texto')
  }
  
  // Split into chunks
  const chunks = splitIntoChunks(content)
  
  // Only generate embeddings in development (local)
  if (!isProduction) {
    try {
      // Generate embeddings for each chunk
      for (const chunk of chunks) {
        const embedding = await generateEmbedding(chunk)
        chunksWithEmbeddings.push({
          text: chunk,
          embedding,
          documentId: id
        })
      }
    } catch (error) {
      console.warn('Failed to generate embeddings, continuing without them:', error)
      // Continue without embeddings in case of error
    }
  }
  
  return {
    id,
    name: file.name,
    content,
    chunks,
    type: getFileTypeDescription(file.name),
    metadata: parsed.metadata
  }
}

// Find most relevant chunks with sources
async function findRelevantChunks(query: string, documents: Document[], topK: number = 3): Promise<Source[]> {
  // In production, use simple keyword matching instead of embeddings
  if (isProduction || chunksWithEmbeddings.length === 0) {
    return findRelevantChunksSimple(query, documents, topK)
  }
  
  try {
    const queryEmbedding = await generateEmbedding(query)
    
    // Calculate similarities
    const similarities = chunksWithEmbeddings.map(chunk => {
      const doc = documents.find(d => d.id === chunk.documentId)
      return {
        text: chunk.text,
        documentId: chunk.documentId,
        documentName: doc?.name || 'Unknown',
        similarity: cosineSimilarity(queryEmbedding, chunk.embedding)
      }
    })
    
    // Sort by similarity and get top K
    similarities.sort((a, b) => b.similarity - a.similarity)
    return similarities.slice(0, topK)
  } catch (error) {
    console.warn('Embedding search failed, using simple search:', error)
    return findRelevantChunksSimple(query, documents, topK)
  }
}

// Simple keyword-based search for production (fallback)
function findRelevantChunksSimple(query: string, documents: Document[], topK: number = 3): Source[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const allChunks: Source[] = []
  
  // Get all chunks from all documents
  documents.forEach(doc => {
    doc.chunks.forEach(chunk => {
      const chunkLower = chunk.toLowerCase()
      // Count matching words
      const matchCount = queryWords.filter(word => chunkLower.includes(word)).length
      const similarity = matchCount / queryWords.length
      
      if (similarity > 0) {
        allChunks.push({
          text: chunk,
          documentId: doc.id,
          documentName: doc.name,
          similarity
        })
      }
    })
  })
  
  // Sort by similarity and return top K
  allChunks.sort((a, b) => b.similarity - a.similarity)
  return allChunks.slice(0, topK)
}

// Query documents using OpenRouter
export async function queryDocuments(query: string, documents: Document[]): Promise<QueryResponse> {
  if (documents.length === 0) {
    throw new Error('No hay documentos para consultar')
  }
  
  // Find relevant chunks with sources
  const sources = await findRelevantChunks(query, documents, 3)
  
  if (sources.length === 0) {
    return {
      answer: 'No se encontró información relevante en los documentos.',
      sources: []
    }
  }
  
  // Build context from relevant chunks
  const context = sources.map(s => s.text).join('\n\n')
  
  // Create prompt
  const systemPrompt = `Eres un asistente útil que responde preguntas basándose en los documentos proporcionados. 
Solo usa la información del contexto para responder. Si no encuentras la respuesta en el contexto, di que no tienes esa información.`
  
  const userPrompt = `Contexto de los documentos:
${context}

Pregunta: ${query}

Responde de forma clara y concisa basándote únicamente en el contexto proporcionado.`

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'RAG Document App'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 1500
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      
      if (response.status === 429) {
        throw new Error('Demasiadas peticiones. Por favor espera 10-20 segundos e intenta de nuevo.')
      }
      
      throw new Error(`OpenRouter API error: ${response.status} - ${JSON.stringify(errorData)}`)
    }

    const data = await response.json()
    const answer = data.choices[0]?.message?.content || 'No se pudo generar una respuesta.'
    
    return {
      answer,
      sources
    }
  } catch (error) {
    console.error('Error calling OpenRouter:', error)
    throw new Error('Error al comunicarse con OpenRouter API')
  }
}

// Compare multiple documents
export interface ComparisonResult {
  similarities: string[]
  differences: string[]
  summary: string
}

export async function compareDocuments(documents: Document[]): Promise<ComparisonResult> {
  if (documents.length < 2) {
    throw new Error('Se necesitan al menos 2 documentos para comparar')
  }
  
  // Get strategic content from all documents (beginning, middle, end for context)
  const docContents = documents.map(doc => {
    const chunks = doc.chunks
    const totalChunks = chunks.length
    
    // For small docs, send everything
    if (totalChunks <= 5) {
      return {
        name: doc.name,
        content: doc.content
      }
    }
    
    // For larger docs, send strategic samples: beginning, middle, end
    const beginning = chunks.slice(0, 2).join(' ')
    const middle = chunks.slice(Math.floor(totalChunks / 2) - 1, Math.floor(totalChunks / 2) + 1).join(' ')
    const end = chunks.slice(-2).join(' ')
    
    return {
      name: doc.name,
      content: `[INICIO]\n${beginning}\n\n[MEDIO]\n${middle}\n\n[FINAL]\n${end}`
    }
  })
  
  const prompt = `Analiza y compara en detalle estos ${documents.length} documentos:

${docContents.map((d, i) => `=== DOCUMENTO ${i + 1}: ${d.name} ===\n${d.content}`).join('\n\n')}

Responde en este formato:

SIMILITUDES:
- [Lista todas las similitudes importantes que encuentres]

DIFERENCIAS:
- [Lista todas las diferencias clave que encuentres]

RESUMEN:
[Resumen ejecutivo de la comparación en 2-3 líneas]`

  // Retry logic with exponential backoff for rate limits
  const maxRetries = 3
  let lastError: Error | null = null
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Wait before retry (longer delays: 0s, 10s, 30s)
      if (attempt > 0) {
        const waitTime = attempt === 1 ? 10000 : 30000 // 10s then 30s
        console.log(`Retry attempt ${attempt + 1}/${maxRetries}, esperando ${waitTime/1000}s...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
      
      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'RAG Document App'
        },
        body: JSON.stringify({
          model: 'z-ai/glm-4.5-air:free', // 39.2B tokens processed, MoE, optimized for agentic tasks
          messages: [
            { role: 'user', content: prompt }
          ],
          temperature: 0.5,
          max_tokens: 800
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error('Comparison API error:', response.status, errorData)
        
        if (response.status === 429) {
          lastError = new Error('Demasiadas peticiones. Reintentando automáticamente...')
          continue // Retry on 429
        }
        
        throw new Error('Error al comparar documentos')
      }

      const data = await response.json()
      
      // Check for API error in response
      if (data.error) {
        console.error('Comparison API returned error:', JSON.stringify(data.error, null, 2))
        throw new Error(data.error.message || 'Error al comparar documentos')
      }
      
      // Validate response structure
      if (!data || !data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
        console.error('Invalid comparison response format:', data)
        throw new Error('Respuesta inválida del servidor')
      }
      
      const content = data.choices[0]?.message?.content || ''
      
      if (!content) {
        throw new Error('No se pudo obtener respuesta de comparación')
      }
      
      console.log('Comparison response:', content) // Debug
      
      // Parse response with more flexible regex
      const similaritiesMatch = content.match(/SIMILITUDES:?\s*([\s\S]*?)(?=DIFERENCIAS:|$)/i)
      const differencesMatch = content.match(/DIFERENCIAS:?\s*([\s\S]*?)(?=RESUMEN:|$)/i)
      const summaryMatch = content.match(/RESUMEN:?\s*([\s\S]*?)$/i)
      
      // Extract similarities
      const similarities = similaritiesMatch 
        ? similaritiesMatch[1]
            .split('\n')
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0 && (s.startsWith('-') || s.startsWith('•') || s.startsWith('*')))
            .map((s: string) => s.replace(/^[-•*]\s*/, '').trim())
            .filter((s: string) => s.length > 10)
        : []
      
      // Extract differences
      const differences = differencesMatch
        ? differencesMatch[1]
            .split('\n')
            .map((d: string) => d.trim())
            .filter((d: string) => d.length > 0 && (d.startsWith('-') || d.startsWith('•') || d.startsWith('*')))
            .map((d: string) => d.replace(/^[-•*]\s*/, '').trim())
            .filter((d: string) => d.length > 10)
        : []
      
      // Extract summary
      let summary = summaryMatch 
        ? summaryMatch[1]
            .split('\n')
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0 && !s.startsWith('-') && !s.startsWith('•'))
            .join(' ')
            .trim()
        : ''
      
      // If nothing was parsed, try to extract something useful from the content
      if (similarities.length === 0 && differences.length === 0 && !summary) {
        summary = content.slice(0, 200) + '...'
      }
      
      if (!summary || summary.length < 10) {
        summary = 'Los documentos han sido comparados. Revisa las similitudes y diferencias para más detalles.'
      }
      
      // Success! Return the result
      return { 
        similarities: similarities.slice(0, 10), // Allow more items
        differences: differences.slice(0, 10),   // Allow more items
        summary 
      }
      
    } catch (error) {
      // Only retry on 429 errors
      if (lastError && attempt < maxRetries - 1) {
        continue
      }
      console.error('Error in comparison attempt:', error)
      lastError = error instanceof Error ? error : new Error('Unknown error')
    }
  }
  
  // If all retries failed
  throw lastError || new Error('Error al comparar documentos después de varios intentos')
}

// Generate suggested questions based on document content
export async function generateSuggestedQuestions(documents: Document[]): Promise<string[]> {
  if (documents.length === 0) return []
  
  // Get a sample of content from documents
  const sampleContent = documents
    .slice(0, 3) // Use first 3 documents
    .map(doc => doc.chunks.slice(0, 2).join(' ')) // First 2 chunks per doc
    .join('\n\n')
    .slice(0, 2000) // Limit to 2000 chars
  
  const prompt = `Basándote en el siguiente contenido de documentos, genera exactamente 4 preguntas relevantes e interesantes que un usuario podría hacer. Las preguntas deben ser específicas y útiles.

Contenido:
${sampleContent}

Responde SOLO con las 4 preguntas, una por línea, sin numeración ni formato adicional.`

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'RAG Document App'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-exp:free',
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 300
      })
    })

    if (!response.ok) {
      console.warn('Suggestions API error:', response.status)
      return []
    }

    const data = await response.json()
    
    // Check for API error in response
    if (data.error) {
      console.error('Suggestions API returned error:', JSON.stringify(data.error, null, 2))
      return []
    }
    
    // Validate response structure
    if (!data || !data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
      console.warn('Invalid suggestions response format:', data)
      return []
    }
    
    const content = data.choices[0]?.message?.content || ''
    
    if (!content) {
      console.warn('Empty suggestions content')
      return []
    }
    
    // Parse questions (one per line)
    const questions = content
      .split('\n')
      .map((q: string) => q.trim())
      .filter((q: string) => q.length > 10 && q.includes('?'))
      .slice(0, 4)
    
    return questions.length > 0 ? questions : []
  } catch (error) {
    console.error('Error generating suggestions:', error)
    return []
  }
}
