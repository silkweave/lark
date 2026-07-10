import { BlockParseFn } from '../classes/DocxParser.js'
import { Block, BlockCallout } from '../types/block.js'
import { withIndent, withQuote } from './common.js'

export const parseCallout: BlockParseFn<BlockCallout> = async (block, parser, depth) => {
  if (!block.children) { return '' }
  const childBlocks = block.children
    .map((id) => parser.blocks.find(({ block_id }) => block_id === id))
    .filter((childBlock): childBlock is Block => childBlock != null)
  const childResults = await Promise.all(childBlocks.map((childBlock) => parser.processBlock(childBlock, depth + 1)))
  const result = withIndent(withQuote(`:${block.callout.emoji_id}: ${childResults.join('\n')}`), depth)
  return `${result}\n`
}
