import { TextElement } from '../types/block.js'

export function parseTextElements(elements: TextElement[]) {
  const textParts = elements.map(({ text_run, mention_doc }) => {
    const parts: string[] = []
    if (text_run) {
      const text = text_run.content.trim()
      if (text_run.text_element_style.link) {
        parts.push(`[${text}](${decodeURIComponent(text_run.text_element_style.link.url)})`)
      } else {
        parts.push(text)
      }
    }
    if (mention_doc) { return parts.push(`[${mention_doc.title.trim()}](${mention_doc.url})`) }
    if (!text_run?.text_element_style?.inline_code) { parts.push(' ') }
    return parts.join('')
  })
  return textParts.join('').trim()
}

export function withIndent(value: string, depth: number) {
  const lines = value.split('\n')
  const indent = Array(depth).fill(null).map(() => '  ').join('')
  return lines.map((line) => `${indent}${line}`).join('\n')
}

export function withQuote(value: string) {
  const lines = value.split('\n')
  return lines.filter((line) => line.trim().length > 0).map((line) => `> ${line}`).join('\n')
}
