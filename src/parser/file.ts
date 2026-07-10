import { BlockParseFn } from '../classes/DocxParser.js'
import { BlockFile } from '../types/block.js'

export const parseFile: BlockParseFn<BlockFile> = ({ file }) => {
  return `File: ${file.name} (ID=${file.token})`
}
