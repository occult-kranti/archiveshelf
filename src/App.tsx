import { Route, Routes } from "react-router";
import AuthLayout from "./components/AuthLayout";
import AppShell from "./components/AppShell";
import ImportPage from "./pages/ImportPage";
import ChannelsPage from "./pages/ChannelsPage";
import JobDetailPage from "./pages/JobDetailPage";
import JobsPage from "./pages/JobsPage";
import LibraryPage from "./pages/LibraryPage";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import VideoPage from "./pages/VideoPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <AuthLayout>
            <AppShell />
          </AuthLayout>
        }
      >
        <Route path="/" element={<LibraryPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:publicId" element={<JobDetailPage />} />
        <Route path="/videos/:id" element={<VideoPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
