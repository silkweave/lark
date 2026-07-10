import { BlockParseFn } from '../classes/DocxParser.js'
import { BlockBoard } from '../types/block.js'

export type BoardNodeType = 'image' | 'text_shape' | 'group' | 'composite_shape' | 'svg' | 'connector' | 'table' | 'life_line' | 'activation' | 'section' | 'table_uml' | 'table_er' | 'sticky_note' | 'mind_map' | 'paint'

export type BoardNodeShape = 'round_rect2' | 'ellipse' | 'hexagon' | 'cylinder' | 'parallelogram' | 'trapezoid' | 'triangle' | 'round_rect' | 'step' | 'diamond' | 'rect' | 'star' | 'bubble' | 'pentagon' | 'forward_arrow' | 'document_shape' | 'condition_shape' | 'cloud' | 'cross' | 'step2' | 'predefined_process' | 'delay_shape' | 'off_page_connector' | 'note_shape' | 'data_process' | 'data_store' | 'data_store2' | 'data_store3' | 'star2' | 'star3' | 'star4' | 'actor' | 'brace' | 'condition_shape2' | 'double_arrow' | 'data_flow_round_rect3' | 'rect_bubble' | 'manual_input' | 'flow_chart_round_rect' | 'flow_chart_round_rect2' | 'flow_chart_diamond' | 'flow_chart_parallelogram' | 'flow_chart_cylinder' | 'flow_chart_trapezoid' | 'flow_chart_hexagon' | 'data_flow_round_rect' | 'data_flow_ellipse' | 'backward_arrow' | 'brace_reverse' | 'flow_chart_mq' | 'horiz_cylinder' | 'class_interface' | 'classifier' | 'circular_ring' | 'pie' | 'right_triangle' | 'octagon' | 'state_start' | 'state_end' | 'state_concurrence' | 'component_shape' | 'component_shape2' | 'component_interface' | 'component_required_interface' | 'component_assembly' | 'cube'

export interface BoardNodeText {
  text: string
  font_weight?: 'regular' | 'bold'
  font_size?: number
  horizontal_align?: 'left' | 'center' | 'right'
  vertical_align?: 'top' | 'mid' | 'bottom'
}

export interface BoardNodeStyle {
  fill_opacity?: number
  border_style?: 'solid' | 'none' | 'dash' | 'dot'
  border_width?: 'extra_narrow' | 'narrow' | 'medium' | 'wide'
  border_opacity?: number
  h_flip?: boolean
  v_flip?: boolean
}

export interface BoardNodeTable {
  meta: { row_num: number; col_num: number }
  title?: string
  cells?: BoardNodeTableCell[]
}

export interface BoardNodeTableCell {
  row_index: number
  col_index: number
  merge_info?: { row_span: number; col_span: number }
  children?: string[]
  text?: BoardNodeText
}

export interface BoardNodeConnector {
  start_object?: { id?: string }
  end_object?: { id?: string }
  captions?: { data?: BoardNodeText[] }
}

export interface LarkBoardNode {
  id: string
  type: BoardNodeType
  parent_id?: string
  children?: string[]
  x?: number
  y?: number
  angle?: number
  width?: number
  height?: number
  text?: BoardNodeText
  style?: BoardNodeStyle
  image?: { token: string }
  composite_shape?: { type: BoardNodeShape }
  connector?: BoardNodeConnector
  section?: { title?: string }
  table?: BoardNodeTable
  mind_map?: { parent_id?: string }
}

export interface BBox {
  x: number
  y: number
  width: number
  height: number
}

export interface BoardNode {
  id: string
  bbox: BBox
  type: string
  content?: string
  linkFromId?: string
  linkToId?: string
}

function parseTableContent(allCells: BoardNodeTableCell[]): string {
  const numRows = Math.max(...allCells.map(({ row_index }) => row_index))
  return Array(numRows).fill(null).map((_, index) => {
    const cells = allCells.filter(({ row_index }) => row_index === index + 1).sort((a, b) => a.col_index - b.col_index)
    const values = cells.map((cell) => cell.text?.text ?? ' ')
    return `| ${values.join(' | ')} |`
  }).join('\n')
}

const int = (value = 0) => Math.round(value)

function parseNode(node: LarkBoardNode): BoardNode | undefined {
  const result: BoardNode = {
    id: node.id,
    bbox: { x: int(node.x), y: int(node.y), width: int(node.width), height: int(node.height) },
    type: node.type
  }

  if (node.type === 'table' && node.table?.cells) {
    result.content = parseTableContent(node.table.cells)
  } else if (node.type === 'image') {
    result.content = 'IMAGE'
  } else if (node.type === 'connector' && node.connector) {
    if (node.connector.captions?.data && node.connector.captions.data.length > 0) {
      result.content = node.connector.captions.data.map(({ text }) => text).join('; ')
    }
    if (node.connector.start_object?.id) { result.linkFromId = node.connector.start_object.id }
    if (node.connector.end_object?.id) { result.linkToId = node.connector.end_object.id }
  }
  if (!result.content && node.text?.text) { result.content = node.text.text }
  if (!result.content && !result.linkFromId && !result.linkToId) { return undefined }
  return result
}

export const parseBoard: BlockParseFn<BlockBoard> = async (block, { client }) => {
  async function loadBoardRetry(currentAttempt = 0): Promise<LarkBoardNode[]> {
    if (currentAttempt > 3) { throw new Error('Unable to parse board') }
    const response = await client.withAuth((lark, options) => lark.board.v1.whiteboardNode.list({
      path: { whiteboard_id: block.board.token }
    }, options))
    if (response.nodes) { return response.nodes as LarkBoardNode[] }
    const nextAttempt = currentAttempt + 1
    const timeout = (1 + Math.pow(nextAttempt, 2)) * 1000
    console.info(`~> retry: ${nextAttempt} (${timeout}ms)`)
    await new Promise((resolve) => { setTimeout(resolve, timeout) })
    return loadBoardRetry(currentAttempt + 1)
  }
  const larkNodes = await loadBoardRetry()
  if (!larkNodes) { return '' }
  const nodes = larkNodes.map(parseNode).filter((node) => node != null)
  return `\`\`\`json\n${JSON.stringify(nodes)}\n\`\`\`\n`
}
