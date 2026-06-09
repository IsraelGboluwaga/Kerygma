import { Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import { NavProvider } from './contexts/NavContext'
import { ConversationsProvider } from './contexts/ConversationsContext'
import NavDrawer from './components/NavDrawer'
import ChatPage from './pages/ChatPage'
import TranscriptsPage from './pages/TranscriptsPage'
import TranscriptViewPage from './pages/TranscriptViewPage'
import AdminPage from './pages/AdminPage'
import LiveStatusPage from './pages/LiveStatusPage'
import DbBrowserPage from './pages/DbBrowserPage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  return (
    <ThemeProvider>
      <NavProvider>
        <ConversationsProvider>
          <Routes>
            <Route path="/" element={<ChatPage />} />
            <Route path="/transcripts" element={<TranscriptsPage />} />
            <Route path="/transcripts/:videoId" element={<TranscriptViewPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/live" element={<LiveStatusPage />} />
            <Route path="/lyrical-theology" element={<DbBrowserPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          {/* NavDrawer renders once; hides itself on desktop via sm:hidden */}
          <NavDrawer />
        </ConversationsProvider>
      </NavProvider>
    </ThemeProvider>
  )
}
