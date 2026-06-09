import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { ChatSource } from '../api/types'

export interface Turn {
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
  streaming?: boolean
}

export interface Conversation {
  id: string
  turns: Turn[]
  draft: string
  busy: boolean
  error: string | null
}

let convSeq = 0
export function newConversation(): Conversation {
  convSeq += 1
  return { id: `c${Date.now()}-${convSeq}`, turns: [], draft: '', busy: false, error: null }
}

interface ConversationsCtx {
  conversations: Conversation[]
  activeId: string
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>
  setActiveId: React.Dispatch<React.SetStateAction<string>>
  updateConv: (id: string, fn: (c: Conversation) => Conversation) => void
  updateLastTurn: (id: string, partial: Partial<Turn>) => void
  addConversation: () => void
  closeConversation: (id: string) => void
}

const ConversationsContext = createContext<ConversationsCtx>(null!)

export function useConversations(): ConversationsCtx {
  return useContext(ConversationsContext)
}

// Created at module load — stable across renders, shared by both useState initialisers.
const _first = newConversation()

export function ConversationsProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([_first])
  const [activeId, setActiveId] = useState<string>(_first.id)

  const updateConv = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)))
  }, [])

  const updateLastTurn = useCallback((id: string, partial: Partial<Turn>) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c
        const turns = [...c.turns]
        const i = turns.length - 1
        if (i >= 0) turns[i] = { ...turns[i], ...partial }
        return { ...c, turns }
      })
    )
  }, [])

  const addConversation = useCallback(() => {
    const conv = newConversation()
    setConversations((prev) => [...prev, conv])
    setActiveId(conv.id)
  }, [])

  const closeConversation = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id)
        const list = next.length > 0 ? next : [newConversation()]
        if (id === activeId) {
          const idx = prev.findIndex((c) => c.id === id)
          setActiveId(list[Math.min(idx, list.length - 1)].id)
        }
        return list
      })
    },
    [activeId]
  )

  return (
    <ConversationsContext.Provider
      value={{ conversations, activeId, setConversations, setActiveId, updateConv, updateLastTurn, addConversation, closeConversation }}
    >
      {children}
    </ConversationsContext.Provider>
  )
}
