import { BlockParseFn } from '../classes/DocxParser.js'
import { BlockText } from '../types/block.js'
import { parseTextElements } from './common.js'

export const parseText: BlockParseFn<BlockText> = (block) => {
  const result = parseTextElements(block.text.elements)
  return `${result}\n`
}
