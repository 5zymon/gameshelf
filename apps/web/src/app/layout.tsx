import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-sans',
});

export const metadata: Metadata = {
  title: 'GameShelf',
  description: 'Track, organize, and discover your video game library.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="en" className={geistSans.variable}>
      <body className="min-h-dvh bg-ink text-fog antialiased">{children}</body>
    </html>
  );
}
