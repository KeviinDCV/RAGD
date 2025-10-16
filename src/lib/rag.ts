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
  documentName: string
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

// API configuration
const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY || ''
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

// Groq API configuration (for document comparison - faster and no rate limits)
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || ''
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

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
          documentId: id,
          documentName: file.name
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

// Query documents with RAG using Groq
export async function queryDocuments(query: string, documents: Document[]): Promise<QueryResponse> {
  if (documents.length === 0) {
    throw new Error('No hay documentos cargados')
  }

  let sources: Source[] = []
  let relevantContext = ''

  if (isProduction) {
    // Production: Use simple keyword search
    console.log('Production mode: Using keyword search')
    const keywords = query.toLowerCase().split(' ').filter(w => w.length > 3)
    
    const scoredChunks = documents.flatMap(doc => 
      doc.chunks.map(chunk => {
        const chunkLower = chunk.toLowerCase()
        const score = keywords.reduce((acc, keyword) => 
          acc + (chunkLower.includes(keyword) ? 1 : 0), 0
        )
        return { chunk, score, documentId: doc.id, documentName: doc.name }
      })
    ).filter(item => item.score > 0)
    
    scoredChunks.sort((a, b) => b.score - a.score)
    const topChunks = scoredChunks.slice(0, 3)
    
    relevantContext = topChunks.map(item => item.chunk).join('\n\n')
    sources = topChunks.map(item => ({
      text: item.chunk.slice(0, 150) + '...',
      documentId: item.documentId,
      documentName: item.documentName,
      similarity: item.score / keywords.length
    }))
  } else {
    // Development: Use embeddings for semantic search
    console.log('Development mode: Using embeddings')
    
    if (chunksWithEmbeddings.length === 0) {
      throw new Error('No hay embeddings generados. Por favor sube los documentos de nuevo.')
    }

    const queryEmbedding = await generateEmbedding(query)
    
    const similarities = chunksWithEmbeddings.map(item => ({
      ...item,
      similarity: cosineSimilarity(queryEmbedding, item.embedding)
    }))

    similarities.sort((a, b) => b.similarity - a.similarity)
    const topChunks = similarities.slice(0, 3)
    
    relevantContext = topChunks.map(item => item.text).join('\n\n')
    sources = topChunks.map(item => ({
      text: item.text.slice(0, 150) + '...',
      documentId: item.documentId,
      documentName: item.documentName,
      similarity: item.similarity
    }))
  }

  // Generate answer with Groq AI using relevant context
  const systemPrompt = `Eres un asistente experto que analiza documentos y responde preguntas de forma precisa y útil.

INSTRUCCIONES:
- Analiza cuidadosamente el contexto proporcionado
- Extrae y presenta la información relevante de manera clara
- Si encuentras información parcial, preséntala y menciona qué falta
- Solo di que no tienes información si realmente no hay NADA relacionado en el contexto
- Sé específico: menciona fechas, números, nombres exactos cuando estén disponibles
- Responde en español de forma natural y conversacional`

  const userPrompt = `Contexto de los documentos:
${relevantContext}

Pregunta del usuario: ${query}

Analiza el contexto y responde la pregunta. Si encuentras información relevante, preséntala de forma clara y organizada.`

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', // Groq's powerful 70B model
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
        throw new Error('Por favor espera unos segundos e intenta de nuevo.')
      }
      
      throw new Error(`Groq API error: ${response.status} - ${JSON.stringify(errorData)}`)
    }

    const data = await response.json()
    const answer = data.choices[0]?.message?.content || 'No se pudo generar una respuesta.'
    
    return {
      answer,
      sources
    }
  } catch (error) {
    console.error('Error calling Groq:', error)
    throw error
  }
}

// Compare multiple documents
export interface ComparisonResult {
  similarities: string[]
  differences: string[]
  summary: string
}

// Generate a short summary of a document using Groq (Step 1)
async function generateDocumentSummary(doc: Document): Promise<string> {
  // Take only first 3 chunks to keep it short
  const sampleContent = doc.chunks.slice(0, 3).join(' ').slice(0, 1000)
  
  const prompt = `Resume brevemente este documento en 3-4 líneas, enfocándote en los temas principales:\n\n${sampleContent}`
  
  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant', // 560 tps - super fast!
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 150
      })
    })
    
    if (!response.ok) {
      console.error('Groq summary error:', response.status)
      return `Documento: ${doc.name}`
    }
    
    const data = await response.json()
    return data.choices[0]?.message?.content || `Documento: ${doc.name}`
  } catch (error) {
    console.error('Error generating summary:', error)
    return `Documento: ${doc.name}`
  }
}

