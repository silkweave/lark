import { create } from 'xmlbuilder2'
import { BlockParseFn } from '../../classes/DocxParser.js'
import { BlockAddon } from '../../types/block.js'

export interface VariableRecord {
  name: string
  required: boolean
  escape: boolean
  defaultValue: string
}

export const parseVariableAddon: BlockParseFn<BlockAddon> = async (block, parser) => {
  const suffix = parser.next(block)?.block_type === block.block_type ? '' : '\n'
  const { name, required, escape, defaultValue }: VariableRecord = JSON.parse(block.add_ons.record)
  const attributes: Record<string, string> = { name }
  if (!required && defaultValue?.trim()) { attributes['defaultValue'] = defaultValue }
  if (escape) { attributes['escape'] = 'true' }
  const result = create({ version: '2.0' })
    .ele('variable', attributes)
    .end({ prettyPrint: false, wellFormed: true, headless: true, allowEmptyTags: false, spaceBeforeSlash: true })
  return `${result}${suffix}`
}
