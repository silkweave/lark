export enum BlockType {
  PAGE = 1,
  TEXT = 2,
  HEADING_1 = 3,
  HEADING_2 = 4,
  HEADING_3 = 5,
  HEADING_4 = 6,
  HEADING_5 = 7,
  HEADING_6 = 8,
  HEADING_7 = 9,
  HEADING_8 = 10,
  HEADING_9 = 11,
  UL = 12,
  OL = 13,
  CODE = 14,
  CITE = 15,
  FORMULA = 16,
  TODO = 17,
  BITABLE = 18,
  CALLOUT = 19,
  SESSION_CARD = 20,
  FLOW_CHART = 21,
  SEPARATOR = 22,
  FILE = 23,
  GRID = 24,
  GRID_COLUMN = 25,
  EMBED = 26,
  PICTURE = 27,
  OPEN_PLATFORM = 28,
  THINKING_NOTES = 29,
  SPREADSHEET = 30,
  TABLE = 31,
  TABLE_CELL = 32,
  VIEW = 33,
  QUOTE = 34,
  TASK = 35,
  OKR = 36,
  OKR_OBJECTIVE = 37,
  OKR_KEY_RESULT = 38,
  OKR_PROGRESS = 39,
  ADDON = 40,
  BOARD = 43,
  SUB_PAGE_LIST = 51,
  NOT_SUPPORTED = 999
}

export const MarkdownBlockTypes: BlockType[] = [
  BlockType.PAGE,
  BlockType.TEXT,
  BlockType.HEADING_1,
  BlockType.HEADING_2,
  BlockType.HEADING_3,
  BlockType.HEADING_4,
  BlockType.HEADING_5,
  BlockType.HEADING_6,
  BlockType.HEADING_7,
  BlockType.HEADING_8,
  BlockType.HEADING_9,
  BlockType.UL,
  BlockType.OL,
  BlockType.CODE,
  BlockType.CITE,
  BlockType.FORMULA,
  BlockType.TODO,
  BlockType.TABLE,
  BlockType.CALLOUT,
  BlockType.SEPARATOR,
  BlockType.GRID,
  BlockType.GRID_COLUMN,
  BlockType.EMBED,
  BlockType.TABLE_CELL,
  BlockType.QUOTE,
  BlockType.ADDON
]

export interface BaseBlock {
  block_id: string
  block_type: BlockType
  parent_id: string
  children?: string[]
}

export interface TextElementStyle {
  link?: { url: string }
  inline_code?: boolean
}

export interface TextElement {
  text_run?: { content: string; text_element_style: TextElementStyle }
  mention_doc?: { obj_type: number; title: string; url: string; token: string; text_element_style: TextElementStyle }
}

export type BlockPage = BaseBlock & { block_type: BlockType.PAGE; page: { elements: TextElement[] } }
export type BlockText = BaseBlock & { block_type: BlockType.TEXT; text: { elements: TextElement[] } }
export type BlockQuote = BaseBlock & { block_type: BlockType.QUOTE; text: { elements: TextElement[] } }
export type BlockHeading1 = BaseBlock & { block_type: BlockType.HEADING_1; heading1: { elements: TextElement[]; style: object } }
export type BlockHeading2 = BaseBlock & { block_type: BlockType.HEADING_2; heading2: { elements: TextElement[]; style: object } }
export type BlockHeading3 = BaseBlock & { block_type: BlockType.HEADING_3; heading3: { elements: TextElement[]; style: object } }
export type BlockHeading4 = BaseBlock & { block_type: BlockType.HEADING_4; heading4: { elements: TextElement[]; style: object } }
export type BlockHeading5 = BaseBlock & { block_type: BlockType.HEADING_5; heading5: { elements: TextElement[]; style: object } }
export type BlockHeading6 = BaseBlock & { block_type: BlockType.HEADING_6; heading6: { elements: TextElement[]; style: object } }
export type BlockHeading7 = BaseBlock & { block_type: BlockType.HEADING_7; heading7: { elements: TextElement[]; style: object } }
export type BlockHeading8 = BaseBlock & { block_type: BlockType.HEADING_8; heading8: { elements: TextElement[]; style: object } }
export type BlockHeading9 = BaseBlock & { block_type: BlockType.HEADING_9; heading9: { elements: TextElement[]; style: object } }
export type BlockBoard = BaseBlock & { block_type: BlockType.BOARD; board: { token: string } }
export type BlockView = BaseBlock & { block_type: BlockType.VIEW; view: { view_type: number } }
export type BlockFile = BaseBlock & { block_type: BlockType.FILE; file: { name: string; token: string } }
export type BlockOrderedList = BaseBlock & { block_type: BlockType.OL; ordered: { elements: TextElement[]; style: object } }
export type BlockUnorderedList = BaseBlock & { block_type: BlockType.UL; bullet: { elements: TextElement[]; style: object } }
export type BlockTodo = BaseBlock & { block_type: BlockType.TODO; todo: { elements: TextElement[]; style: { done: boolean } } }
export type BlockCallout = BaseBlock & { block_type: BlockType.CALLOUT; callout: { emoji_id: string; background_color: number } }
export type BlockTable = BaseBlock & { block_type: BlockType.TABLE; table: { cells: string[]; property: { row_size: number; column_size: number } } }
export type BlockTableCell = BaseBlock & { block_type: BlockType.TABLE_CELL; table_cell?: object; children: string[] }
export type BlockAddon = BaseBlock & { block_type: BlockType.ADDON; add_ons: { component_id: string; component_type_id: string; record: string } }

export type Block =
  BlockPage |
  BlockText |
  BlockQuote |
  BlockHeading1 |
  BlockHeading2 |
  BlockHeading3 |
  BlockHeading4 |
  BlockHeading5 |
  BlockHeading6 |
  BlockHeading7 |
  BlockHeading8 |
  BlockHeading9 |
  BlockBoard |
  BlockView |
  BlockFile |
  BlockOrderedList |
  BlockUnorderedList |
  BlockTodo |
  BlockCallout |
  BlockTable |
  BlockTableCell |
  BlockAddon
