import { BlockParseFn } from '../classes/DocxParser.js'
import { BlockTable, BlockTableCell, BlockType } from '../types/block.js'

export interface TableCell {
  block?: BlockTableCell
  content: string
  rowIndex: number
  colIndex: number
}

export const parseTable: BlockParseFn<BlockTable> = async ({ table }, parser) => {
  const numCols = table.property.column_size
  const numRows = table.property.row_size
  const cells = await Promise.all(table.cells.map<Promise<TableCell>>(async (id, index) => {
    const block = parser.blocks.find((item): item is BlockTableCell => item.block_id === id && item.block_type === BlockType.TABLE_CELL)
    const content = block ? await parser.processBlock(block) : ''
    const rowIndex = Math.floor(index / numCols)
    const colIndex = index % numCols
    return { block, content, colIndex, rowIndex }
  }))

  const rows = Array(numRows).fill(null).map((_, index) => {
    const rowCells = cells.filter(({ rowIndex }) => rowIndex === index).sort((a, b) => a.colIndex - b.colIndex)
    const values = rowCells.map((cell) => cell.content)
    return `| ${values.join(' | ')} |`
  })
  const header = `| ${Array(numCols).fill(null).map(() => '-').join(' | ')} |`
  rows.splice(1, 0, header)

  return `\n${rows.join('\n')}\n`
}
