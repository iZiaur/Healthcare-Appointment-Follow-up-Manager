import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "MediCare | Premium Healthcare Appointment & Follow-up Manager",
  description: "A comprehensive clinic platform with distinct portals for Patients, Doctors, and Admins.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased bg-brand-surface text-gray-900`}>
        {children}
      </body>
    </html>
  );
}
