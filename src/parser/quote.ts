import { BlockParseFn } from '../classes/DocxParser.js'
import { Block, BlockQuote } from '../types/block.js'
import { withIndent, withQuote } from './common.js'

export const parseQuote: BlockParseFn<BlockQuote> = async (block, parser, depth) => {
  if (!block.children) { return '' }
  const childBlocks = block.children
    .map((id) => parser.blocks.find(({ block_id }) => block_id === id))
    .filter((childBlock): childBlock is Block => childBlock != null)
  const childResults = await Promise.all(childBlocks.map((childBlock) => parser.processBlock(childBlock, depth + 1)))
  const result = withIndent(withQuote(`${childResults.join('\n')}`), depth)
  return `${result}\n`
}
