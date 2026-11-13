// Public privacy policy (required for the Google Play listing). Readable without signing in.
export const metadata = { title: 'Privacy policy · NEAS Field Access' };

export default function Privacy() {
  return (
    <main className="privacy">
      <h1>Privacy policy</h1>
      <p className="note">NEAS Field Access · NextEdge Access Solutions (NEAS) · Last updated 28 October 2026</p>

      <h2>Who we are</h2>
      <p>NEAS Field Access is the project and field-reporting app of NextEdge Access Solutions (NEAS). It is used by NEAS staff and by clients that NEAS invites to their own projects. There is no public sign-up: accounts are created by a NEAS administrator.</p>

      <h2>What the app collects</h2>
      <ul>
        <li><b>Account details:</b> your name, username, role and, if given, your e-mail address. Passcodes and passwords are stored only as secure hashes.</li>
        <li><b>Work records:</b> field reports, activities, materials, remarks, project schedules and estimates entered in the app.</li>
        <li><b>Photos and documents:</b> site photos and files you add, with their capture time.</li>
        <li><b>Location:</b> GPS coordinates of a site photo, only when your device allows location for the app or the camera saved them in the photo. You can turn location off; photos are still saved without it.</li>
        <li><b>Signatures:</b> signatures drawn on a report, with the signer&apos;s name and the time.</li>
        <li><b>Activity records:</b> who created, changed, approved or shared a record and when (audit log), and basic technical logs needed to run the service.</li>
      </ul>

      <h2>Why it is used</h2>
      <p>Only to run the app: to record and review project work, produce reports for NEAS and its clients, keep evidence of work done, and keep accounts secure. The data is not used for advertising and is not sold.</p>

      <h2>Who can see it</h2>
      <ul>
        <li>NEAS staff see the projects they are assigned to; administrators see all projects.</li>
        <li>A client sees only their own projects, and only the reports and photos NEAS has approved and shared with them.</li>
        <li>The data is stored with the app&apos;s hosting providers (Supabase for the database and files, Vercel for the website), who process it only to provide the service. Photos and documents are kept in private storage.</li>
      </ul>

      <h2>On your device</h2>
      <p>To work without signal, the app keeps a copy of your projects, unsent reports and photos in your browser or app storage until they are synchronised. Signing out removes the cached project data from the device.</p>

      <h2>How long it is kept</h2>
      <p>Project records and site evidence are kept for as long as NEAS needs them for the project and its legal and contractual obligations. Deleted records can be recovered by an administrator for a period before they are removed for good.</p>

      <h2>Your choices and rights</h2>
      <p>You can ask NEAS to see, correct or delete your personal data, or to close your account, through your NEAS administrator or the contact below. Requests are handled in line with the Philippine Data Privacy Act of 2012.</p>

      <h2>Security</h2>
      <p>All connections use HTTPS. Access is controlled per user and per project by the database itself, and sign-in attempts are rate-limited.</p>

      <h2>Contact</h2>
      <p>NextEdge Access Solutions (NEAS) — privacy questions: please contact your NEAS administrator or the NEAS office.</p>
    </main>
  );
}
