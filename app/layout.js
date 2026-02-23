import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "10Blocuri Dashboard",
  description: "Community management platform",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
