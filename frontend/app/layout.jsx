import "./globals.css";

export const metadata = {
  title: "ScaleMatrix AI · Agency workspace",
  description:
    "Your daily content, prospect research, and agency pipeline in one workspace.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
