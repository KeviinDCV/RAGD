import { useState, useEffect, useRef } from 'react'
import { FileText, Upload, Search, Loader2, AlertCircle, BookOpen, Sparkles, GitCompare, Sun, Moon, Shield, MessageSquare, PenTool, AlertTriangle, Info } from 'lucide-react'
import { useTheme } from './contexts/ThemeContext'
import { uploadDocument, queryDocuments, Source, generateSuggestedQuestions, compareDocuments, ComparisonResult, detectContradictionsAndGaps, ContradictionsAndGapsResult, debateDocuments, DebateResult, assistWriting, WritingAssistanceResult } from './lib/rag'
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
  sources?: Source[]
}

function App() {
  const { theme, toggleTheme } = useTheme()
  const [documents, setDocuments] = useState<Document[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([])
  const [comparison, setComparison] = useState<ComparisonResult | null>(null)
  const [isComparing, setIsComparing] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Estados para nuevas funcionalidades
  const [contradictions, setContradictions] = useState<ContradictionsAndGapsResult | null>(null)
  const [isAnalyzingContradictions, setIsAnalyzingContradictions] = useState(false)
  const [debate, setDebate] = useState<DebateResult | null>(null)
  const [isDebating, setIsDebating] = useState(false)
  const [debateTopic, setDebateTopic] = useState('')
  const [writingAssistance, setWritingAssistance] = useState<WritingAssistanceResult | null>(null)
  const [isWriting, setIsWriting] = useState(false)
  const [writingPrompt, setWritingPrompt] = useState('')
  const [writingMode, setWritingMode] = useState<'similar' | 'summary' | 'expand'>('similar')
  const [activeFeature, setActiveFeature] = useState<'chat' | 'debate' | 'writing' | 'analysis'>('chat')

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
      const newDocs = [...documents, doc]
      setDocuments(newDocs)
      
      // Generate suggested questions only in development to avoid rate limits
      if (import.meta.env.DEV && newDocs.length === 1 && messages.length === 0) {
        try {
          const suggestions = await generateSuggestedQuestions(newDocs)
          if (suggestions.length > 0) {
            setSuggestedQuestions(suggestions)
          }
        } catch (sugErr) {
          console.warn('Could not generate suggestions:', sugErr)
          // Don't show error to user, just skip suggestions
        }
      }
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
        return [...withoutThinking, { 
          role: 'assistant', 
          content: response.answer,
          sources: response.sources 
        }]
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

  const handleCompare = async () => {
    if (documents.length < 2) {
      setError('Se necesitan al menos 2 documentos para comparar')
      return
    }

    // No cooldown needed with Groq! It has generous rate limits (300K TPM, 1K RPM)

    setIsComparing(true)
    setComparison(null)
    setError(null)

    try {
      const result = await compareDocuments(documents)
      setComparison(result)
      // No cooldown needed with Groq!
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error al comparar documentos'
      setError(errorMessage)
    } finally {
      setIsComparing(false)
    }
  }

  // Handler para detección de contradicciones
  const handleAnalyzeContradictions = async () => {
    if (documents.length < 2) {
      setError('Se necesitan al menos 2 documentos para analizar contradicciones')
      return
    }

    setIsAnalyzingContradictions(true)
    setContradictions(null)
    setError(null)

    try {
      const result = await detectContradictionsAndGaps(documents)
      setContradictions(result)
      setActiveFeature('analysis')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al analizar contradicciones')
    } finally {
      setIsAnalyzingContradictions(false)
    }
  }

  // Handler para modo debate
  const handleDebate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (documents.length < 2) {
      setError('Se necesitan al menos 2 documentos para debatir')
      return
    }
    if (!debateTopic.trim()) {
      setError('Ingresa un tema para el debate')
      return
    }

    setIsDebating(true)
    setDebate(null)
    setError(null)

    try {
      const result = await debateDocuments(documents, debateTopic)
      setDebate(result)
      setDebateTopic('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al generar debate')
    } finally {
      setIsDebating(false)
    }
  }

  // Handler para asistente de escritura
  const handleWritingAssist = async (e: React.FormEvent) => {
    e.preventDefault()
    if (documents.length === 0) {
      setError('Se necesita al menos 1 documento como referencia')
      return
    }
    if (!writingPrompt.trim()) {
      setError('Ingresa una solicitud para el asistente')
      return
    }

    setIsWriting(true)
    setWritingAssistance(null)
    setError(null)

    try {
      const result = await assistWriting(documents, writingPrompt, writingMode)
      setWritingAssistance(result)
      setWritingPrompt('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al generar asistencia de escritura')
    } finally {
      setIsWriting(false)
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black text-gray-900 dark:text-gray-100 transition-colors">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Theme Toggle */}
        <div className="flex justify-end mb-4">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg bg-gray-200 dark:bg-zinc-800 hover:bg-gray-300 dark:hover:bg-zinc-700 transition-colors"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sidebar - Documents */}
          <div className="lg:col-span-1">
            <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg border border-gray-200 dark:border-zinc-800 p-6 transition-colors">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-medium flex items-center gap-2">
                  <FileText size={20} className="text-gray-600 dark:text-zinc-400" />
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
                  <div className="p-2 hover:bg-gray-200 dark:hover:bg-zinc-800 rounded-md transition-colors">
                    {isLoading ? (
                      <Loader2 size={20} className="animate-spin text-gray-600 dark:text-zinc-400" />
                    ) : (
                      <Upload size={20} className="text-gray-600 dark:text-zinc-400" />
                    )}
                  </div>
                </label>
              </div>

              {documents.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-zinc-500 text-sm">
                  <FileText size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No hay documentos</p>
                  <p className="text-xs mt-1">PDF, Word, Excel, TXT...</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-3 bg-gray-100 dark:bg-zinc-800/50 rounded-md border border-gray-300 dark:border-zinc-700 hover:border-gray-400 dark:hover:border-zinc-600 transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        <FileText size={16} className="text-gray-600 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{doc.name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {doc.type && (
                              <span className="text-xs text-gray-600 dark:text-zinc-600 bg-gray-200 dark:bg-zinc-950 px-1.5 py-0.5 rounded">
                                {doc.type}
                              </span>
                            )}
                            <span className="text-xs text-gray-500 dark:text-zinc-500">
                              {doc.chunks.length} chunks
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Action Buttons */}
              {documents.length >= 2 && (
                <div className="mt-4 space-y-2">
                  <button
                    onClick={handleCompare}
                    disabled={isComparing}
                    className="w-full px-4 py-2 bg-gray-200 dark:bg-zinc-800 hover:bg-gray-300 dark:hover:bg-zinc-700 border border-gray-300 dark:border-zinc-700 hover:border-gray-400 dark:hover:border-zinc-600 rounded-md transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isComparing ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Comparando...
                      </>
                    ) : (
                      <>
                        <GitCompare size={16} />
                        Comparar Documentos
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleAnalyzeContradictions}
                    disabled={isAnalyzingContradictions}
                    className="w-full px-4 py-2 bg-gray-200 dark:bg-zinc-800 hover:bg-gray-300 dark:hover:bg-zinc-700 border border-gray-300 dark:border-zinc-700 hover:border-gray-400 dark:hover:border-zinc-600 rounded-md transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAnalyzingContradictions ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Analizando...
                      </>
                    ) : (
                      <>
                        <Shield size={16} />
                        Analizar Contradicciones
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setActiveFeature('debate')}
                    className="w-full px-4 py-2 bg-gray-200 dark:bg-zinc-800 hover:bg-gray-300 dark:hover:bg-zinc-700 border border-gray-300 dark:border-zinc-700 hover:border-gray-400 dark:hover:border-zinc-600 rounded-md transition-colors flex items-center justify-center gap-2 text-sm"
                  >
                    <MessageSquare size={16} />
                    Modo Debate
                  </button>
                </div>
              )}

              {documents.length >= 1 && (
                <button
                  onClick={() => setActiveFeature('writing')}
                  className="mt-2 w-full px-4 py-2 bg-gray-200 dark:bg-zinc-800 hover:bg-gray-300 dark:hover:bg-zinc-700 border border-gray-300 dark:border-zinc-700 hover:border-gray-400 dark:hover:border-zinc-600 rounded-md transition-colors flex items-center justify-center gap-2 text-sm"
                >
                  <PenTool size={16} />
                  Asistente de Escritura
                </button>
              )}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="lg:col-span-2">
            <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg border border-gray-200 dark:border-zinc-800 flex flex-col h-[calc(100vh-12rem)] transition-colors">
              {/* Tab Navigation */}
              <div className="flex gap-2 p-4 border-b border-gray-300 dark:border-zinc-800">
                <button
                  onClick={() => setActiveFeature('chat')}
                  className={`px-4 py-2 rounded-md text-sm transition-colors ${
                    activeFeature === 'chat'
                      ? 'bg-gray-300 dark:bg-zinc-700 text-gray-900 dark:text-gray-100'
                      : 'bg-gray-200 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 hover:bg-gray-300 dark:hover:bg-zinc-700'
                  }`}
                >
                  <Search size={14} className="inline mr-1" />
                  Chat
                </button>
                {documents.length >= 2 && (
                  <>
                    <button
                      onClick={() => setActiveFeature('debate')}
                      className={`px-4 py-2 rounded-md text-sm transition-colors ${
                        activeFeature === 'debate'
                          ? 'bg-gray-300 dark:bg-zinc-700 text-gray-900 dark:text-gray-100'
                          : 'bg-gray-200 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 hover:bg-gray-300 dark:hover:bg-zinc-700'
                      }`}
                    >
                      <MessageSquare size={14} className="inline mr-1" />
                      Debate
                    </button>
                    <button
                      onClick={() => setActiveFeature('analysis')}
                      className={`px-4 py-2 rounded-md text-sm transition-colors ${
                        activeFeature === 'analysis'
                          ? 'bg-gray-300 dark:bg-zinc-700 text-gray-900 dark:text-gray-100'
                          : 'bg-gray-200 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 hover:bg-gray-300 dark:hover:bg-zinc-700'
                      }`}
                    >
                      <Shield size={14} className="inline mr-1" />
                      Análisis
                    </button>
                  </>
                )}
                {documents.length >= 1 && (
                  <button
                    onClick={() => setActiveFeature('writing')}
                    className={`px-4 py-2 rounded-md text-sm transition-colors ${
                      activeFeature === 'writing'
                        ? 'bg-gray-300 dark:bg-zinc-700 text-gray-900 dark:text-gray-100'
                        : 'bg-gray-200 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 hover:bg-gray-300 dark:hover:bg-zinc-700'
                    }`}
                  >
                    <PenTool size={14} className="inline mr-1" />
                    Escritura
                  </button>
                )}
              </div>

              {/* Content Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
                {/* VISTA: MODO DEBATE */}
                {activeFeature === 'debate' && (
                  <div className="space-y-4">
                    {!debate ? (
                      <div className="text-center py-12">
                        <MessageSquare size={48} className="mx-auto mb-4 text-gray-400 dark:text-zinc-600" />
                        <h3 className="text-lg font-medium mb-2">Modo Debate entre Documentos</h3>
                        <p className="text-sm text-gray-600 dark:text-zinc-500 mb-6">
                          Ingresa un tema y los documentos debatirán sus diferentes perspectivas
                        </p>
                      </div>
                    ) : (
                      <div className="bg-gray-100 dark:bg-zinc-800/50 border border-gray-300 dark:border-zinc-700 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <MessageSquare size={18} className="text-gray-600 dark:text-zinc-400" />
                            <h3 className="text-sm font-medium">Debate: {debate.topic}</h3>
                          </div>
                          <button
                            onClick={() => setDebate(null)}
                            className="text-xs text-gray-600 dark:text-zinc-500 hover:text-gray-800 dark:hover:text-zinc-400"
                          >
                            Cerrar
                          </button>
                        </div>

                        <div className="space-y-4">
                          {debate.rounds.map((round, idx) => (
                            <div key={idx} className="bg-white dark:bg-zinc-900/50 rounded p-3 border-l-2 border-gray-400 dark:border-zinc-600">
                              <p className="text-xs font-medium text-gray-600 dark:text-zinc-400 mb-2">
                                {round.documentName}
                              </p>
                              <p className="text-sm text-gray-800 dark:text-zinc-300 whitespace-pre-wrap">
                                {round.position}
                              </p>
                            </div>
                          ))}

                          <div className="bg-gray-200 dark:bg-zinc-800 rounded p-3">
                            <p className="text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1">Conclusión</p>
                            <p className="text-sm text-gray-800 dark:text-zinc-300">{debate.conclusion}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* VISTA: ANÁLISIS DE CONTRADICCIONES */}
                {activeFeature === 'analysis' && (
                  <div className="space-y-4">
                    {!contradictions ? (
                      <div className="text-center py-12">
                        <Shield size={48} className="mx-auto mb-4 text-gray-400 dark:text-zinc-600" />
                        <h3 className="text-lg font-medium mb-2">Análisis de Contradicciones y Gaps</h3>
                        <p className="text-sm text-gray-600 dark:text-zinc-500 mb-6">
                          Detecta automáticamente contradicciones e información faltante entre documentos
                        </p>
                        <button
                          onClick={handleAnalyzeContradictions}
                          disabled={isAnalyzingContradictions}
                          className="px-4 py-2 bg-gray-300 dark:bg-zinc-700 hover:bg-gray-400 dark:hover:bg-zinc-600 rounded-md text-sm disabled:opacity-50"
                        >
                          {isAnalyzingContradictions ? 'Analizando...' : 'Iniciar Análisis'}
                        </button>
                      </div>
                    ) : (
                      <div className="bg-gray-100 dark:bg-zinc-800/50 border border-gray-300 dark:border-zinc-700 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <Shield size={18} className="text-gray-600 dark:text-zinc-400" />
                            <h3 className="text-sm font-medium">Análisis de Contradicciones y Gaps</h3>
                          </div>
                          <button
                            onClick={() => setContradictions(null)}
                            className="text-xs text-gray-600 dark:text-zinc-500 hover:text-gray-800 dark:hover:text-zinc-400"
                          >
                            Cerrar
                          </button>
                        </div>

                        <div className="mb-4 p-3 bg-white dark:bg-zinc-900/50 rounded border-l-2 border-gray-400 dark:border-zinc-600">
                          <p className="text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1">Resumen</p>
                          <p className="text-sm text-gray-800 dark:text-zinc-300">{contradictions.summary}</p>
                        </div>

                        {contradictions.contradictions.length > 0 && (
                          <div className="mb-4">
                            <div className="flex items-center gap-2 mb-2">
                              <AlertTriangle size={14} className="text-gray-600 dark:text-zinc-500" />
                              <p className="text-xs font-medium text-gray-600 dark:text-zinc-500">
                                Contradicciones Encontradas ({contradictions.contradictions.length})
                              </p>
                            </div>
                            <div className="space-y-2">
                              {contradictions.contradictions.map((contradiction, idx) => (
                                <div key={idx} className="bg-white dark:bg-zinc-900/50 rounded p-3 border-l-2 border-red-400 dark:border-red-700">
                                  <p className="text-xs font-medium text-gray-700 dark:text-zinc-400 mb-1">
                                    {contradiction.topic}
                                  </p>
                                  <p className="text-sm text-gray-800 dark:text-zinc-300 mb-2">
                                    {contradiction.description}
                                  </p>
                                  {contradiction.documents.length > 0 && (
                                    <p className="text-xs text-gray-500 dark:text-zinc-600">
                                      Docs: {contradiction.documents.join(', ')}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {contradictions.gaps.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <Info size={14} className="text-gray-600 dark:text-zinc-500" />
                              <p className="text-xs font-medium text-gray-600 dark:text-zinc-500">
                                Vacíos de Información ({contradictions.gaps.length})
                              </p>
                            </div>
                            <div className="space-y-2">
                              {contradictions.gaps.map((gap, idx) => (
                                <div key={idx} className="bg-white dark:bg-zinc-900/50 rounded p-3 border-l-2 border-blue-400 dark:border-blue-700">
                                  <p className="text-xs font-medium text-gray-700 dark:text-zinc-400 mb-1">
                                    {gap.topic}
                                  </p>
                                  <p className="text-sm text-gray-800 dark:text-zinc-300">
                                    {gap.description}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* VISTA: ASISTENTE DE ESCRITURA */}
                {activeFeature === 'writing' && (
                  <div className="space-y-4">
                    {!writingAssistance ? (
                      <div className="text-center py-12">
                        <PenTool size={48} className="mx-auto mb-4 text-gray-400 dark:text-zinc-600" />
                        <h3 className="text-lg font-medium mb-2">Asistente de Escritura</h3>
                        <p className="text-sm text-gray-600 dark:text-zinc-500 mb-6">
                          Genera texto basado en el estilo y contenido de tus documentos
                        </p>
                      </div>
                    ) : (
                      <div className="bg-gray-100 dark:bg-zinc-800/50 border border-gray-300 dark:border-zinc-700 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <PenTool size={18} className="text-gray-600 dark:text-zinc-400" />
                            <h3 className="text-sm font-medium">Texto Generado</h3>
                          </div>
                          <button
                            onClick={() => setWritingAssistance(null)}
                            className="text-xs text-gray-600 dark:text-zinc-500 hover:text-gray-800 dark:hover:text-zinc-400"
                          >
                            Cerrar
                          </button>
                        </div>

                        <div className="bg-white dark:bg-zinc-900/50 rounded p-4 mb-4">
                          <p className="text-sm text-gray-800 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
                            {writingAssistance.generatedText}
                          </p>
                        </div>

                        <div className="mb-3">
                          <p className="text-xs font-medium text-gray-600 dark:text-zinc-500 mb-2">
                            💡 Sugerencias de Mejora
                          </p>
                          <ul className="space-y-1">
                            {writingAssistance.suggestions.map((suggestion, idx) => (
                              <li key={idx} className="text-sm text-gray-700 dark:text-zinc-400 flex gap-2">
                                <span className="text-gray-500 dark:text-zinc-600">•</span>
                                <span>{suggestion}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <p className="text-xs text-gray-500 dark:text-zinc-600 italic">
                          {writingAssistance.styleNotes}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* VISTA: CHAT (por defecto) */}
                {activeFeature === 'chat' && (
                  <>
                    {/* Comparison Results */}
                    {comparison && (
                  <div className="bg-gray-100 dark:bg-zinc-800/50 border border-gray-300 dark:border-zinc-700 rounded-lg p-4 mb-4 transition-colors">
                    <div className="flex items-center gap-2 mb-3">
                      <GitCompare size={18} className="text-gray-600 dark:text-zinc-400" />
                      <h3 className="text-sm font-medium">Comparación de Documentos</h3>
                    </div>
                    
                    {/* Summary */}
                    <div className="mb-4 p-3 bg-white dark:bg-zinc-900/50 rounded border-l-2 border-gray-400 dark:border-zinc-600 transition-colors">
                      <p className="text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1">Resumen</p>
                      <p className="text-sm text-gray-800 dark:text-zinc-300">{comparison.summary}</p>
                    </div>
                    
                    {/* Similarities */}
                    {comparison.similarities.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-medium text-gray-600 dark:text-zinc-500 mb-2">Similitudes</p>
                        <ul className="space-y-1">
                          {comparison.similarities.map((sim, idx) => (
                            <li key={idx} className="text-sm text-gray-700 dark:text-zinc-400 flex gap-2">
                              <span className="text-gray-500 dark:text-zinc-600">•</span>
                              <span>{sim}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {/* Differences */}
                    {comparison.differences.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-600 dark:text-zinc-500 mb-2">Diferencias</p>
                        <ul className="space-y-1">
                          {comparison.differences.map((diff, idx) => (
                            <li key={idx} className="text-sm text-gray-700 dark:text-zinc-400 flex gap-2">
                              <span className="text-gray-500 dark:text-zinc-600">•</span>
                              <span>{diff}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    <button
                      onClick={() => setComparison(null)}
                      className="mt-3 text-xs text-gray-600 dark:text-zinc-500 hover:text-gray-800 dark:hover:text-zinc-400 transition-colors"
                    >
                      Cerrar comparación
                    </button>
                  </div>
                )}
                
                {messages.length === 0 && !comparison ? (
                  <div className="h-full flex items-center justify-center text-gray-500 dark:text-zinc-500">
                    <div className="text-center">
                      <img 
                        src="/logo.png" 
                        alt="RAG Document Logo" 
                        className="w-24 h-24 mx-auto mb-6 opacity-50"
                      />
                      <p className="text-lg font-light">Consulta tus documentos</p>
                      <p className="text-sm mt-2">Sube un documento y haz una pregunta</p>
                    </div>
                  </div>
                ) : messages.length > 0 ? (
                  messages.map((message, idx) => (
                    <div
                      key={idx}
                      className={`flex ${
                        message.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg p-4 transition-colors ${
                          message.role === 'user'
                            ? 'bg-gray-200 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700'
                            : 'bg-gray-100 dark:bg-zinc-800/50 border border-gray-200 dark:border-zinc-700/50'
                        }`}
                      >
                        {message.content === '...' ? (
                          <div className="flex items-center gap-2 text-gray-600 dark:text-zinc-400">
                            <Loader2 size={14} className="animate-spin" />
                            <span className="text-sm">Pensando...</span>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                            
                            {/* Sources section */}
                            {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-gray-300 dark:border-zinc-700/50">
                                <div className="flex items-center gap-2 mb-2">
                                  <BookOpen size={14} className="text-gray-600 dark:text-zinc-500" />
                                  <span className="text-xs font-medium text-gray-600 dark:text-zinc-500">
                                    Fuentes ({message.sources.length})
                                  </span>
                                </div>
                                <div className="space-y-2">
                                  {message.sources.map((source, idx) => (
                                    <details key={idx} className="group">
                                      <summary className="cursor-pointer text-xs text-gray-700 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-zinc-300 transition-colors flex items-center gap-2">
                                        <span className="font-mono bg-gray-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                                          [{idx + 1}]
                                        </span>
                                        <span className="truncate">{source.documentName}</span>
                                        <span className="text-gray-500 dark:text-zinc-600 ml-auto">
                                          {(source.similarity * 100).toFixed(0)}%
                                        </span>
                                      </summary>
                                      <div className="mt-2 ml-6 p-2 bg-gray-100 dark:bg-zinc-900/50 rounded text-xs text-gray-700 dark:text-zinc-400 border-l-2 border-gray-300 dark:border-zinc-700">
                                        {source.text}
                                      </div>
                                    </details>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))
                ) : null}
                    <div ref={messagesEndRef} />

                    {/* Suggested Questions */}
                    {suggestedQuestions.length > 0 && messages.length === 0 && (
                      <div className="mt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles size={14} className="text-gray-600 dark:text-zinc-500" />
                          <span className="text-xs font-medium text-gray-600 dark:text-zinc-500">Preguntas sugeridas</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {suggestedQuestions.map((question, idx) => (
                            <button
                              key={idx}
                              onClick={() => setQuery(question)}
                              className="text-xs px-3 py-1.5 bg-gray-200 dark:bg-zinc-800 hover:bg-gray-300 dark:hover:bg-zinc-700 border border-gray-300 dark:border-zinc-700 hover:border-gray-400 dark:hover:border-zinc-600 rounded-full text-gray-700 dark:text-zinc-300 transition-colors"
                            >
                              {question}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Error Display */}
              {error && (
                <div className="mx-4 mb-2 p-3 bg-red-50 dark:bg-zinc-900/50 border border-red-200 dark:border-zinc-700 rounded-md flex items-start gap-2">
                  <AlertCircle size={16} className="text-red-600 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-700 dark:text-zinc-300">{error}</p>
                </div>
              )}

              {/* Input Forms - Different per mode */}
              {activeFeature === 'chat' && (
                <form onSubmit={handleQuery} className="p-4 border-t border-gray-300 dark:border-zinc-800">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Haz una pregunta sobre tus documentos..."
                      disabled={isLoading || documents.length === 0}
                      className="flex-1 bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-md px-4 py-2 text-sm focus:outline-none focus:border-gray-400 dark:focus:border-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    />
                    <button
                      type="submit"
                      disabled={isLoading || !query.trim() || documents.length === 0}
                      className="px-4 py-2 bg-gray-300 dark:bg-zinc-700 hover:bg-gray-400 dark:hover:bg-zinc-600 disabled:bg-gray-200 dark:disabled:bg-zinc-800 disabled:cursor-not-allowed rounded-md transition-colors flex items-center gap-2 text-sm"
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
              )}

              {activeFeature === 'debate' && (
                <form onSubmit={handleDebate} className="p-4 border-t border-gray-300 dark:border-zinc-800">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={debateTopic}
                      onChange={(e) => setDebateTopic(e.target.value)}
                      placeholder="Tema del debate (ej: 'ventajas y desventajas del enfoque')"
                      disabled={isDebating}
                      className="flex-1 bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-md px-4 py-2 text-sm focus:outline-none focus:border-gray-400 dark:focus:border-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    />
                    <button
                      type="submit"
                      disabled={isDebating || !debateTopic.trim()}
                      className="px-4 py-2 bg-gray-300 dark:bg-zinc-700 hover:bg-gray-400 dark:hover:bg-zinc-600 disabled:bg-gray-200 dark:disabled:bg-zinc-800 disabled:cursor-not-allowed rounded-md transition-colors flex items-center gap-2 text-sm"
                    >
                      {isDebating ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Debatiendo...
                        </>
                      ) : (
                        <>
                          <MessageSquare size={16} />
                          Iniciar Debate
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}

              {activeFeature === 'writing' && (
                <form onSubmit={handleWritingAssist} className="p-4 border-t border-gray-300 dark:border-zinc-800 space-y-3">
                  <div className="flex gap-2">
                    <select
                      value={writingMode}
                      onChange={(e) => setWritingMode(e.target.value as 'similar' | 'summary' | 'expand')}
                      className="bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-gray-400 dark:focus:border-zinc-600 transition-colors"
                    >
                      <option value="similar">Estilo Similar</option>
                      <option value="summary">Resumen</option>
                      <option value="expand">Expandir Idea</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={writingPrompt}
                      onChange={(e) => setWritingPrompt(e.target.value)}
                      placeholder="Describe qué quieres escribir..."
                      disabled={isWriting}
                      className="flex-1 bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 rounded-md px-4 py-2 text-sm focus:outline-none focus:border-gray-400 dark:focus:border-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    />
                    <button
                      type="submit"
                      disabled={isWriting || !writingPrompt.trim()}
                      className="px-4 py-2 bg-gray-300 dark:bg-zinc-700 hover:bg-gray-400 dark:hover:bg-zinc-600 disabled:bg-gray-200 dark:disabled:bg-zinc-800 disabled:cursor-not-allowed rounded-md transition-colors flex items-center gap-2 text-sm"
                    >
                      {isWriting ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Generando...
                        </>
                      ) : (
                        <>
                          <PenTool size={16} />
                          Generar
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <footer className="mt-12 pb-6 text-center">
          <p className="text-sm text-gray-500 dark:text-zinc-600">Detal</p>
        </footer>
      </div>
    </div>
  )
}

export default App
