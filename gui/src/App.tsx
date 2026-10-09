import { lazy, Suspense, useEffect } from "react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import Layout from "./components/Layout";
import { MainEditorProvider } from "./components/mainInput/TipTapEditor";
import { SubmenuContextProvidersProvider } from "./context/SubmenuContextProviders";
import { VscThemeProvider } from "./context/VscTheme";
import ParallelListeners from "./hooks/ParallelListeners";
import ErrorPage from "./pages/error";
import Chat from "./pages/gui";
import { ROUTES } from "./util/navigation";
import { ensureHighlightLoaded } from "./components/StyledMarkdownPreview/lazyMarkdownPlugins";
import { ensureTokenizerLoaded } from "./util/tokenCount";

// Vynor chat is the startup surface. Provider configuration, history, usage,
// and theme tools remain available, but loading them must not delay the first
// render or put their third-party provider catalogue in the initial bundle.
const ConfigPage = lazy(() => import("./pages/config"));
const History = lazy(() => import("./pages/history"));
const Stats = lazy(() => import("./pages/stats"));
const ThemePage = lazy(() => import("./styles/ThemePage"));

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

const router = createMemoryRouter([
  {
    path: ROUTES.HOME,
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      {
        path: "/index.html",
        element: <Chat />,
      },
      {
        path: ROUTES.HOME,
        element: <Chat />,
      },
      {
        path: "/history",
        element: (
          <LazyPage>
            <History />
          </LazyPage>
        ),
      },
      {
        path: ROUTES.STATS,
        element: (
          <LazyPage>
            <Stats />
          </LazyPage>
        ),
      },
      {
        path: ROUTES.CONFIG,
        element: (
          <LazyPage>
            <ConfigPage />
          </LazyPage>
        ),
      },
      {
        path: ROUTES.THEME,
        element: (
          <LazyPage>
            <ThemePage />
          </LazyPage>
        ),
      },
    ],
  },
]);

/*
  ParallelListeners prevents entire app from rerendering on any change in the listeners,
  most of which interact with redux etc.
*/
function App() {
  // The exact tokenizer and the code highlighter are separate chunks: fetch it shortly after the first
  // paint instead of making the panel parse it up front.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void ensureTokenizerLoaded();
      void ensureHighlightLoaded();
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <VscThemeProvider>
      <MainEditorProvider>
        <SubmenuContextProvidersProvider>
          <RouterProvider router={router} />
        </SubmenuContextProvidersProvider>
      </MainEditorProvider>
      <ParallelListeners />
    </VscThemeProvider>
  );
}

export default App;
