import { Suspense, lazy, type ComponentType, type ReactNode } from "react";
import { createBrowserRouter, Navigate, useLocation } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { isAdminUser, isLoggedIn } from "@/lib/apiAuth";

const Home = lazy(() => import("@/pages/Home").then((m) => ({ default: m.Home })));
const Agent = lazy(() => import("@/pages/Agent").then((m) => ({ default: m.Agent })));
const RunDetail = lazy(() =>
  import("@/pages/RunDetail").then((m) => ({ default: m.RunDetail })),
);
const Compare = lazy(() =>
  import("@/pages/Compare").then((m) => ({ default: m.Compare })),
);
const Settings = lazy(() =>
  import("@/pages/Settings").then((m) => ({ default: m.Settings })),
);
const Users = lazy(() =>
  import("@/pages/Users").then((m) => ({ default: m.Users })),
);
const Deployment = lazy(() =>
  import("@/pages/Deployment").then((m) => ({ default: m.Deployment })),
);
const Runtime = lazy(() =>
  import("@/pages/Runtime").then((m) => ({ default: m.Runtime })),
);
const Reports = lazy(() =>
  import("@/pages/Reports").then((m) => ({ default: m.Reports })),
);
const Correlation = lazy(() =>
  import("@/pages/Correlation").then((m) => ({ default: m.Correlation })),
);
const AlphaZoo = lazy(() =>
  import("@/pages/AlphaZoo").then((m) => ({ default: m.AlphaZoo })),
);
const SingleStock = lazy(() =>
  import("@/pages/SingleStock").then((m) => ({ default: m.SingleStock })),
);
const StrategyLab = lazy(() =>
  import("@/pages/StrategyLab").then((m) => ({ default: m.StrategyLab })),
);
const Login = lazy(() =>
  import("@/pages/Login").then((m) => ({ default: m.Login })),
);

function PageLoader() {
  return (
    <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
      Loading…
    </div>
  );
}

function wrap(Component: ComponentType) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  if (!isAdminUser()) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export const router = createBrowserRouter([
  { path: "/login", element: wrap(Login) },
  {
    element: <RequireAuth><Layout /></RequireAuth>,
    children: [
      { path: "/", element: wrap(Home) },
      { path: "/agent", element: wrap(Agent) },
      { path: "/runtime", element: wrap(Runtime) },
      { path: "/reports", element: wrap(Reports) },
      { path: "/users", element: <RequireAdmin>{wrap(Users)}</RequireAdmin> },
      { path: "/deployment", element: <RequireAdmin>{wrap(Deployment)}</RequireAdmin> },
      { path: "/settings", element: wrap(Settings) },
      { path: "/strategy-lab", element: wrap(StrategyLab) },
      { path: "/single-stock", element: wrap(SingleStock) },
      { path: "/runs/:runId", element: wrap(RunDetail) },
      { path: "/compare", element: wrap(Compare) },
      { path: "/correlation", element: wrap(Correlation) },
      { path: "/alpha-zoo", element: wrap(AlphaZoo) },
      { path: "/alpha-zoo/bench", element: wrap(AlphaZoo) },
      { path: "/alpha-zoo/compare", element: wrap(AlphaZoo) },
      { path: "/alpha-zoo/:alphaId", element: wrap(AlphaZoo) },
    ],
  },
]);
