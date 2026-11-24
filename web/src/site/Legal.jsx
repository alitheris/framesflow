import React from 'react';
import SiteLayout from './SiteLayout';
import { useCloud } from '../cloud';
import { BRAND } from '../../../shared/brand.mjs';

const UPDATED = '20 November 2026';

function Contact() {
  const { contactEmail } = useCloud();
  return contactEmail
    ? <>Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</>
    : <>Use the contact details published on <a href={BRAND.product.url}>{BRAND.product.url.replace('https://', '')}</a>.</>;
}

export function Terms() {
  return (
    <SiteLayout title="Terms of Use" kicker="Legal">
      <p className="legal-meta">Last updated {UPDATED}</p>
      <p>These terms govern your use of Framesflow, the website at {BRAND.product.url.replace('https://', '')}, the hosted MCP link and the related tools (together, the "Service"), provided by {BRAND.company.name} ("we", "us"). By using the Service you agree to them. If you do not agree, do not use it.</p>

      <h2>1. The Service</h2>
      <p>Framesflow is a video editing studio that runs in your browser and, optionally, on your computer through a helper program. It lets you, or an AI assistant you connect, edit video projects. The Service is provided free of charge. We may change, limit or stop any feature at any time.</p>

      <h2>2. Your account</h2>
      <p>Some features need you to sign in with Google. You are responsible for your account and for everything done through it, including actions taken by an AI assistant you authorise. You must give accurate information and keep access to your account secure. You can remove an AI connection at any time in your AI app.</p>

      <h2>3. Your content and your responsibility</h2>
      <p>You keep all rights in the videos, scripts, voiceovers and other material you create or import ("Your Content"). You are solely responsible for Your Content and for the videos you publish, including that:</p>
      <ul>
        <li>you own it or have all the rights and permissions needed to use it (footage, images, music, voices, fonts and any other material);</li>
        <li>you follow the licences of anything you use and give the credit those licences require;</li>
        <li>you follow the rules of every platform you publish on (for example YouTube's Terms of Service, monetisation and copyright policies);</li>
        <li>your content is lawful and does not infringe anyone's rights, defame or harass anyone, mislead people in harmful ways, or present synthetic media as real events where that is prohibited or must be disclosed.</li>
      </ul>
      <div className="callout"><p><b>Downloading from third-party sites.</b> The helper can download media from sources you choose, including YouTube. Doing so may be restricted by that site's terms or by copyright law. You decide what to download and use, and you do so at your own risk. We provide source and licence logging as an aid, not as legal advice or a guarantee that anything is permitted.</p></div>

      <h2>4. Acceptable use</h2>
      <p>Do not use the Service to break the law; to infringe intellectual property; to create or spread malware, harassment, hate, sexual content involving minors, or deceptive impersonation; to attack, overload or probe our systems or other users; to bypass limits or security; or to resell access to the hosted link. We may suspend access that we reasonably believe breaks these terms.</p>

      <h2>5. AI assistants</h2>
      <p>When you connect an AI assistant, it can read and edit your projects through the tools you allow. What the assistant does, and what it sends to its own provider, is governed by that provider's terms and your instructions. Check what an assistant did before you publish. Outputs generated with AI can be wrong.</p>

      <h2>6. Contributions</h2>
      <p>You can support Framesflow with a voluntary contribution of $5 or more through our payment provider, Stripe. Contributions are gifts to support development: they do not buy goods, services, features, priority or ownership, are not tax-deductible charitable donations unless we explicitly say otherwise, and are non-refundable except where the law requires. Taxes and fees may be handled by Stripe. If you believe a payment was made in error, contact us promptly.</p>

      <h2>7. Intellectual property</h2>
      <p>The Service, its software, design, skill content and branding belong to {BRAND.company.name} or its licensors, and are provided to you for your use of the Service. Framesflow, Kuku Labs, Grow With Ali and Alitheris are names of {BRAND.company.name}. Open-source components remain under their own licences.</p>

      <h2>8. Third-party services</h2>
      <p>The Service relies on third parties such as Google (sign-in), Supabase (accounts and project storage), Cloudflare (hosting and the hosted MCP link), Stripe (payments) and open-licence image sources. Their terms apply to your use of them.</p>

      <h2>9. No warranty</h2>
      <p>The Service is provided "as is" and "as available" without warranties of any kind, to the fullest extent the law allows. We do not promise that it will be uninterrupted, error-free or fit for a particular purpose, that your files will never be lost (keep backups of your media and exports), or that any video will earn income, be monetised or avoid copyright claims.</p>

      <h2>10. Limitation of liability</h2>
      <p>To the fullest extent the law allows, we are not liable for indirect, incidental, special or consequential damages, or for lost profits, revenue, data or goodwill, arising from your use of the Service. Our total liability for any claim relating to the Service is limited to the greater of the amount you paid us in the 12 months before the claim and USD 50. Nothing here limits liability that cannot be limited by law.</p>

      <h2>11. Termination</h2>
      <p>You can stop using the Service at any time. We may suspend or end access if you break these terms or if we stop offering the Service. Sections that by their nature should survive (such as 3, 6, 7, 9 and 10) will survive.</p>

      <h2>12. Changes and law</h2>
      <p>We may update these terms; the date above shows the latest version, and continued use means you accept the change. These terms are governed by the laws of the place where {BRAND.company.name} is established, and the courts there have jurisdiction, unless mandatory consumer law gives you other rights.</p>

      <h2>13. Contact</h2>
      <p><Contact /></p>
    </SiteLayout>
  );
}

export function Privacy() {
  return (
    <SiteLayout title="Privacy Policy" kicker="Legal">
      <p className="legal-meta">Last updated {UPDATED}</p>
      <p>This policy explains what data the Service handles and why. {BRAND.company.name} is the controller of the data described here. We aim to collect as little as possible.</p>

      <h2>1. Using the studio without an account</h2>
      <p>If you do not sign in, your projects and media stay in your browser's storage on your device. They are not uploaded to us. If you run the local helper, projects, downloads and renders stay in a folder on your computer.</p>

      <h2>2. If you sign in</h2>
      <ul>
        <li><b>Account data:</b> your Google account identifier and email address, provided through Google sign-in and stored by our authentication provider, Supabase.</li>
        <li><b>Project data:</b> the project file (timeline, settings, script, notes) is saved to your account so it follows you. <b>Your media files (video, audio, images) are not uploaded.</b> They stay on the device where you imported them.</li>
        <li><b>Sign-in sessions:</b> a session token is kept in your browser's local storage so you stay signed in.</li>
      </ul>

      <h2>3. The hosted AI link (MCP)</h2>
      <p>To let an AI assistant edit your open studio, a small service on Cloudflare stores short-lived authorisation records (hashed tokens, the AI app's name and redirect address) and passes each tool request between the assistant and your open browser tab. Tool requests and results pass through this service while they run; we do not keep them. Your AI provider receives whatever the assistant reads from your project.</p>

      <h2>4. Contributions</h2>
      <p>Payments are processed by Stripe on Stripe's own pages. We do not see or store your card details. Stripe shares with us the information we need to run the program (such as the amount, status, and the name and email you give Stripe), and handles it under its own privacy policy.</p>

      <h2>5. Optional helper features</h2>
      <p>When you use features that contact other sites, such as image search (Openverse) or downloading media you choose, your computer connects to those sites directly and they see that request under their own policies.</p>

      <h2>6. Logs, cookies and analytics</h2>
      <p>Our hosting providers keep standard technical logs (such as IP address and request time) for security and operation. We do not use advertising cookies. The site uses browser storage only for things you need: your sign-in session, your local projects, and a one-time intro animation flag. We do not currently run analytics; if we add them we will update this page.</p>

      <h2>7. How we use data</h2>
      <p>To run and secure the Service, keep you signed in, sync your projects, connect your AI assistant at your request, process contributions, answer support requests, and meet legal obligations. We do not sell your personal data and we do not use your projects to train AI models.</p>

      <h2>8. Sharing</h2>
      <p>We share data only with providers that help us run the Service (Google, Supabase, Cloudflare, Stripe), when the law requires it, or with your consent. These providers may process data in other countries.</p>

      <h2>9. Retention and your choices</h2>
      <p>You can delete projects in the studio. You can sign out and remove an AI connection at any time. To delete your account and its stored project data, or to ask about the data we hold about you, contact us. Depending on where you live, you may have rights to access, correct, delete, export or object to the processing of your personal data. Authorisation records expire automatically (access tokens after one hour, refresh tokens after 30 days).</p>

      <h2>10. Security</h2>
      <p>Account and project data is protected by per-user access rules, and connections use HTTPS. No system is perfectly secure; keep backups of your own media.</p>

      <h2>11. Children</h2>
      <p>The Service is not directed to children under 13 (or the higher age required in your country), and we do not knowingly collect their data.</p>

      <h2>12. Changes and contact</h2>
      <p>We will update this page when our practices change and show the date above. Questions or requests: <Contact /></p>
    </SiteLayout>
  );
}
