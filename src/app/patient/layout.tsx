import React from 'react';
import Link from 'next/link';

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-brand-surface">
      <header className="bg-brand-primary text-white sticky top-0 z-50 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-8">
              <Link href="/patient/dashboard" className="text-2xl font-bold tracking-tight text-white flex items-center">
                <svg className="w-8 h-8 mr-2 text-brand-accent" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v4h4v2h-4v4h-2v-4H7v-2h4V7z"/>
                </svg>
                MediCare
              </Link>
              <nav className="hidden md:flex space-x-6">
                <Link href="/patient/dashboard" className="text-brand-secondary hover:text-white transition-colors font-medium">Dashboard</Link>
                <Link href="/patient/doctors" className="text-brand-secondary hover:text-white transition-colors font-medium">Find a Doctor</Link>
              </nav>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-brand-secondary text-brand-primary rounded-full flex items-center justify-center font-bold">
                  JS
                </div>
                <span className="text-sm font-medium hidden sm:block">Jane Smith</span>
              </div>
            </div>
          </div>
        </div>
      </header>
      
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
