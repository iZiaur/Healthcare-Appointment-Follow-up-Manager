import React from 'react';
import Link from 'next/link';

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-brand-surface">
      <header className="bg-white text-gray-900 border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-8">
              <Link href="/doctor/dashboard" className="text-2xl font-bold tracking-tight text-brand-primary flex items-center">
                <svg className="w-8 h-8 mr-2 text-brand-primary" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-8 14H7v-2h4v2zm4-4H7v-2h8v2zm0-4H7V7h8v2z"/>
                </svg>
                MediCare Provider
              </Link>
              <nav className="hidden md:flex space-x-6">
                <Link href="/doctor/dashboard" className="text-gray-600 hover:text-brand-primary transition-colors font-medium">My Schedule</Link>
                <Link href="/doctor/patients" className="text-gray-600 hover:text-brand-primary transition-colors font-medium">Patients</Link>
              </nav>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-brand-primary text-white rounded-full flex items-center justify-center font-bold">
                  DR
                </div>
                <span className="text-sm font-medium hidden sm:block text-gray-700">Dr. Provider</span>
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
