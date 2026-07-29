export function escapeShellPath(p: string): string {
  return /[\s'"\\()&;|<>$!`{}[\]#?*~]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p
}
