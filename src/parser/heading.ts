import { BlockParseFn } from '../classes/DocxParser.js'
import { Block, BlockHeading1, BlockHeading2, BlockHeading3, BlockHeading4, BlockHeading5, BlockHeading6, BlockHeading7, BlockHeading8, BlockHeading9, BlockType } from '../types/block.js'
import { parseTextElements } from './common.js'

type BlockHeading =
  BlockHeading1 |
  BlockHeading2 |
  BlockHeading3 |
  BlockHeading4 |
  BlockHeading5 |
  BlockHeading6 |
  BlockHeading7 |
  BlockHeading8 |
  BlockHeading9

export const parseHeadingText = (block: BlockHeading) => {
  if (block.block_type === BlockType.HEADING_1) { return `# ${parseTextElements(block.heading1.elements)}` }
  if (block.block_type === BlockType.HEADING_2) { return `## ${parseTextElements(block.heading2.elements)}` }
  if (block.block_type === BlockType.HEADING_3) { return `### ${parseTextElements(block.heading3.elements)}` }
  if (block.block_type === BlockType.HEADING_4) { return `#### ${parseTextElements(block.heading4.elements)}` }
  if (block.block_type === BlockType.HEADING_5) { return `##### ${parseTextElements(block.heading5.elements)}` }
  if (block.block_type === BlockType.HEADING_6) { return `###### ${parseTextElements(block.heading6.elements)}` }
  if (block.block_type === BlockType.HEADING_7) { return `####### ${parseTextElements(block.heading7.elements)}` }
  if (block.block_type === BlockType.HEADING_8) { return `######## ${parseTextElements(block.heading8.elements)}` }
  if (block.block_type === BlockType.HEADING_9) { return `######### ${parseTextElements(block.heading9.elements)}` }
  return ''
}

export const parseHeading: BlockParseFn<BlockHeading> = async (block, parser) => {
  const headingText = parseHeadingText(block)
  if (!block.children) { return `${headingText}\n` }
  const childBlocks = block.children
    .map((id) => parser.blocks.find(({ block_id }) => block_id === id))
    .filter((childBlock): childBlock is Block => childBlock != null)
  const childResults = await Promise.all(childBlocks.map((childBlock) => parser.processBlock(childBlock)))
  return `${headingText}\n\n${childResults.join('\n')}`
}
