import { BlockParseFn } from '../classes/DocxParser.js'
import { Block, BlockTodo } from '../types/block.js'
import { parseTextElements, withIndent } from './common.js'

export const parseTodo: BlockParseFn<BlockTodo> = async (block, parser, depth) => {
  const mark = block.todo.style.done ? 'x' : ' '
  const text = withIndent(`- [${mark}] ${parseTextElements(block.todo.elements)}`, depth)
  if (!block.children) { return text }
  const childBlocks = block.children
    .map((id) => parser.blocks.find(({ block_id }) => block_id === id))
    .filter((childBlock): childBlock is Block => childBlock != null)
  const childResults = await Promise.all(childBlocks.map((childBlock) => parser.processBlock(childBlock, depth + 1)))
  return `${text}\n${childResults.join('\n')}`
}
