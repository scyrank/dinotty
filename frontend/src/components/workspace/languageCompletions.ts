import * as monaco from 'monaco-editor'

interface KeywordEntry {
  label: string
  kind: monaco.languages.CompletionItemKind
  detail?: string
  insertText?: string
  insertTextRules?: monaco.languages.CompletionItemInsertTextRule
}

function kw(label: string, detail?: string): KeywordEntry {
  return { label, kind: monaco.languages.CompletionItemKind.Keyword, detail }
}

function snip(label: string, insertText: string, detail: string): KeywordEntry {
  return {
    label,
    kind: monaco.languages.CompletionItemKind.Snippet,
    detail,
    insertText,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  }
}

function fn(label: string, detail?: string): KeywordEntry {
  return { label, kind: monaco.languages.CompletionItemKind.Function, detail }
}

const rustKeywords: KeywordEntry[] = [
  kw('fn'),
  kw('let'),
  kw('mut'),
  kw('const'),
  kw('static'),
  kw('struct'),
  kw('enum'),
  kw('impl'),
  kw('trait'),
  kw('type'),
  kw('pub'),
  kw('mod'),
  kw('use'),
  kw('crate'),
  kw('self'),
  kw('super'),
  kw('if'),
  kw('else'),
  kw('match'),
  kw('loop'),
  kw('while'),
  kw('for'),
  kw('in'),
  kw('return'),
  kw('break'),
  kw('continue'),
  kw('async'),
  kw('await'),
  kw('move'),
  kw('where'),
  kw('as'),
  kw('ref'),
  kw('unsafe'),
  kw('dyn'),
  kw('box'),
  kw('true'),
  kw('false'),
  fn('println!', 'macro'),
  fn('eprintln!', 'macro'),
  fn('format!', 'macro'),
  fn('vec!', 'macro'),
  fn('todo!', 'macro'),
  fn('unimplemented!', 'macro'),
  fn('String::new'),
  fn('String::from'),
  fn('Vec::new'),
  fn('HashMap::new'),
  fn('Option::Some'),
  fn('Option::None'),
  fn('Result::Ok'),
  fn('Result::Err'),
  snip('fn', 'fn ${1:name}(${2:params}) ${3:-> ${4:Type} }{\n\t$0\n}', 'function'),
  snip('struct', 'struct ${1:Name} {\n\t${2:field}: ${3:Type},\n}', 'struct'),
  snip('enum', 'enum ${1:Name} {\n\t${2:Variant},\n}', 'enum'),
  snip('impl', 'impl ${1:Type} {\n\t$0\n}', 'impl block'),
  snip('trait', 'trait ${1:Name} {\n\t$0\n}', 'trait'),
  snip('match', 'match ${1:expr} {\n\t${2:pat} => ${3:expr},\n}', 'match'),
  snip('test', '#[test]\nfn ${1:test_name}() {\n\t$0\n}', '#[test] function'),
  snip('derive', '#[derive(${1:Debug})]', 'derive attribute'),
]

const pythonKeywords: KeywordEntry[] = [
  kw('def'),
  kw('class'),
  kw('return'),
  kw('yield'),
  kw('if'),
  kw('elif'),
  kw('else'),
  kw('for'),
  kw('while'),
  kw('break'),
  kw('continue'),
  kw('import'),
  kw('from'),
  kw('as'),
  kw('try'),
  kw('except'),
  kw('finally'),
  kw('raise'),
  kw('with'),
  kw('lambda'),
  kw('pass'),
  kw('del'),
  kw('global'),
  kw('nonlocal'),
  kw('and'),
  kw('or'),
  kw('not'),
  kw('is'),
  kw('in'),
  kw('True'),
  kw('False'),
  kw('None'),
  kw('async'),
  kw('await'),
  kw('assert'),
  fn('print'),
  fn('len'),
  fn('range'),
  fn('enumerate'),
  fn('zip'),
  fn('map'),
  fn('filter'),
  fn('sorted'),
  fn('reversed'),
  fn('isinstance'),
  fn('type'),
  fn('hasattr'),
  fn('getattr'),
  fn('setattr'),
  fn('open'),
  fn('input'),
  fn('int'),
  fn('float'),
  fn('str'),
  fn('list'),
  fn('dict'),
  fn('set'),
  fn('tuple'),
  snip('def', 'def ${1:name}(${2:params}):\n\t${0:pass}', 'function'),
  snip('class', 'class ${1:Name}:\n\tdef __init__(self${2:, params}):\n\t\t${0:pass}', 'class'),
  snip('ifmain', 'if __name__ == "__main__":\n\t${0:pass}', 'main guard'),
  snip('try', 'try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${0:pass}', 'try/except'),
  snip('with', 'with ${1:expr} as ${2:var}:\n\t${0:pass}', 'with statement'),
  snip('for', 'for ${1:item} in ${2:iterable}:\n\t${0:pass}', 'for loop'),
  snip('listcomp', '[${1:expr} for ${2:item} in ${3:iterable}]', 'list comprehension'),
]

const goKeywords: KeywordEntry[] = [
  kw('func'),
  kw('var'),
  kw('const'),
  kw('type'),
  kw('struct'),
  kw('interface'),
  kw('package'),
  kw('import'),
  kw('return'),
  kw('if'),
  kw('else'),
  kw('for'),
  kw('range'),
  kw('switch'),
  kw('case'),
  kw('default'),
  kw('select'),
  kw('break'),
  kw('continue'),
  kw('fallthrough'),
  kw('go'),
  kw('chan'),
  kw('defer'),
  kw('map'),
  kw('make'),
  kw('new'),
  kw('true'),
  kw('false'),
  kw('nil'),
  kw('iota'),
  fn('fmt.Println'),
  fn('fmt.Printf'),
  fn('fmt.Sprintf'),
  fn('len'),
  fn('cap'),
  fn('append'),
  fn('copy'),
  fn('delete'),
  fn('close'),
  fn('make'),
  fn('new'),
  fn('panic'),
  fn('recover'),
  fn('errors.New'),
  fn('fmt.Errorf'),
  snip('func', 'func ${1:name}(${2:params}) ${3:returns} {\n\t$0\n}', 'function'),
  snip('struct', 'type ${1:Name} struct {\n\t${2:Field} ${3:Type}\n}', 'struct'),
  snip('interface', 'type ${1:Name} interface {\n\t${0:Method()}\n}', 'interface'),
  snip('iferr', 'if err != nil {\n\t${0:return err}\n}', 'if err != nil'),
  snip('forr', 'for ${1:i}, ${2:v} := range ${3:slice} {\n\t$0\n}', 'for range'),
  snip('goroutine', 'go func() {\n\t$0\n}()', 'goroutine'),
  snip('main', 'func main() {\n\t$0\n}', 'main function'),
  snip('test', 'func Test${1:Name}(t *testing.T) {\n\t$0\n}', 'test function'),
]

const languageMap: Record<string, KeywordEntry[]> = {
  rust: rustKeywords,
  python: pythonKeywords,
  go: goKeywords,
}

const registered = new Set<string>()

export function registerLanguageCompletions(language: string): void {
  if (registered.has(language) || !languageMap[language]) return
  registered.add(language)

  const entries = languageMap[language]
  monaco.languages.registerCompletionItemProvider(language, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }
      return {
        suggestions: entries.map((e) => ({
          label: e.label,
          kind: e.kind,
          detail: e.detail,
          insertText: e.insertText ?? e.label,
          insertTextRules: e.insertTextRules,
          range,
        })),
      }
    },
  })
}
