import * as pdfjsLib from 'pdfjs-dist'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`

export interface ParsedDocument {
  text: string
  pageCount?: number
  metadata?: Record<string, any>
}

/**
 * Parse PDF file and extract text
 */
async function parsePDF(file: File): Promise<ParsedDocument> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  
  let fullText = ''
  const pageCount = pdf.numPages

  // Extract text from each page
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ')
    
    fullText += pageText + '\n\n'
  }

  return {
    text: fullText.trim(),
    pageCount,
    metadata: {
      fingerprints: pdf.fingerprints,
      numPages: pageCount
    }
  }
}

/**
 * Parse Word document (.docx) and extract text
 */
async function parseDocx(file: File): Promise<ParsedDocument> {
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  
  return {
    text: result.value.trim(),
    metadata: {
      messages: result.messages
    }
  }
}

/**
 * Parse Excel file (.xlsx, .xls) and extract text from all sheets
 */
async function parseExcel(file: File): Promise<ParsedDocument> {
  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  
  let fullText = ''
  
  // Process each sheet
  workbook.SheetNames.forEach((sheetName: string) => {
    const sheet = workbook.Sheets[sheetName]
    const sheetData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][]
    
    fullText += `Sheet: ${sheetName}\n`
    
    // Convert sheet data to text
    sheetData.forEach((row) => {
      const rowText = row.filter(cell => cell !== null && cell !== undefined).join(' | ')
      if (rowText.trim()) {
        fullText += rowText + '\n'
      }
    })
    
    fullText += '\n'
  })
  
  return {
    text: fullText.trim(),
    metadata: {
      sheets: workbook.SheetNames,
      sheetCount: workbook.SheetNames.length
    }
  }
}

/**
 * Parse plain text file
 */
async function parseText(file: File): Promise<ParsedDocument> {
  const text = await file.text()
  
  return {
    text: text.trim()
  }
}

/**
 * Parse CSV file
 */
async function parseCSV(file: File): Promise<ParsedDocument> {
  const text = await file.text()
  const lines = text.split('\n')
  
  let formattedText = ''
  lines.forEach((line) => {
    const cells = line.split(',').map(cell => cell.trim())
    formattedText += cells.join(' | ') + '\n'
  })
  
  return {
    text: formattedText.trim(),
    metadata: {
      lineCount: lines.length
    }
  }
}

/**
 * Main document parser that routes to the appropriate parser based on file type
 */
export async function parseDocument(file: File): Promise<ParsedDocument> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  
  try {
    switch (extension) {
      case 'pdf':
        return await parsePDF(file)
      
      case 'docx':
      case 'doc':
        return await parseDocx(file)
      
      case 'xlsx':
      case 'xls':
        return await parseExcel(file)
      
      case 'csv':
        return await parseCSV(file)
      
      case 'txt':
      case 'md':
      case 'markdown':
      case 'json':
      case 'js':
      case 'ts':
      case 'jsx':
      case 'tsx':
      case 'html':
      case 'css':
      case 'xml':
      case 'yaml':
      case 'yml':
        return await parseText(file)
      
      default:
        // Try to parse as text for unknown formats
        return await parseText(file)
    }
  } catch (error) {
    throw new Error(`Error al parsear ${file.name}: ${error instanceof Error ? error.message : 'Error desconocido'}`)
  }
}

/**
 * Get supported file types for file input accept attribute
 */
export function getSupportedFileTypes(): string {
  return [
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.csv',
    '.txt',
    '.md',
    '.markdown',
    '.json',
    '.js',
    '.ts',
    '.jsx',
    '.tsx',
    '.html',
    '.css',
    '.xml',
    '.yaml',
    '.yml'
  ].join(',')
}

/**
 * Get human-readable file type description
 */
export function getFileTypeDescription(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase()
  
  const descriptions: Record<string, string> = {
    pdf: 'PDF',
    doc: 'Word',
    docx: 'Word',
    xls: 'Excel',
    xlsx: 'Excel',
    csv: 'CSV',
    txt: 'Texto',
    md: 'Markdown',
    markdown: 'Markdown',
    json: 'JSON',
    js: 'JavaScript',
    ts: 'TypeScript',
    jsx: 'React',
    tsx: 'React TypeScript',
    html: 'HTML',
    css: 'CSS',
    xml: 'XML',
    yaml: 'YAML',
    yml: 'YAML'
  }
  
  return descriptions[extension || ''] || 'Archivo'
}
