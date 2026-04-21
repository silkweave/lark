import { parseAddon } from '../parser/addon.js'
import { parseBoard } from '../parser/board.js'
import { parseCallout } from '../parser/callout.js'
import { parseFile } from '../parser/file.js'
import { parseHeading } from '../parser/heading.js'
import { parseList } from '../parser/list.js'
import { parsePage } from '../parser/page.js'
import { parseQuote } from '../parser/quote.js'
import { parseTable } from '../parser/table.js'
import { parseTableCell } from '../parser/tableCell.js'
import { parseText } from '../parser/text.js'
import { parseTodo } from '../parser/todo.js'
import { parseView } from '../parser/view.js'
import { BaseBlock, Block, BlockType } from '../types/block.js'
import { TokenClient } from './TokenClient.js'

export type BlockParseFn<T extends BaseBlock> = (block: T, parser: DocxParser, depth: number) => string | Promise<string>

export interface BlockParser<T extends BaseBlock> {
  type: T['block_type']
  parse: BlockParseFn<T>
}

export interface DocxParserOptions {
  includeTitle: boolean
}

export class DocxParser {
  public client: TokenClient
  public options: DocxParserOptions
  public registry: Record<BlockType, BlockParseFn<Block>>
  public blocks: Block[] = []

  constructor(store: TokenClient, options?: DocxParserOptions) {
    this.client = store
    this.options = { includeTitle: true, ...options }
    this.registry = {} as Record<BlockType, BlockParseFn<Block>>
    this.registerBlockParser(BlockType.PAGE, parsePage)
    this.registerBlockParser(BlockType.TEXT, parseText)
    this.registerBlockParser(BlockType.HEADING_1, parseHeading)
    this.registerBlockParser(BlockType.HEADING_2, parseHeading)
    this.registerBlockParser(BlockType.HEADING_3, parseHeading)
    this.registerBlockParser(BlockType.HEADING_4, parseHeading)
    this.registerBlockParser(BlockType.HEADING_5, parseHeading)
    this.registerBlockParser(BlockType.HEADING_6, parseHeading)
    this.registerBlockParser(BlockType.HEADING_7, parseHeading)
    this.registerBlockParser(BlockType.HEADING_8, parseHeading)
    this.registerBlockParser(BlockType.HEADING_9, parseHeading)
    this.registerBlockParser(BlockType.OL, parseList)
    this.registerBlockParser(BlockType.UL, parseList)
    this.registerBlockParser(BlockType.TODO, parseTodo)
    this.registerBlockParser(BlockType.CALLOUT, parseCallout)
    this.registerBlockParser(BlockType.VIEW, parseView)
    this.registerBlockParser(BlockType.TABLE, parseTable)
    this.registerBlockParser(BlockType.TABLE_CELL, parseTableCell)
    this.registerBlockParser(BlockType.FILE, parseFile)
    this.registerBlockParser(BlockType.BOARD, parseBoard)
    this.registerBlockParser(BlockType.QUOTE, parseQuote)
    this.registerBlockParser(BlockType.ADDON, parseAddon)
  }

  registerBlockParser<T extends Block>(type: T['block_type'], parse: BlockParseFn<T>) {
    this.registry[type] = parse as BlockParseFn<Block>
  }

  async processBlock(block: Block, depth = 0) {
    if (block.block_type in this.registry) {
      const result = await Promise.resolve(this.registry[block.block_type](block, this, depth))
      return result ?? ''
    }
    return ''
  }

  async process(documentId: string): Promise<string> {
    const response = await this.client.withUser((lark, options) => lark.docx.documentBlock.list({
      path: { document_id: documentId }
    }, options))
    this.blocks = response.items as Block[] ?? []
    const block = this.blocks.find(({ block_type }) => block_type === BlockType.PAGE)
    if (!block) { throw new Error('Missing Page Block') }
    const content = await this.processBlock(block)
    return content.trim()
  }

  next(block: Block) {
    const index = this.blocks.indexOf(block)
    return this.blocks[index + 1]
  }

  prev(block: Block) {
    const index = this.blocks.indexOf(block)
    return this.blocks[index - 1]
  }
}
