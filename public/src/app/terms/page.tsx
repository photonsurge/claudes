import type { Metadata } from "next";
import LegalPage from "../LegalPage";

export const metadata: Metadata = { title: "Terms of Service — Live Weather Globe" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        Live Weather Globe is a personal project operated by one person. The public site and its YouTube streams are
        provided free, as-is, with no warranty of any kind.
      </p>
      <h2>Not for safety decisions</h2>
      <p>
        Weather, earthquake, volcano and alert information shown here is aggregated from third-party sources and may
        be delayed, incomplete or wrong. Never rely on it for safety. Follow your official national or local warning
        service.
      </p>
      <h2>Use</h2>
      <p>
        The operator console is private and for the operator's use only. By viewing the site you agree not to attempt
        to disrupt it or access anything that is not publicly offered.
      </p>
      <h2>Third-party services</h2>
      <p>
        YouTube features are used under the{" "}
        <a href="https://www.youtube.com/t/terms" style={{ color: "#8ab4f8" }}>YouTube Terms of Service</a>, and the
        Google Privacy Policy applies to data handled by Google.
      </p>
      <h2>Changes</h2>
      <p>These terms may change at any time; the date above shows the latest revision.</p>
    </LegalPage>
  );
}
