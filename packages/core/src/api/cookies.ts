import type { FastifyReply } from 'fastify'
import { SESSION_COOKIE } from './sessions.js'

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', secure,
    maxAge: 14 * 24 * 60 * 60,
  })
}