export async function compareDocuments(documents: Document[]): Promise<ComparisonResult> {
  if (documents.length < 2) {
    throw new Error('Se necesitan al menos 2 documentos para comparar')
  }
  
  // Step 1: Generate short summaries of each document (low token usage)
  console.log('Generating document summaries...')
  const summaries = await Promise.all(
    documents.map(async (doc) => ({
      name: doc.name,
      summary: await generateDocumentSummary(doc)
    }))
  )
  
  // Wait 1 second between summary generation and comparison (Groq is fast!)
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  // Step 2: Compare the summaries using Groq (much less tokens than full documents)
  const prompt = `Compara estos ${documents.length} documentos basándote en sus resúmenes:

${summaries.map((s, i) => `${i + 1}. ${s.name}:\n${s.summary}`).join('\n\n')}

Responde en TEXTO PLANO (sin markdown, sin asteriscos, sin negritas) usando este formato exacto:

SIMILITUDES:
- Similitud 1
- Similitud 2
- Similitud 3

DIFERENCIAS:
- Diferencia 1
- Diferencia 2
- Diferencia 3

RESUMEN:
Escribe aquí un breve párrafo de conclusión sobre la comparación.`

  // Single attempt only - no retries to avoid wasting API quota
  const maxRetries = 1
  let lastError: Error | null = null
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile', // 70B model - powerful and fast (280 tps)
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
      
      // Parse response with robust regex (handles **WORD:** markdown bold format)
      const similaritiesMatch = content.match(/\*{0,2}SIMILITUDES:?\*{0,2}\s*([\s\S]*?)(?=\*{0,2}DIFERENCIAS:?|\*{0,2}RESUMEN:|$)/i)
      const differencesMatch = content.match(/\*{0,2}DIFERENCIAS:?\*{0,2}\s*([\s\S]*?)(?=\*{0,2}RESUMEN:|$)/i)
      const summaryMatch = content.match(/\*{0,2}RESUMEN:?\*{0,2}\s*([\s\S]*?)$/i)
      
      // Extract similarities (only bullet points)
      const similarities = similaritiesMatch 
        ? similaritiesMatch[1]
            .split('\n')
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0 && (s.startsWith('-') || s.startsWith('•')))
            .map((s: string) => s.replace(/^[-•]\s*/, '').trim())
            .filter((s: string) => s.length > 10)
        : []
      
      // Extract differences (only bullet points)
      const differences = differencesMatch
        ? differencesMatch[1]
            .split('\n')
            .map((d: string) => d.trim())
            .filter((d: string) => d.length > 0 && (d.startsWith('-') || d.startsWith('•')))
            .map((d: string) => d.replace(/^[-•]\s*/, '').trim())
            .filter((d: string) => d.length > 10)
        : []
      
      // Extract summary (clean text, remove bullet points and extra formatting)
      let summary = summaryMatch 
        ? summaryMatch[1]
            .split('\n')
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0 && !s.startsWith('-') && !s.startsWith('•') && !s.startsWith('**'))
            .join(' ')
            .trim()
            .replace(/\*\*/g, '') // Remove any remaining ** markdown
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

// ==================== NUEVAS FUNCIONALIDADES INNOVADORAS ====================

// 1. DETECCIÓN DE CONTRADICCIONES Y GAPS
export interface ContradictionsAndGapsResult {
  contradictions: Array<{
    topic: string
    description: string
    documents: string[]
  }>
  gaps: Array<{
    topic: string
    description: string
  }>
  summary: string
}

