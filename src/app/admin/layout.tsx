import React from 'react';
import Link from 'next/link';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-gray-900 text-white sticky top-0 z-50 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-8">
              <Link href="/admin/dashboard" className="text-2xl font-bold tracking-tight text-white flex items-center">
                <svg className="w-8 h-8 mr-2 text-brand-accent" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
                </svg>
                MediCare Admin
              </Link>
              <nav className="hidden md:flex space-x-6">
                <Link href="/admin/dashboard" className="text-gray-300 hover:text-white transition-colors font-medium">Dashboard</Link>
                <Link href="/admin/doctors" className="text-gray-300 hover:text-white transition-colors font-medium">Doctors & Leaves</Link>
              </nav>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gray-700 text-white rounded-full flex items-center justify-center font-bold">
                  AD
                </div>
                <span className="text-sm font-medium hidden sm:block">Admin User</span>
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
