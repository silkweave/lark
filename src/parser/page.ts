import { BlockParseFn } from '../classes/DocxParser.js'
import { Block, BlockPage } from '../types/block.js'
import { parseTextElements } from './common.js'

export const parsePage: BlockParseFn<BlockPage> = async (block, parser) => {
  const { includeTitle } = parser.options
  const text = includeTitle ? `# ${parseTextElements(block.page.elements)}` : ''
  if (!block.children) { return text }
  const childBlocks = block.children
    .map((id) => parser.blocks.find(({ block_id }) => block_id === id))
    .filter((childBlock): childBlock is Block => childBlock != null)
  const childResults = await Promise.all(childBlocks.map((childBlock) => parser.processBlock(childBlock)))
  return `${text}\n${childResults.join('\n')}`
}