export async function detectContradictionsAndGaps(documents: Document[]): Promise<ContradictionsAndGapsResult> {
  if (documents.length < 2) {
    throw new Error('Se necesitan al menos 2 documentos para detectar contradicciones')
  }

  // Generate document summaries first
  const summaries = await Promise.all(
    documents.map(async (doc) => ({
      name: doc.name,
      summary: await generateDocumentSummary(doc)
    }))
  )

  await new Promise(resolve => setTimeout(resolve, 1000))

  const prompt = `Analiza estos ${documents.length} documentos y detecta contradicciones y vacíos de información:

${summaries.map((s, i) => `${i + 1}. ${s.name}:\n${s.summary}`).join('\n\n')}

Responde en TEXTO PLANO usando este formato exacto:

CONTRADICCIONES:
- Tema: [tema], Descripción: [descripción], Documentos: [doc1, doc2]
- Tema: [tema], Descripción: [descripción], Documentos: [doc1, doc2]

VACÍOS DE INFORMACIÓN:
- Tema: [tema], Descripción: [descripción de qué información falta]
- Tema: [tema], Descripción: [descripción de qué información falta]

RESUMEN:
Un breve párrafo sobre el análisis general.`

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 1000
      })
    })

    if (!response.ok) {
      throw new Error('Error al analizar contradicciones')
    }

    const data = await response.json()
    const content = data.choices[0]?.message?.content || ''

    // Parse contradicciones
    const contradictionsMatch = content.match(/\*{0,2}CONTRADICCIONES:?\*{0,2}\s*([\s\S]*?)(?=\*{0,2}VACÍOS DE INFORMACIÓN:|VACIOS DE INFORMACION:|\*{0,2}RESUMEN:|$)/i)
    const gapsMatch = content.match(/\*{0,2}VACÍOS DE INFORMACIÓN:?|VACIOS DE INFORMACION:?\*{0,2}\s*([\s\S]*?)(?=\*{0,2}RESUMEN:|$)/i)
    const summaryMatch = content.match(/\*{0,2}RESUMEN:?\*{0,2}\s*([\s\S]*?)$/i)

    const contradictions = (contradictionsMatch && contradictionsMatch[1])
      ? contradictionsMatch[1]
          .split('\n')
          .filter((line: string) => line.trim().startsWith('-') || line.trim().startsWith('•'))
          .map((line: string) => {
            const clean = line.replace(/^[-•]\s*/, '').trim()
            const topicMatch = clean.match(/Tema:\s*([^,]+)/i)
            const descMatch = clean.match(/Descripción:\s*([^,]+)/i)
            const docsMatch = clean.match(/Documentos:\s*\[?([^\]]+)\]?/i)
            
            return {
              topic: topicMatch ? topicMatch[1].trim() : 'Sin especificar',
              description: descMatch ? descMatch[1].trim() : clean,
              documents: docsMatch ? docsMatch[1].split(',').map((d: string) => d.trim()) : []
            }
          })
          .filter((c: any) => c.description.length > 10)
      : []

    const gaps = (gapsMatch && gapsMatch[1])
      ? gapsMatch[1]
          .split('\n')
          .filter((line: string) => line.trim().startsWith('-') || line.trim().startsWith('•'))
          .map((line: string) => {
            const clean = line.replace(/^[-•]\s*/, '').trim()
            const topicMatch = clean.match(/Tema:\s*([^,]+)/i)
            const descMatch = clean.match(/Descripción:\s*(.+)/i)
            
            return {
              topic: topicMatch ? topicMatch[1].trim() : 'Información faltante',
              description: descMatch ? descMatch[1].trim() : clean
            }
          })
          .filter((g: any) => g.description.length > 10)
      : []

    const summary = (summaryMatch && summaryMatch[1])
      ? summaryMatch[1].trim().replace(/\*\*/g, '')
      : 'Análisis completado de contradicciones y vacíos de información.'

    return { contradictions, gaps, summary }
  } catch (error) {
    console.error('Error detecting contradictions:', error)
    throw error
  }
}

// 2. MODO DEBATE ENTRE DOCUMENTOS
export interface DebateResult {
  topic: string
  rounds: Array<{
    documentName: string
    position: string
  }>
  conclusion: string
}

export async function debateDocuments(documents: Document[], topic: string): Promise<DebateResult> {
  if (documents.length < 2) {
    throw new Error('Se necesitan al menos 2 documentos para debatir')
  }

  // Generate summaries
  const summaries = await Promise.all(
    documents.map(async (doc) => ({
      name: doc.name,
      summary: await generateDocumentSummary(doc)
    }))
  )

  await new Promise(resolve => setTimeout(resolve, 1000))

  const prompt = `Simula un debate entre estos ${documents.length} documentos sobre el tema: "${topic}"

Documentos:
${summaries.map((s, i) => `${i + 1}. ${s.name}:\n${s.summary}`).join('\n\n')}

Crea un debate donde cada documento presenta su perspectiva sobre "${topic}". Usa este formato:

RONDA 1 - ${summaries[0].name}:
[Posición del documento sobre el tema]

RONDA 1 - ${summaries[1].name}:
[Posición del documento sobre el tema]

${summaries.length > 2 ? `RONDA 1 - ${summaries[2].name}:\n[Posición del documento sobre el tema]\n\n` : ''}
CONCLUSIÓN:
[Síntesis del debate y puntos en común/divergentes]`

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1500
      })
    })

    if (!response.ok) {
      throw new Error('Error al generar debate')
    }

    const data = await response.json()
    const content = data.choices[0]?.message?.content || ''

    // Parse debate rounds
    const rounds: Array<{ documentName: string; position: string }> = []
    
    summaries.forEach((summary) => {
      const regex = new RegExp(`RONDA \\d+ - ${summary.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:?\\s*([\\s\\S]*?)(?=RONDA \\d+|CONCLUSIÓN:|$)`, 'i')
      const match = content.match(regex)
      if (match && match[1]) {
        rounds.push({
          documentName: summary.name,
          position: match[1].trim()
        })
      }
    })

    const conclusionMatch = content.match(/\*{0,2}CONCLUSIÓN:?\*{0,2}\s*([\s\S]*?)$/i)
    const conclusion = conclusionMatch 
      ? conclusionMatch[1].trim().replace(/\*\*/g, '')
      : 'El debate ha concluido.'

    return { topic, rounds, conclusion }
  } catch (error) {
    console.error('Error in debate:', error)
    throw error
  }
}

