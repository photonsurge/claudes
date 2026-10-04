import type { Metadata } from "next";
import LegalPage from "../LegalPage";

export const metadata: Metadata = { title: "Privacy Policy — Live Weather Globe" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Live Weather Globe is a personal weather-broadcast project run by a single operator. It publishes live
        weather and hazard information to YouTube. It has no public user accounts and collects no personal data from
        visitors.
      </p>
      <h2>Google / YouTube access</h2>
      <p>
        The operator connects their own YouTube channel through Google OAuth so the app can create and end live
        broadcasts, set the title, description and thumbnail, and read and post live-chat messages on that channel.
        Only the channel owner authorises this. The resulting access token is stored on the operator's own server and
        is used for nothing else.
      </p>
      <p>
        We do not sell, share or transfer Google user data to anyone. Use of information received from Google APIs
        adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" style={{ color: "#8ab4f8" }}>
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>
      <h2>Visitors</h2>
      <p>
        Viewing the site requires no sign-in. Basic request logs (time, path, status) are kept on the server for
        diagnostics and are not used for advertising or profiling.
      </p>
      <h2>Revoking access</h2>
      <p>
        The channel owner can revoke access at any time at{" "}
        <a href="https://myaccount.google.com/permissions" style={{ color: "#8ab4f8" }}>myaccount.google.com/permissions</a>.
      </p>
    </LegalPage>
  );
}
