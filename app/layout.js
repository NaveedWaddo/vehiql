import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import Header from "@/components/header";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Vehiql",
  description: "Find your dream Car",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${inter.className}`}>
        <Header />

        <main className="min-h-screen">{children}</main>

        <footer className="bg-blue-50 py-12">
          <div>
            <p className="container mx-auto px-4 text-center text-gray-600">
              Made with 💗 Naveed Waddo
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
