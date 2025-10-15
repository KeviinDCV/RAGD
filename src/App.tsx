import { useState, useEffect, useRef } from 'react'
import { FileText, Upload, Search, Loader2, AlertCircle } from 'lucide-react'
import { uploadDocument, queryDocuments } from './lib/rag'
import { getSupportedFileTypes } from './lib/documentParser'

interface Document {
  id: string
  name: string
  content: string
  chunks: string[]
  type?: string
  metadata?: Record<string, any>
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

function App() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsLoading(true)
    setError(null)

    try {
      const doc = await uploadDocument(file)
      setDocuments(prev => [...prev, doc])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar documento')
    } finally {
      setIsLoading(false)
      // Reset input para permitir subir el mismo archivo de nuevo
      event.target.value = ''
    }
  }

  const handleQuery = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim() || documents.length === 0) return

    setIsLoading(true)
    setError(null)
    
    const userMessage: Message = { role: 'user', content: query }
    setMessages(prev => [...prev, userMessage])
    
    // Add temporary "thinking" message
    const thinkingMessage: Message = { role: 'assistant', content: '...' }
    setMessages(prev => [...prev, thinkingMessage])

    try {
      const response = await queryDocuments(query, documents)
      // Replace thinking message with actual response
      setMessages(prev => {
        const withoutThinking = prev.slice(0, -1)
        return [...withoutThinking, { role: 'assistant', content: response }]
      })
      setQuery('')
    } catch (err) {
      // Remove thinking message on error
      setMessages(prev => prev.slice(0, -1))
      setError(err instanceof Error ? err.message : 'Error al procesar consulta')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-gray-100">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sidebar - Documents */}
          <div className="lg:col-span-1">
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-medium flex items-center gap-2">
                  <FileText size={20} className="text-zinc-400" />
                  Documentos
                </h2>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    className="hidden"
                    accept={getSupportedFileTypes()}
                    onChange={handleFileUpload}
                    disabled={isLoading}
                  />
                  <div className="p-2 hover:bg-zinc-800 rounded-md transition-colors">
                    {isLoading ? (
                      <Loader2 size={20} className="animate-spin text-zinc-400" />
                    ) : (
                      <Upload size={20} className="text-zinc-400" />
                    )}
                  </div>
                </label>
              </div>

              {documents.length === 0 ? (
                <div className="text-center py-8 text-zinc-500 text-sm">
                  <FileText size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No hay documentos</p>
                  <p className="text-xs mt-1">PDF, Word, Excel, TXT...</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-3 bg-zinc-800/50 rounded-md border border-zinc-700 hover:border-zinc-600 transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        <FileText size={16} className="text-zinc-400 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{doc.name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {doc.type && (
                              <span className="text-xs text-zinc-600 bg-zinc-950 px-1.5 py-0.5 rounded">
                                {doc.type}
                              </span>
                            )}
                            <span className="text-xs text-zinc-500">
                              {doc.chunks.length} chunks
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Main - Chat */}
          <div className="lg:col-span-2">
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 flex flex-col h-[calc(100vh-12rem)]">
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
                {messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-zinc-500">
                    <div className="text-center">
                      <Search size={48} className="mx-auto mb-4 opacity-30" />
                      <p className="text-lg font-light">Consulta tus documentos</p>
                      <p className="text-sm mt-2">Sube un documento y haz una pregunta</p>
                    </div>
                  </div>
                ) : (
                  messages.map((message, idx) => (
                    <div
                      key={idx}
                      className={`flex ${
                        message.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg p-4 ${
                          message.role === 'user'
                            ? 'bg-zinc-800 border border-zinc-700'
                            : 'bg-zinc-800/50 border border-zinc-700/50'
                        }`}
                      >
                        {message.content === '...' ? (
                          <div className="flex items-center gap-2 text-zinc-400">
                            <Loader2 size={14} className="animate-spin" />
                            <span className="text-sm">Pensando...</span>
                          </div>
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Error Display */}
              {error && (
                <div className="mx-4 mb-2 p-3 bg-zinc-900/50 border border-zinc-700 rounded-md flex items-start gap-2">
                  <AlertCircle size={16} className="text-zinc-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-zinc-300">{error}</p>
                </div>
              )}

              {/* Input */}
              <form onSubmit={handleQuery} className="p-4 border-t border-zinc-800">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Haz una pregunta sobre tus documentos..."
                    disabled={isLoading || documents.length === 0}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-4 py-2 text-sm focus:outline-none focus:border-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !query.trim() || documents.length === 0}
                    className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:cursor-not-allowed rounded-md transition-colors flex items-center gap-2 text-sm"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Procesando...
                      </>
                    ) : (
                      <>
                        <Search size={16} />
                        Buscar
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
        
        {/* Footer con firma */}
        <footer className="mt-12 pb-6 text-center">
          <p className="text-sm text-zinc-600">Kevin Ch</p>
        </footer>
      </div>
    </div>
  )
}

export default App
