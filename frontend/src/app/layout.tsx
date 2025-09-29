import './globals.css';
import React from 'react';
import { Providers } from '@/components/Providers';
import WsNotifier from '@/components/WsNotifier';

export const metadata = {
  title: 'SuperAgent',
  description: 'Multi-agent chat',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <WsNotifier />
          {children}
        </Providers>
      </body>
    </html>
  );
}


