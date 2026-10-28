import "./globals.css";

export const metadata = {
  title: "Feedback Process Prototype",
  description: "Next.js prototype for feedback request workflow",
  icons: {
    icon: [{ url: "/justuju-favicon-v2.png", type: "image/png", sizes: "64x64" }],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
