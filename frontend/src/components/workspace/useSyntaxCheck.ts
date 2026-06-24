import * as monaco from 'monaco-editor'
import { authFetch, apiUrl } from '../../composables/apiBase'

interface SyntaxDiagnostic {
  severity: string
  message: string
  start_line: number
  start_col: number
  end_line: number
  end_col: number
}

interface SyntaxCheckResponse {
  diagnostics: SyntaxDiagnostic[]
}

let timer: ReturnType<typeof setTimeout> | null = null

export function useSyntaxCheck(editor: monaco.editor.IStandaloneCodeEditor | null) {
  function clearDiagnostics(model: monaco.editor.ITextModel) {
    monaco.editor.setModelMarkers(model, 'syntax-check', [])
  }

  async function runSyntaxCheck(paneId: string, filePath: string, language: string) {
    if (!editor) return
    const model = editor.getModel()
    if (!model) return

    const supportedLangs = ['rust', 'python', 'go']
    if (!supportedLangs.includes(language)) {
      clearDiagnostics(model)
      return
    }

    const content = model.getValue()

    try {
      const resp = await authFetch(apiUrl('/api/workspace/syntax-check'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: filePath, content }),
      })
      if (!resp.ok) {
        clearDiagnostics(model)
        return
      }
      const data: SyntaxCheckResponse = await resp.json()
      const markers: monaco.editor.IMarkerData[] = data.diagnostics.map((d) => ({
        severity:
          d.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
        message: d.message,
        startLineNumber: d.start_line,
        startColumn: d.start_col,
        endLineNumber: d.end_line || d.start_line,
        endColumn: d.end_col || d.start_col + 1,
      }))
      monaco.editor.setModelMarkers(model, 'syntax-check', markers)
    } catch {
      clearDiagnostics(model)
    }
  }

  function scheduleCheck(
    paneId: string | undefined,
    filePath: string | undefined,
    language: string
  ) {
    if (timer) clearTimeout(timer)
    if (!paneId || !filePath) return
    timer = setTimeout(() => {
      runSyntaxCheck(paneId, filePath, language)
    }, 800)
  }

  function dispose() {
    if (timer) clearTimeout(timer)
    if (editor) {
      const model = editor.getModel()
      if (model) clearDiagnostics(model)
    }
  }

  return { runSyntaxCheck, scheduleCheck, dispose, clearDiagnostics }
}
