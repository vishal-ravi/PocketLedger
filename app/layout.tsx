import './globals.css';
import {Navbar} from '@/components/navbar';
import {PwaRegister} from '@/components/pwa-register';

export const metadata = {
  title: 'PocketLedger | Personal Finance',
  description: 'Personal expense and finance tracker',
  manifest: '/manifest.webmanifest',
  applicationName: 'PocketLedger',
  appleWebApp: {capable: true, title: 'PocketLedger', statusBarStyle: 'default'},
};

export const viewport = {
  themeColor: '#047857',
};

export default async function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <Navbar />
        <PwaRegister />
        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8 md:py-9">{children}</main>
      </body>
    </html>
  );
}
