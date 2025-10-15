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

// OpenRouter API configuration
const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY || ''
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

// Store embeddings in memory
const chunksWithEmbeddings: ChunkWithEmbedding[] = []

// Web Worker for embeddings
let worker: Worker | null = null

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
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
    const handleMessage = (event: MessageEvent) => {
      const { type, data } = event.data
      
      if (type === 'embedding-result') {
        embedWorker.removeEventListener('message', handleMessage)
        resolve(data.embedding)
      } else if (type === 'error') {
        embedWorker.removeEventListener('message', handleMessage)
        reject(new Error(data.message))
      }
      // Ignore 'progress' messages
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
    throw new Error('El documento está vacío o no se pudo extraer texto')
  }
  
  const chunks = splitIntoChunks(content)
  
  // Generate embeddings for each chunk
  for (const chunk of chunks) {
    const embedding = await generateEmbedding(chunk)
    chunksWithEmbeddings.push({
      text: chunk,
      embedding,
      documentId: id
    })
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

// Find most relevant chunks
async function findRelevantChunks(query: string, topK: number = 3): Promise<string[]> {
  if (chunksWithEmbeddings.length === 0) {
    return []
  }
  
  const queryEmbedding = await generateEmbedding(query)
  
  // Calculate similarities
  const similarities = chunksWithEmbeddings.map(chunk => ({
    text: chunk.text,
    similarity: cosineSimilarity(queryEmbedding, chunk.embedding)
  }))
  
  // Sort by similarity and get top K
  similarities.sort((a, b) => b.similarity - a.similarity)
  return similarities.slice(0, topK).map(s => s.text)
}

// Query documents using OpenRouter
export async function queryDocuments(query: string, documents: Document[]): Promise<string> {
  if (documents.length === 0) {
    throw new Error('No hay documentos para consultar')
  }
  
  // Find relevant chunks
  const relevantChunks = await findRelevantChunks(query, 3)
  
  if (relevantChunks.length === 0) {
    return 'No se encontró información relevante en los documentos.'
  }
  
  // Build context from relevant chunks
  const context = relevantChunks.join('\n\n')
  
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
        model: 'openai/gpt-oss-20b:free',
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
      throw new Error(`OpenRouter API error: ${response.status} - ${JSON.stringify(errorData)}`)
    }

    const data = await response.json()
    return data.choices[0]?.message?.content || 'No se pudo generar una respuesta.'
  } catch (error) {
    console.error('Error calling OpenRouter:', error)
    throw new Error('Error al comunicarse con OpenRouter API')
  }
}
