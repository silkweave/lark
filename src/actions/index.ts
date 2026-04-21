import { AuthenAuthorize } from './Authen/AuthenAuthorize.js'
import { AuthenOauthToken } from './Authen/AuthenOauthToken.js'
import { AuthenUserInfo } from './Authen/AuthenUserInfo.js'
import { BitableAppGet } from './Bitable/BitableAppGet.js'
import { BitableFieldCreate } from './Bitable/BitableFieldCreate.js'
import { BitableFieldDelete } from './Bitable/BitableFieldDelete.js'
import { BitableFieldList } from './Bitable/BitableFieldList.js'
import { BitableFieldUpdate } from './Bitable/BitableFieldUpdate.js'
import { BitableRecordBatchCreate } from './Bitable/BitableRecordBatchCreate.js'
import { BitableRecordCreate } from './Bitable/BitableRecordCreate.js'
import { BitableRecordDelete } from './Bitable/BitableRecordDelete.js'
import { BitableRecordSearch } from './Bitable/BitableRecordSearch.js'
import { BitableRecordUpdate } from './Bitable/BitableRecordUpdate.js'
import { BitableTableCreate } from './Bitable/BitableTableCreate.js'
import { BitableTableList } from './Bitable/BitableTableList.js'
import { ContactUserList } from './Contact/ContactUserList.js'
import { DocxDocumentBlockList } from './Docx/DocxDocumentBlockList.js'
import { DocxDocumentExport } from './Docx/DocxDocumentExport.js'
import { DocxDocumentImport } from './Docx/DocxDocumentImport.js'
import { ImChatList } from './Im/ImChatList.js'
import { ImChatSearch } from './Im/ImChatSearch.js'
import { ImMessageReply } from './Im/ImMessageReply.js'
import { ImMessageSend } from './Im/ImMessageSend.js'
import { McpHealth } from './Mcp/McpHealth.js'
import { McpRestart } from './Mcp/McpRestart.js'
import { WikiSearch } from './Wiki/WikiSearch.js'
import { WikiSpaceGetNode } from './Wiki/WikiSpaceGetNode.js'
import { WikiSpaceList } from './Wiki/WikiSpaceList.js'
import { WikiSpaceNodeCopy } from './Wiki/WikiSpaceNodeCopy.js'
import { WikiSpaceNodeCreate } from './Wiki/WikiSpaceNodeCreate.js'
import { WikiSpaceNodeDelete } from './Wiki/WikiSpaceNodeDelete.js'
import { WikiSpaceNodeList } from './Wiki/WikiSpaceNodeList.js'
import { WikiSpaceNodeMove } from './Wiki/WikiSpaceNodeMove.js'

export const actions = [
  AuthenAuthorize,
  AuthenOauthToken,
  AuthenUserInfo,
  BitableAppGet,
  BitableFieldCreate,
  BitableFieldDelete,
  BitableFieldList,
  BitableFieldUpdate,
  BitableRecordBatchCreate,
  BitableRecordCreate,
  BitableRecordDelete,
  BitableRecordSearch,
  BitableRecordUpdate,
  BitableTableCreate,
  BitableTableList,
  ContactUserList,
  DocxDocumentBlockList,
  DocxDocumentExport,
  DocxDocumentImport,
  ImChatList,
  ImChatSearch,
  ImMessageReply,
  ImMessageSend,
  McpHealth,
  McpRestart,
  WikiSearch,
  WikiSpaceGetNode,
  WikiSpaceList,
  WikiSpaceNodeCopy,
  WikiSpaceNodeCreate,
  WikiSpaceNodeDelete,
  WikiSpaceNodeList,
  WikiSpaceNodeMove
]