// 3. ASISTENTE DE ESCRITURA
export interface WritingAssistanceResult {
  generatedText: string
  suggestions: string[]
  styleNotes: string
}

export async function assistWriting(
  documents: Document[], 
  prompt: string,
  mode: 'similar' | 'summary' | 'expand' = 'similar'
): Promise<WritingAssistanceResult> {
  if (documents.length === 0) {
    throw new Error('Se necesita al menos 1 documento como referencia')
  }

  // Get sample content from documents
  const sampleContent = documents
    .slice(0, 3)
    .map(doc => doc.chunks.slice(0, 3).join(' '))
    .join('\n\n')
    .slice(0, 3000)

  let systemPrompt = ''
  let userPrompt = ''

  switch (mode) {
    case 'similar':
      systemPrompt = 'Eres un asistente de escritura experto. Ayudas a escribir texto siguiendo el estilo y tono de documentos de referencia.'
      userPrompt = `Basándote en el estilo y contenido de estos documentos de referencia, ayúdame con lo siguiente:

Documentos de referencia:
${sampleContent}

Solicitud del usuario: ${prompt}

Genera texto que siga el estilo, tono y formato de los documentos de referencia. Sé coherente y profesional.`
      break
    
    case 'summary':
      systemPrompt = 'Eres un asistente experto en crear resúmenes y síntesis de información.'
      userPrompt = `Crea un resumen basándote en estos documentos:

${sampleContent}

Enfoque específico: ${prompt}

Crea un resumen claro, conciso y bien estructurado.`
      break
    
    case 'expand':
      systemPrompt = 'Eres un asistente de escritura que ayuda a expandir y desarrollar ideas.'
      userPrompt = `Usando estos documentos como contexto:

${sampleContent}

Expande y desarrolla esta idea: ${prompt}

Proporciona un texto detallado, bien fundamentado y coherente.`
      break
  }

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    })

    if (!response.ok) {
      throw new Error('Error al generar asistencia de escritura')
    }

    const data = await response.json()
    const generatedText = data.choices[0]?.message?.content || ''

    // Generate writing suggestions
    await new Promise(resolve => setTimeout(resolve, 500))

    const suggestionsPrompt = `Basándote en este texto generado, proporciona 3 sugerencias breves para mejorarlo:

${generatedText.slice(0, 500)}

Responde SOLO con 3 sugerencias, una por línea, sin numeración.`

    const suggestionsResponse = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: suggestionsPrompt }],
        temperature: 0.6,
        max_tokens: 300
      })
    })

    let suggestions: string[] = []
    let styleNotes = ''

    if (suggestionsResponse.ok) {
      const suggestionsData = await suggestionsResponse.json()
      const suggestionsContent = suggestionsData.choices[0]?.message?.content || ''
      suggestions = suggestionsContent
        .split('\n')
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 10)
        .slice(0, 3)
    }

    styleNotes = mode === 'similar' 
      ? 'El texto sigue el estilo de los documentos de referencia.'
      : mode === 'summary'
      ? 'Resumen generado a partir de la información disponible.'
      : 'Texto expandido con detalles adicionales.'

    return {
      generatedText,
      suggestions: suggestions.length > 0 ? suggestions : ['Revisa la coherencia del texto', 'Verifica los datos mencionados', 'Considera agregar ejemplos'],
      styleNotes
    }
  } catch (error) {
    console.error('Error in writing assistance:', error)
    throw error
  }
}
