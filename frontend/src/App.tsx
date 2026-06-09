import { Routes, Route } from 'react-router-dom'
import ChatPage from './pages/ChatPage'
import TranscriptsPage from './pages/TranscriptsPage'
import TranscriptViewPage from './pages/TranscriptViewPage'
import AdminPage from './pages/AdminPage'
import LiveStatusPage from './pages/LiveStatusPage'
import DbBrowserPage from './pages/DbBrowserPage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ChatPage />} />
      <Route path="/transcripts" element={<TranscriptsPage />} />
      <Route path="/transcripts/:videoId" element={<TranscriptViewPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/admin/live" element={<LiveStatusPage />} />
      <Route path="/lyrical-theology" element={<DbBrowserPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
