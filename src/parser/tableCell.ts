import { BlockParseFn } from '../classes/DocxParser.js'
import { Block, BlockTableCell } from '../types/block.js'

export const parseTableCell: BlockParseFn<BlockTableCell> = async ({ children }, parser) => {
  const childBlocks = children
    .map((id) => parser.blocks.find(({ block_id }) => block_id === id))
    .filter((childBlock): childBlock is Block => childBlock != null)
  const childResults = await Promise.all(childBlocks.map((childBlock) => parser.processBlock(childBlock)))
  return childResults.join('\n')
}
