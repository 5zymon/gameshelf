import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="en">
      <body className="min-h-dvh bg-ink text-fog antialiased">{children}</body>
    </html>
  );
}
