import { BlockParseFn } from '../classes/DocxParser.js'
import { Block, BlockView } from '../types/block.js'

export const parseView: BlockParseFn<BlockView> = async (block, parser) => {
  if (!block.children) { return '' }
  const childBlocks = block.children
    .map((id) => parser.blocks.find(({ block_id }) => block_id === id))
    .filter((childBlock): childBlock is Block => childBlock != null)
  const childResults = await Promise.all(childBlocks.map((childBlock) => parser.processBlock(childBlock)))
  return childResults.join('\n')
}
