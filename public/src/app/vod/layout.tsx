import AdminThemeProvider from "../../theme/AdminThemeProvider";

/**
 * /vod/:videoId is a PUBLIC page (linked from every video's YouTube
 * description) that reuses the timeline components built for /admin/streams,
 * so it needs the same MUI theme those components are styled against — mounted
 * here because the page lives outside /admin/layout (same trick as /countries).
 */
export default function VodLayout({ children }: { children: React.ReactNode }) {
  return <AdminThemeProvider>{children}</AdminThemeProvider>;
}
