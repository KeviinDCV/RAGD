import { pipeline, env } from '@xenova/transformers'

// Configure Transformers.js to use correct CDN for production
env.allowRemoteModels = true
env.allowLocalModels = false
env.useBrowserCache = true
env.backends.onnx.wasm.proxy = false

// Singleton pattern for model loading
class PipelineSingleton {
  static task = 'feature-extraction'
  static model = 'Xenova/all-MiniLM-L6-v2'
  static instance: any = null

  static async getInstance(progress_callback: ((progress: any) => void) | null = null) {
    if (this.instance === null) {
      console.log('Loading embedding model:', this.model)
      try {
        this.instance = await pipeline(this.task as any, this.model, { 
          progress_callback: progress_callback ?? undefined,
          quantized: true, // Use quantized model for faster loading
          revision: 'main' // Use main branch
        })
        console.log('Embedding model loaded successfully')
      } catch (error) {
        console.error('Failed to load embedding model:', error)
        throw error
      }
    }
    return this.instance
  }
}

// Listen for messages from main thread
self.addEventListener('message', async (event) => {
  const { type, data } = event.data

  if (type === 'generate-embedding') {
    try {
      console.log('Worker: Generating embedding for text of length:', data.text.length)
      
      // Get or create pipeline
      const extractor = await PipelineSingleton.getInstance((progress) => {
        // Send download progress to main thread
        console.log('Worker: Model loading progress:', progress)
        self.postMessage({ type: 'progress', data: progress })
      })

      console.log('Worker: Pipeline ready, generating embedding...')
      
      // Generate embedding
      const output = await extractor(data.text, { pooling: 'mean', normalize: true })
      const embedding = Array.from(output.data)

      console.log('Worker: Embedding generated, length:', embedding.length)
      
      // Send result back to main thread
      self.postMessage({ type: 'embedding-result', data: { embedding } })
    } catch (error) {
      console.error('Worker: Error generating embedding:', error)
      self.postMessage({ 
        type: 'error', 
        data: { message: error instanceof Error ? error.message : 'Unknown error' } 
      })
    }
  }
})

export {}
