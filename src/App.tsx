import { lazy, useEffect, useRef } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";

import DashboardLayout from "@/layouts/dashboard";
import { getConfig, setConfig } from "@/utils/configService";
import { checkAndNotify } from "@/utils/updateService";
import { ensureTodoLoaded } from "@/stores/todoStore";

const DashboardPage = lazy(() => import("@/pages/dashboard"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const DeveloperPage = lazy(() => import("@/pages/developer"));
const AccountPage = lazy(() => import("@/pages/account"));
const CharactersPage = lazy(() => import("@/pages/characters"));
const MedalsPage = lazy(() => import("@/pages/medals"));
const AttendancePage = lazy(() => import("@/pages/attendance"));
const GachaRecordsPage = lazy(() => import("@/pages/gacha-records"));
const TodoPage = lazy(() => import("@/pages/todo"));

const ROUTES = ["/", "/settings", "/account", "/characters", "/medals", "/attendance", "/gacha", "/todo", "/developer"];

function RouteRestore() {
  const location = useLocation();
  const navigate = useNavigate();
  const restored = useRef(false);

  useEffect(() => {
    getConfig<string>("last_route").then((savedPath) => {
      restored.current = true;
      if (savedPath && ROUTES.includes(savedPath) && savedPath !== location.pathname) {
        navigate(savedPath, { replace: true });
      }
    });
  }, []);

  useEffect(() => {
    if (restored.current) {
      setConfig("last_route", location.pathname);
    }
  }, [location.pathname]);

  return null;
}

function UpdateChecker() {
  const notified = useRef(false);

  useEffect(() => {
    if (notified.current) return;
    notified.current = true;
    checkAndNotify();
  }, []);

  return null;
}

function App() {
  useEffect(() => {
    void ensureTodoLoaded();
  }, []);

  return (
    <>
      <RouteRestore />
      <UpdateChecker />
      <Routes>
        <Route
          element={
            <DashboardLayout>
              <DashboardPage />
            </DashboardLayout>
          }
          path="/"
        />
        <Route
          element={
            <DashboardLayout>
              <SettingsPage />
            </DashboardLayout>
          }
          path="/settings"
        />
        <Route
          element={
            <DashboardLayout>
              <AccountPage />
            </DashboardLayout>
          }
          path="/account"
        />
        <Route
          element={
            <DashboardLayout>
              <CharactersPage />
            </DashboardLayout>
          }
          path="/characters"
        />
        <Route
          element={
            <DashboardLayout>
              <MedalsPage />
            </DashboardLayout>
          }
          path="/medals"
        />
        <Route
          element={
            <DashboardLayout>
              <AttendancePage />
            </DashboardLayout>
          }
          path="/attendance"
        />
        <Route
          element={
            <DashboardLayout>
              <GachaRecordsPage />
            </DashboardLayout>
          }
          path="/gacha"
        />
        <Route
          element={
            <DashboardLayout>
              <TodoPage />
            </DashboardLayout>
          }
          path="/todo"
        />
        <Route
          element={
            <DashboardLayout>
              <DeveloperPage />
            </DashboardLayout>
          }
          path="/developer"
        />
      </Routes>
    </>
  );
}

export default App;
