import { BlockParseFn } from '../classes/DocxParser.js'
import { BlockAddon } from '../types/block.js'
import { parseVariableAddon } from './addons/variable.js'

const Addons: Record<string, BlockParseFn<BlockAddon>> = {
  'blk_67a6884873800020d68db80f': parseVariableAddon
}

export const parseAddon: BlockParseFn<BlockAddon> = (block, parser, depth) => {
  return Addons[block.add_ons.component_type_id]?.(block, parser, depth) ?? ''
}
