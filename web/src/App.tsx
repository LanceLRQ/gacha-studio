import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "@/layouts/AppShell";
import { GameDetail } from "@/pages/GameDetail";
import { Overview } from "@/pages/Overview";
import { Records } from "@/pages/Records";
import { Settings } from "@/pages/Settings";
import { Welcome } from "@/pages/Welcome";

export function App() {
  return (
    <Routes>
      <Route path="/welcome" element={<Welcome />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<Overview />} />
        <Route path="/game/:gameId" element={<GameDetail />} />
        <Route path="/game/:gameId/records" element={<Records />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
