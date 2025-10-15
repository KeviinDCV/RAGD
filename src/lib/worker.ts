import { pipeline } from '@xenova/transformers'

// Singleton pattern for model loading
class PipelineSingleton {
  static task = 'feature-extraction'
  static model = 'Xenova/all-MiniLM-L6-v2'
  static instance: any = null

  static async getInstance(progress_callback: ((progress: any) => void) | null = null) {
    if (this.instance === null) {
      this.instance = await pipeline(this.task as any, this.model, { 
        progress_callback: progress_callback ?? undefined 
      })
    }
    return this.instance
  }
}

// Listen for messages from main thread
self.addEventListener('message', async (event) => {
  const { type, data } = event.data

  if (type === 'generate-embedding') {
    try {
      // Get or create pipeline
      const extractor = await PipelineSingleton.getInstance((progress) => {
        // Send download progress to main thread
        self.postMessage({ type: 'progress', data: progress })
      })

      // Generate embedding
      const output = await extractor(data.text, { pooling: 'mean', normalize: true })
      const embedding = Array.from(output.data)

      // Send result back to main thread
      self.postMessage({ type: 'embedding-result', data: { embedding } })
    } catch (error) {
      self.postMessage({ 
        type: 'error', 
        data: { message: error instanceof Error ? error.message : 'Unknown error' } 
      })
    }
  }
})

export {}
