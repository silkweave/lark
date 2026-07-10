import z from 'zod'
import { TENANT_USER_ID } from '../classes/TokenClient.js'

const USER_ID_DESCRIPTION = `Auth identity for this call. Pass '${TENANT_USER_ID}' to use the app's Tenant Access Token and act as the bot (no user login required — the bot must have access to the resource, e.g. be a member of the chat or have the doc shared with it). Pass a token store key (default: 'default') to act as that OAuth-authenticated user.`

/** Shared input schema for the userId parameter — selects user OAuth token vs Tenant Access Token */
export const userIdSchema = (defaultKey = 'default') =>
  z.string().optional().default(defaultKey).describe(
    defaultKey === TENANT_USER_ID
      ? `${USER_ID_DESCRIPTION} Defaults to '${TENANT_USER_ID}' (bot identity).`
      : USER_ID_DESCRIPTION
  )
