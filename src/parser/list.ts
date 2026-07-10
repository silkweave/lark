import { BlockParseFn } from '../classes/DocxParser.js'
import { Block, BlockOrderedList, BlockType, BlockUnorderedList } from '../types/block.js'
import { parseTextElements, withIndent } from './common.js'

type BlockList =
  BlockOrderedList |
  BlockUnorderedList

export const parseListText = (block: BlockList) => {
  if (block.block_type === BlockType.OL) { return `1. ${parseTextElements(block.ordered.elements)}` }
  if (block.block_type === BlockType.UL) { return `* ${parseTextElements(block.bullet.elements)}` }
  return ''
}

export const parseList: BlockParseFn<BlockList> = async (block, parser, depth) => {
  const suffix = parser.next(block)?.block_type === block.block_type ? '' : '\n'
  const text = withIndent(parseListText(block), depth)
  if (!block.children) { return `${text}${suffix}` }
  const childBlocks = block.children
    .map((id) => parser.blocks.find(({ block_id }) => block_id === id))
    .filter((childBlock): childBlock is Block => childBlock != null)
  const childResults = await Promise.all(childBlocks.map((childBlock) => parser.processBlock(childBlock, depth + 1)))
  return `${text}\n${childResults.join('\n')}${suffix}`
}
